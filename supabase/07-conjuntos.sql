-- =====================================================================
--  Control de Insumos — Conjuntos de equipos (p. ej. pórtico RF = lector + 4 antenas)
--  Ejecutar después de 06-activos-fijos.sql. Se puede repetir.
--
--  - Un equipo marcado "es_conjunto" agrupa a otros equipos (sus componentes).
--  - Cada componente pertenece a un solo conjunto y conserva sus códigos de activo fijo.
--  - El conjunto se presta entero: los componentes pasan a "Prestado" con él y no se
--    pueden prestar por separado. Para prestar, todos tienen que estar Disponibles.
--  - Al devolver se indica qué partes volvieron con daño o faltantes: esas pasan a
--    "En mantenimiento"; el resto vuelve a "Disponible".
--  - Mientras el conjunto está prestado no se agregan ni se sacan componentes.
-- =====================================================================

-- 1. Columnas
alter table public.equipos add column if not exists es_conjunto boolean not null default false;
alter table public.equipos add column if not exists conjunto_id bigint references public.equipos(id) on delete restrict;
create index if not exists equipos_conjunto_idx on public.equipos (conjunto_id);

alter table public.prestamos add column if not exists componentes_con_novedad bigint[];

-- 2. Reglas de armado del conjunto
create or replace function public.validar_conjunto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  padre public.equipos%rowtype;
begin
  -- Los cambios de estado que hacen los préstamos no tocan el armado.
  if coalesce(current_setting('equipos.por_prestamo', true), '') = 'si' then
    return new;
  end if;

  if new.conjunto_id is not null then
    if tg_op = 'UPDATE' and new.conjunto_id = new.id then
      raise exception 'CONJUNTO_INVALIDO';
    end if;
    if new.es_conjunto then
      raise exception 'CONJUNTO_DENTRO_DE_CONJUNTO';
    end if;
    select * into padre from public.equipos where id = new.conjunto_id;
    if not found or not padre.es_conjunto or padre.conjunto_id is not null then
      raise exception 'CONJUNTO_INVALIDO';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.conjunto_id is not null and padre.estado = 'Prestado' then
      raise exception 'CONJUNTO_PRESTADO';
    end if;
    return new;
  end if;

  if new.conjunto_id is distinct from old.conjunto_id then
    if old.estado = 'Prestado' then
      raise exception 'COMPONENTE_PRESTADO';
    end if;
    if new.conjunto_id is not null and padre.estado = 'Prestado' then
      raise exception 'CONJUNTO_PRESTADO';
    end if;
  end if;

  if old.es_conjunto and not new.es_conjunto
     and exists (select 1 from public.equipos where conjunto_id = new.id) then
    raise exception 'CONJUNTO_CON_COMPONENTES';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_conjunto on public.equipos;
create trigger trg_validar_conjunto
  before insert or update on public.equipos
  for each row execute function public.validar_conjunto();

-- 3. Préstamo: el conjunto sale entero; un componente no se presta solo.
create or replace function public.prestamo_al_retirar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  eq         public.equipos%rowtype;
  pendientes text;
begin
  if length(trim(coalesce(new.usuario_responsable, ''))) = 0 then
    raise exception 'FALTA_RESPONSABLE';
  end if;

  select * into eq from public.equipos where id = new.equipo_id;
  if not found then
    raise exception 'EQUIPO_INEXISTENTE';
  end if;
  if eq.conjunto_id is not null then
    raise exception 'COMPONENTE_DE_CONJUNTO:%', (select nombre from public.equipos where id = eq.conjunto_id);
  end if;
  if eq.es_conjunto then
    select string_agg(nombre || ' (' || estado || ')', ', ' order by nombre) into pendientes
      from public.equipos
     where conjunto_id = eq.id and estado <> 'Disponible';
    if pendientes is not null then
      raise exception 'COMPONENTES_NO_DISPONIBLES:%', pendientes;
    end if;
  end if;

  new.registrado_por            := auth.uid();
  new.fecha_retiro              := now();
  new.estado                    := 'Activo';
  new.fecha_devolucion          := null;
  new.recibido_por              := null;
  new.condicion_devolucion      := null;
  new.observaciones_devolucion  := null;
  new.componentes_con_novedad   := null;

  perform set_config('equipos.por_prestamo', 'si', true);
  update public.equipos set estado = 'Prestado'
   where id = new.equipo_id and estado = 'Disponible';
  if not found then
    perform set_config('equipos.por_prestamo', '', true);
    raise exception 'EQUIPO_NO_DISPONIBLE';
  end if;
  if eq.es_conjunto then
    update public.equipos set estado = 'Prestado' where conjunto_id = eq.id;
  end if;
  perform set_config('equipos.por_prestamo', '', true);
  return new;
