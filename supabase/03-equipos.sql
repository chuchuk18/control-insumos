-- =====================================================================
--  Control de Insumos — Módulo de equipos (control de activos y préstamos)
--  Ejecutar después de 02-usuarios-y-auditoria.sql. Se puede repetir.
--
--  - equipos: inventario de activos (código/serie, categoría, ubicación, valor…).
--  - prestamos: quién retira, para qué, cuándo debe devolver y en qué estado volvió.
--  - Reglas en la base:
--      · Solo se presta un equipo "Disponible"; al prestarlo pasa a "Prestado".
--      · Al devolverlo vuelve a "Disponible", o a "En mantenimiento" si volvió con daño.
--      · El estado "Prestado" no se puede poner ni quitar a mano.
--      · Los préstamos no se borran; quién prestó y quién recibió lo pone la base.
--  - Altas y cambios de equipos quedan en auditoría; todo aparece en v_historial.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EQUIPOS: datos de activo y estados
-- ---------------------------------------------------------------------
alter table public.equipos add column if not exists categoria          text not null default 'General';
alter table public.equipos add column if not exists marca_modelo       text;
alter table public.equipos add column if not exists ubicacion          text;
alter table public.equipos add column if not exists fecha_adquisicion  date;
alter table public.equipos add column if not exists valor_compra       numeric(14,2);
alter table public.equipos add column if not exists observaciones      text;
alter table public.equipos add column if not exists creado_en          timestamptz not null default now();
alter table public.equipos add column if not exists creado_por         uuid;
alter table public.equipos add column if not exists actualizado_por    uuid;
alter table public.equipos add column if not exists actualizado_en     timestamptz;

alter table public.equipos drop constraint if exists equipos_estado_check;
-- "En uso" (versión anterior) pasa a "Prestado" solo si tiene un préstamo activo; si no, a "Disponible".
update public.equipos e
   set estado = case when exists (select 1 from public.prestamos p where p.equipo_id = e.id and p.estado = 'Activo')
                     then 'Prestado' else 'Disponible' end
 where e.estado = 'En uso';
alter table public.equipos add constraint equipos_estado_check
  check (estado in ('Disponible', 'Prestado', 'En mantenimiento', 'De baja'));

alter table public.equipos drop constraint if exists equipos_valor_check;
alter table public.equipos add constraint equipos_valor_check check (valor_compra is null or valor_compra >= 0);

alter table public.equipos drop constraint if exists equipos_nombre_check;
alter table public.equipos add constraint equipos_nombre_check check (length(trim(nombre)) > 0);

-- Código único sin distinguir mayúsculas.
create unique index if not exists equipos_codigo_unico on public.equipos (upper(codigo_serie));

-- ---------------------------------------------------------------------
-- 2. PRÉSTAMOS: datos del retiro y de la devolución
-- ---------------------------------------------------------------------
alter table public.prestamos add column if not exists contacto                 text;
alter table public.prestamos add column if not exists practica_motivo          text;
alter table public.prestamos add column if not exists fecha_prevista           date;
alter table public.prestamos add column if not exists observaciones_retiro     text;
alter table public.prestamos add column if not exists condicion_devolucion     text;
alter table public.prestamos add column if not exists observaciones_devolucion text;
alter table public.prestamos add column if not exists registrado_por           uuid;
alter table public.prestamos add column if not exists recibido_por             uuid;

alter table public.prestamos drop constraint if exists prestamos_condicion_check;
alter table public.prestamos add constraint prestamos_condicion_check
  check (condicion_devolucion is null or condicion_devolucion in ('Bien', 'Con daño'));

create index if not exists prestamos_estado_idx  on public.prestamos (estado);
create index if not exists prestamos_equipo_idx  on public.prestamos (equipo_id);

-- ---------------------------------------------------------------------
-- 3. REGLAS (triggers)
-- ---------------------------------------------------------------------

-- Al registrar un préstamo: el equipo tiene que estar Disponible y pasa a Prestado.
create or replace function public.prestamo_al_retirar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if length(trim(coalesce(new.usuario_responsable, ''))) = 0 then
    raise exception 'FALTA_RESPONSABLE';
  end if;

  new.registrado_por            := auth.uid();
  new.fecha_retiro              := now();
  new.estado                    := 'Activo';
  new.fecha_devolucion          := null;
  new.recibido_por              := null;
  new.condicion_devolucion      := null;
  new.observaciones_devolucion  := null;

  perform set_config('equipos.por_prestamo', 'si', true);
  update public.equipos set estado = 'Prestado'
   where id = new.equipo_id and estado = 'Disponible';

  if not found then
    perform set_config('equipos.por_prestamo', '', true);
    if not exists (select 1 from public.equipos where id = new.equipo_id) then
      raise exception 'EQUIPO_INEXISTENTE';
    end if;
    raise exception 'EQUIPO_NO_DISPONIBLE';
  end if;

  perform set_config('equipos.por_prestamo', '', true);
  return new;
end;
$$;

drop trigger if exists trg_prestamo_al_retirar on public.prestamos;
create trigger trg_prestamo_al_retirar
  before insert on public.prestamos
  for each row execute function public.prestamo_al_retirar();

-- Al devolver: queda registrado quién lo recibió y el equipo cambia de estado.
-- Mientras está activo solo se puede extender la fecha prevista o corregir el contacto.
create or replace function public.prestamo_al_devolver()
returns trigger
language plpgsql
set search_path = public
as $$
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
    return new;
  end if;

  new.fecha_devolucion     := now();
  new.recibido_por         := auth.uid();
  new.condicion_devolucion := coalesce(new.condicion_devolucion, 'Bien');

  perform set_config('equipos.por_prestamo', 'si', true);
  update public.equipos
     set estado = case when new.condicion_devolucion = 'Con daño' then 'En mantenimiento' else 'Disponible' end
   where id = old.equipo_id;
  perform set_config('equipos.por_prestamo', '', true);
  return new;
end;
$$;

drop trigger if exists trg_prestamo_al_devolver on public.prestamos;
create trigger trg_prestamo_al_devolver
  before update on public.prestamos
  for each row execute function public.prestamo_al_devolver();

-- Equipos: sella quién y cuándo; el estado "Prestado" solo lo manejan los préstamos.
create or replace function public.sellar_equipo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  por_prestamo boolean := coalesce(current_setting('equipos.por_prestamo', true), '') = 'si';
begin
  if tg_op = 'INSERT' then
    if new.estado = 'Prestado' then raise exception 'ESTADO_PRESTADO_MANUAL'; end if;
    new.creado_por := auth.uid();
    new.creado_en  := now();
    return new;
  end if;

  if not por_prestamo then
    if new.estado is distinct from old.estado and (new.estado = 'Prestado' or old.estado = 'Prestado') then
      raise exception 'ESTADO_PRESTADO_MANUAL';
    end if;
    new.creado_por      := old.creado_por;
    new.creado_en       := old.creado_en;
    new.actualizado_por := auth.uid();
    new.actualizado_en  := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sellar_equipo on public.equipos;
create trigger trg_sellar_equipo
  before insert or update on public.equipos
  for each row execute function public.sellar_equipo();

-- Auditoría de altas y cambios de equipos (los cambios por préstamo ya quedan en prestamos).
create or replace function public.auditar_equipo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campos  text[] := array['codigo_serie', 'nombre', 'categoria', 'marca_modelo', 'ubicacion',
                          'estado', 'fecha_adquisicion', 'valor_compra', 'observaciones'];
  campo   text;
  antes   jsonb;
  despues jsonb;
  cambios jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria (tabla, registro_id, accion, cambios, usuario_id)
    values ('equipos', new.id, 'alta', jsonb_build_object('estado', jsonb_build_array(null, new.estado)), auth.uid());
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

drop trigger if exists trg_auditar_equipo on public.equipos;
create trigger trg_auditar_equipo
  after insert or update on public.equipos
  for each row execute function public.auditar_equipo();

-- ---------------------------------------------------------------------
-- 4. SEGURIDAD: sin borrar; los préstamos solo se devuelven o se extienden
-- ---------------------------------------------------------------------
drop policy if exists "equipos_todo"     on public.equipos;
drop policy if exists "prestamos_todo"   on public.prestamos;
drop policy if exists "equipos_leer"     on public.equipos;
drop policy if exists "equipos_alta"     on public.equipos;
drop policy if exists "equipos_editar"   on public.equipos;
drop policy if exists "prestamos_leer"   on public.prestamos;
drop policy if exists "prestamos_alta"   on public.prestamos;
drop policy if exists "prestamos_editar" on public.prestamos;