end;
$$;

-- 4. Devolución: las partes con novedad van a mantenimiento; el resto queda disponible.
create or replace function public.prestamo_al_devolver()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  conjunto boolean;
begin
  if old.estado = 'Devuelto' then
    raise exception 'PRESTAMO_YA_DEVUELTO';
  end if;

  -- Datos del retiro: no se modifican.
  new.equipo_id            := old.equipo_id;
  new.usuario_responsable  := old.usuario_responsable;
  new.practica_motivo      := old.practica_motivo;
  new.fecha_retiro         := old.fecha_retiro;
  new.registrado_por       := old.registrado_por;
  new.observaciones_retiro := old.observaciones_retiro;

  if new.estado is distinct from 'Devuelto' then
    new.estado := 'Activo';
    new.condicion_devolucion := null;
    new.observaciones_devolucion := null;
    new.componentes_con_novedad := null;
    return new;
  end if;

  select es_conjunto into conjunto from public.equipos where id = old.equipo_id;

  -- Solo valen novedades del propio equipo o de sus componentes.
  if conjunto then
    new.componentes_con_novedad := nullif(array(
      select x from unnest(coalesce(new.componentes_con_novedad, '{}')) x
       where x = old.equipo_id or exists (select 1 from public.equipos c where c.id = x and c.conjunto_id = old.equipo_id)
    ), '{}');
    if new.componentes_con_novedad is not null then
      new.condicion_devolucion := 'Con daño';
    end if;
  else
    new.componentes_con_novedad := null;
  end if;

  new.fecha_devolucion     := now();
  new.recibido_por         := auth.uid();
  new.condicion_devolucion := coalesce(new.condicion_devolucion, 'Bien');

  perform set_config('equipos.por_prestamo', 'si', true);
  if conjunto then
    update public.equipos
       set estado = case when id = any(coalesce(new.componentes_con_novedad, '{}')) then 'En mantenimiento' else 'Disponible' end
     where id = old.equipo_id or (conjunto_id = old.equipo_id and estado = 'Prestado');
  else
    update public.equipos
       set estado = case when new.condicion_devolucion = 'Con daño' then 'En mantenimiento' else 'Disponible' end
     where id = old.equipo_id;
  end if;
  perform set_config('equipos.por_prestamo', '', true);
  return new;
end;
$$;

grant update (estado, condicion_devolucion, observaciones_devolucion, fecha_prevista, contacto, componentes_con_novedad)
  on public.prestamos to authenticated;

-- 5. Auditoría: también el armado de conjuntos
create or replace function public.auditar_equipo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campos  text[] := array['codigo_serie', 'activo_fijo_utec', 'activo_fijo_n', 'nombre', 'categoria', 'marca_modelo',
                          'ubicacion', 'estado', 'fecha_adquisicion', 'valor_compra', 'observaciones',
                          'es_conjunto', 'conjunto_id'];
  campo   text;
  antes   jsonb;
  despues jsonb;
  cambios jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria (tabla, registro_id, accion, cambios, usuario_id)
    values ('equipos', new.id, 'alta',
            jsonb_strip_nulls(jsonb_build_object('estado', jsonb_build_array(null, new.estado),
                                                 'conjunto_id', case when new.conjunto_id is not null then jsonb_build_array(null, new.conjunto_id) end)),
            auth.uid());
    return new;
  end if;

  if coalesce(current_setting('equipos.por_prestamo', true), '') = 'si' then
    return new;
  end if;

  antes := to_jsonb(old);
  despues := to_jsonb(new);
  foreach campo in array campos loop
    if (antes -> campo) is distinct from (despues -> campo) then
      cambios := cambios || jsonb_build_object(campo, jsonb_build_array(antes -> campo, despues -> campo));
    end if;
  end loop;

  if cambios <> '{}'::jsonb then
    insert into public.auditoria (tabla, registro_id, accion, cambios, usuario_id)
    values ('equipos', new.id, 'edicion', cambios, auth.uid());
  end if;
  return new;
end;
$$;

-- 6. Vista de equipos: a qué conjunto pertenece y resumen de sus componentes
drop view if exists public.v_equipos;
create view public.v_equipos
with (security_invoker = true) as
select e.*,
       p.id                   as prestamo_id,
       p.usuario_responsable  as prestado_a,
       p.contacto             as prestamo_contacto,
       p.practica_motivo      as prestamo_motivo,
       p.fecha_retiro         as prestamo_desde,
       p.fecha_prevista       as prestamo_hasta,
       (p.id is not null and p.fecha_prevista < (now() at time zone 'America/Montevideo')::date) as vencido,
       c.nombre               as conjunto_nombre,
       c.codigo_serie         as conjunto_codigo,
       coalesce(k.cantidad, 0) as componentes,
       k.valor                as valor_componentes,
       k.no_disponibles       as componentes_no_disponibles
  from public.equipos e
  left join public.prestamos p on p.equipo_id = e.id and p.estado = 'Activo'
  left join public.equipos c on c.id = e.conjunto_id
  left join lateral (
    select count(*)::int as cantidad,
           sum(x.valor_compra) as valor,
           string_agg(case when x.estado not in ('Disponible', 'Prestado') then x.nombre || ' (' || x.estado || ')' end, ', ' order by x.nombre) as no_disponibles
      from public.equipos x
     where x.conjunto_id = e.id
  ) k on e.es_conjunto;
revoke all on public.v_equipos from anon;
grant select on public.v_equipos to authenticated;

-- 7. Historial: en la devolución de un conjunto, qué partes volvieron con novedad
drop view if exists public.v_historial;
create view public.v_historial
with (security_invoker = true) as
select 'insumos'::text  as modulo, 'consumo'::text as tipo, m.fecha_hora as fecha,
       m.insumo_id as item_id, i.nombre as item, i.codigo, i.unidad_medida,
       m.cantidad_retirada as cantidad, m.practica_motivo as motivo, m.responsable,
       null::jsonb as cambios, null::text as detalle, m.usuario_id,
       coalesce(nullif(pf.nombre, ''), pf.email) as usuario
  from public.movimientos_insumos m
  join public.insumos i on i.id = m.insumo_id
  left join public.perfiles pf on pf.id = m.usuario_id
union all
select 'insumos', a.accion, a.fecha, a.registro_id, i.nombre, i.codigo, i.unidad_medida,
       null, null, null, a.cambios, null, a.usuario_id, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.auditoria a
  join public.insumos i on i.id = a.registro_id
  left join public.perfiles pf on pf.id = a.usuario_id
 where a.tabla = 'insumos'
union all
select 'equipos', a.accion, a.fecha, a.registro_id, e.nombre, e.codigo_serie, null,
       null, null, null, a.cambios, null, a.usuario_id, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.auditoria a
  join public.equipos e on e.id = a.registro_id
  left join public.perfiles pf on pf.id = a.usuario_id
 where a.tabla = 'equipos'
union all
select 'equipos', 'prestamo', p.fecha_retiro, p.equipo_id, e.nombre, e.codigo_serie, null,
       null, p.practica_motivo, p.usuario_responsable, null,
       concat_ws(' · ',
         case when p.fecha_prevista is not null then 'Devolución prevista: ' || to_char(p.fecha_prevista, 'DD/MM/YYYY') end,
         case when e.es_conjunto then 'Conjunto con ' || (select count(*) from public.equipos c where c.conjunto_id = e.id) || ' componentes' end),
       p.registrado_por, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pf on pf.id = p.registrado_por
union all
select 'equipos', 'devolucion', p.fecha_devolucion, p.equipo_id, e.nombre, e.codigo_serie, null,
       null, null, p.usuario_responsable, null,
       concat_ws(' · ',
         p.condicion_devolucion,
         'Con novedad: ' || (select string_agg(c.nombre, ', ' order by c.nombre) from public.equipos c where c.id = any(p.componentes_con_novedad)),
         nullif(trim(p.observaciones_devolucion), '')),
       p.recibido_por, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pf on pf.id = p.recibido_por
 where p.estado = 'Devuelto';
revoke all on public.v_historial from anon;
grant select on public.v_historial to authenticated;

select id, codigo_serie, nombre, es_conjunto, conjunto_id from public.equipos order by id;