create policy "equipos_leer"     on public.equipos   for select to authenticated using (true);
create policy "equipos_alta"     on public.equipos   for insert to authenticated with check (true);
create policy "equipos_editar"   on public.equipos   for update to authenticated using (true) with check (true);
create policy "prestamos_leer"   on public.prestamos for select to authenticated using (true);
create policy "prestamos_alta"   on public.prestamos for insert to authenticated with check (true);
create policy "prestamos_editar" on public.prestamos for update to authenticated using (true) with check (true);

revoke all on public.equipos, public.prestamos from anon, authenticated;
grant select, insert, update on public.equipos to authenticated;
grant select, insert on public.prestamos to authenticated;
grant update (estado, condicion_devolucion, observaciones_devolucion, fecha_prevista, contacto)
  on public.prestamos to authenticated;

-- ---------------------------------------------------------------------
-- 5. VISTA DE EQUIPOS (con el préstamo activo y si está vencido)
-- ---------------------------------------------------------------------
create or replace view public.v_equipos
with (security_invoker = true) as
select e.*,
       p.id                   as prestamo_id,
       p.usuario_responsable  as prestado_a,
       p.contacto             as prestamo_contacto,
       p.practica_motivo      as prestamo_motivo,
       p.fecha_retiro         as prestamo_desde,
       p.fecha_prevista       as prestamo_hasta,
       (p.id is not null and p.fecha_prevista < (now() at time zone 'America/Montevideo')::date) as vencido
  from public.equipos e
  left join public.prestamos p on p.equipo_id = e.id and p.estado = 'Activo';

revoke all on public.v_equipos from anon;
grant select on public.v_equipos to authenticated;

-- ---------------------------------------------------------------------
-- 6. HISTORIAL UNIFICADO (insumos + equipos)
-- ---------------------------------------------------------------------
drop view if exists public.v_historial;
create view public.v_historial
with (security_invoker = true) as
-- Consumos de insumos
select 'insumos'::text  as modulo, 'consumo'::text as tipo, m.fecha_hora as fecha,
       m.insumo_id as item_id, i.nombre as item, i.codigo, i.unidad_medida,
       m.cantidad_retirada as cantidad, m.practica_motivo as motivo, m.responsable,
       null::jsonb as cambios, null::text as detalle, m.usuario_id,
       coalesce(nullif(pf.nombre, ''), pf.email) as usuario
  from public.movimientos_insumos m
  join public.insumos i on i.id = m.insumo_id
  left join public.perfiles pf on pf.id = m.usuario_id
union all
-- Altas y cambios de insumos
select 'insumos', a.accion, a.fecha, a.registro_id, i.nombre, i.codigo, i.unidad_medida,
       null, null, null, a.cambios, null, a.usuario_id, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.auditoria a
  join public.insumos i on i.id = a.registro_id
  left join public.perfiles pf on pf.id = a.usuario_id
 where a.tabla = 'insumos'
union all
-- Altas y cambios de equipos
select 'equipos', a.accion, a.fecha, a.registro_id, e.nombre, e.codigo_serie, null,
       null, null, null, a.cambios, null, a.usuario_id, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.auditoria a
  join public.equipos e on e.id = a.registro_id
  left join public.perfiles pf on pf.id = a.usuario_id
 where a.tabla = 'equipos'
union all
-- Préstamos
select 'equipos', 'prestamo', p.fecha_retiro, p.equipo_id, e.nombre, e.codigo_serie, null,
       null, p.practica_motivo, p.usuario_responsable, null,
       case when p.fecha_prevista is not null then 'Devolución prevista: ' || to_char(p.fecha_prevista, 'DD/MM/YYYY') end,
       p.registrado_por, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pf on pf.id = p.registrado_por
union all
-- Devoluciones
select 'equipos', 'devolucion', p.fecha_devolucion, p.equipo_id, e.nombre, e.codigo_serie, null,
       null, null, p.usuario_responsable, null,
       p.condicion_devolucion || coalesce(' · ' || nullif(trim(p.observaciones_devolucion), ''), ''),
       p.recibido_por, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pf on pf.id = p.recibido_por
 where p.estado = 'Devuelto';

revoke all on public.v_historial from anon;
grant select on public.v_historial to authenticated;

-- ---------------------------------------------------------------------
-- 7. TIEMPO REAL para equipos y préstamos
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['equipos', 'prestamos'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

select estado, count(*) as equipos from public.equipos group by estado order by estado;
