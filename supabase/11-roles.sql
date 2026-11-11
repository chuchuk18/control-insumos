-- =====================================================================
--  StockLab — Roles de usuario, revisión y anulación
--  Ejecutar después de 10-moneda.sql. Se puede repetir.
--
--  Roles (perfiles.rol):
--  - admin     → todo: catálogo, precios, rollos, tipo de cambio, usuarios, aprobar y anular.
--  - operador  → registra consumos, préstamos y devoluciones. Quedan "pendientes" hasta que
--                un administrador los aprueba (el stock se descuenta igual, al instante).
--  - invitado  → solo consulta.
--  perfiles.activo = false → sin acceso a los datos (se conserva su historial).
--
--  Anular un consumo devuelve el stock (y el peso al rollo). Anular un préstamo activo deja
--  el equipo disponible. Lo anulado no cuenta en reportes y queda registrado en el historial.
-- =====================================================================

-- 1. Rol y estado de cada usuario
alter table public.perfiles add column if not exists rol    text not null default 'invitado';
alter table public.perfiles add column if not exists activo boolean not null default true;
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('admin', 'operador', 'invitado'));

-- Primera vez: quienes ya usaban la app pasan a operador y Richard Castro a administrador.
do $$
begin
  if not exists (select 1 from public.perfiles where rol = 'admin') then
    update public.perfiles set rol = 'operador' where rol = 'invitado';
    update public.perfiles set rol = 'admin' where lower(email) = 'richard.castro@utec.edu.uy';
    if not exists (select 1 from public.perfiles where rol = 'admin') then
      update public.perfiles set rol = 'admin'
       where id = (select id from public.perfiles order by creado_en limit 1);
    end if;
  end if;
end $$;

create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select case when p.activo then p.rol else 'inactivo' end from public.perfiles p where p.id = auth.uid()
$$;
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() = 'admin', false)
$$;
create or replace function public.puede_operar()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('admin', 'operador'), false)
$$;
create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('admin', 'operador', 'invitado'), false)
$$;
revoke execute on function public.mi_rol(), public.es_admin(), public.puede_operar(), public.usuario_activo() from public, anon;
grant execute on function public.mi_rol(), public.es_admin(), public.puede_operar(), public.usuario_activo() to authenticated;

-- 2. Permisos por rol. Se agregan políticas RESTRICTIVAS: se suman a las que ya existen.
--    Los cambios que hacen las propias reglas (descontar stock, prestar equipos) llevan su marca.
do $$
declare t text;
begin
  -- Usuario desactivado: no ve nada.
  foreach t in array array['insumos', 'movimientos_insumos', 'equipos', 'prestamos', 'rollos', 'tipos_cambio', 'auditoria'] loop
    execute format('drop policy if exists "rol_leer" on public.%I', t);
    execute format('create policy "rol_leer" on public.%I as restrictive for select to authenticated using (public.usuario_activo())', t);
  end loop;
end $$;

-- Catálogo, precios, rollos y tipo de cambio: solo administradores.
drop policy if exists "rol_alta"   on public.insumos;
drop policy if exists "rol_editar" on public.insumos;
create policy "rol_alta"   on public.insumos as restrictive for insert to authenticated with check (public.es_admin());
create policy "rol_editar" on public.insumos as restrictive for update to authenticated
  using (public.es_admin() or coalesce(current_setting('insumos.por_consumo', true), '') = 'si')
  with check (public.es_admin() or coalesce(current_setting('insumos.por_consumo', true), '') = 'si');

drop policy if exists "rol_alta"   on public.equipos;
drop policy if exists "rol_editar" on public.equipos;
create policy "rol_alta"   on public.equipos as restrictive for insert to authenticated with check (public.es_admin());
create policy "rol_editar" on public.equipos as restrictive for update to authenticated
  using (public.es_admin() or coalesce(current_setting('equipos.por_prestamo', true), '') = 'si')
  with check (public.es_admin() or coalesce(current_setting('equipos.por_prestamo', true), '') = 'si');

drop policy if exists "rol_alta"   on public.rollos;
drop policy if exists "rol_editar" on public.rollos;
create policy "rol_alta"   on public.rollos as restrictive for insert to authenticated with check (public.es_admin());
create policy "rol_editar" on public.rollos as restrictive for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "rol_alta" on public.tipos_cambio;
create policy "rol_alta" on public.tipos_cambio as restrictive for insert to authenticated with check (public.es_admin());

-- Consumos y préstamos: administradores y operadores.
drop policy if exists "rol_alta" on public.movimientos_insumos;
create policy "rol_alta" on public.movimientos_insumos as restrictive for insert to authenticated with check (public.puede_operar());
drop policy if exists "rol_alta"   on public.prestamos;
drop policy if exists "rol_editar" on public.prestamos;
create policy "rol_alta"   on public.prestamos as restrictive for insert to authenticated with check (public.puede_operar());
create policy "rol_editar" on public.prestamos as restrictive for update to authenticated using (public.puede_operar()) with check (public.puede_operar());

-- Fotos (catálogo): solo administradores suben, cambian o borran.
drop policy if exists "rol_fotos_subir"  on storage.objects;
drop policy if exists "rol_fotos_editar" on storage.objects;
drop policy if exists "rol_fotos_borrar" on storage.objects;
create policy "rol_fotos_subir"  on storage.objects as restrictive for insert to authenticated with check (bucket_id <> 'fotos' or public.es_admin());
create policy "rol_fotos_editar" on storage.objects as restrictive for update to authenticated using (bucket_id <> 'fotos' or public.es_admin());
create policy "rol_fotos_borrar" on storage.objects as restrictive for delete to authenticated using (bucket_id <> 'fotos' or public.es_admin());

-- 3. Revisión de consumos y préstamos
alter table public.movimientos_insumos add column if not exists revision         text not null default 'aprobado';
alter table public.movimientos_insumos add column if not exists revisado_por     uuid;
alter table public.movimientos_insumos add column if not exists revisado_en      timestamptz;
alter table public.movimientos_insumos add column if not exists motivo_anulacion text;
alter table public.movimientos_insumos drop constraint if exists movimientos_revision_check;
alter table public.movimientos_insumos add constraint movimientos_revision_check check (revision in ('pendiente', 'aprobado', 'anulado'));

alter table public.prestamos add column if not exists revision         text not null default 'aprobado';
alter table public.prestamos add column if not exists revisado_por     uuid;
alter table public.prestamos add column if not exists revisado_en      timestamptz;
alter table public.prestamos add column if not exists motivo_anulacion text;
alter table public.prestamos drop constraint if exists prestamos_revision_check;
alter table public.prestamos add constraint prestamos_revision_check check (revision in ('pendiente', 'aprobado', 'anulado'));
alter table public.prestamos drop constraint if exists prestamos_estado_check;
alter table public.prestamos add constraint prestamos_estado_check check (estado in ('Activo', 'Devuelto', 'Anulado'));
create index if not exists movimientos_revision_idx on public.movimientos_insumos (revision) where revision = 'pendiente';
create index if not exists prestamos_revision_idx   on public.prestamos (revision) where revision = 'pendiente';

-- Al registrar: lo del administrador queda aprobado; lo del operador, pendiente.
create or replace function public.marcar_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.es_admin() then
    new.revision := 'aprobado'; new.revisado_por := auth.uid(); new.revisado_en := now();
  else
    new.revision := 'pendiente'; new.revisado_por := null; new.revisado_en := null;
  end if;
  new.motivo_anulacion := null;
  return new;
end;
$$;
drop trigger if exists trg_marcar_revision on public.movimientos_insumos;
create trigger trg_marcar_revision before insert on public.movimientos_insumos
  for each row execute function public.marcar_revision();
drop trigger if exists trg_marcar_revision on public.prestamos;
create trigger trg_marcar_revision before insert on public.prestamos
  for each row execute function public.marcar_revision();

-- Devoluciones: un préstamo anulado no se puede devolver; las revisiones no pasan por la devolución.
create or replace function public.prestamo_al_devolver()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  conjunto boolean;
begin
  -- Aprobaciones y anulaciones del administrador (funciones revisar/anular) no pasan por acá.
  if coalesce(current_setting('stocklab.revision', true), '') = 'si' then
    return new;
  end if;
  if old.estado = 'Devuelto' then
    raise exception 'PRESTAMO_YA_DEVUELTO';
  end if;
  if old.estado = 'Anulado' then
    raise exception 'PRESTAMO_ANULADO';
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

-- Aprobar un consumo o préstamo pendiente (solo administradores).
create or replace function public.aprobar_registro(p_tipo text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'SOLO_ADMIN'; end if;
  perform set_config('stocklab.revision', 'si', true);
  if p_tipo = 'consumo' then
    update public.movimientos_insumos set revision = 'aprobado', revisado_por = auth.uid(), revisado_en = now()
     where id = p_id and revision = 'pendiente';
  elsif p_tipo = 'prestamo' then
    update public.prestamos set revision = 'aprobado', revisado_por = auth.uid(), revisado_en = now()
     where id = p_id and revision = 'pendiente';
  else
    raise exception 'TIPO_INVALIDO';
  end if;
  if not found then raise exception 'NO_PENDIENTE'; end if;
  perform set_config('stocklab.revision', '', true);
end;
$$;

-- Anular (rechazar o borrar) un consumo o préstamo: se revierte y queda en el historial.
create or replace function public.anular_registro(p_tipo text, p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.movimientos_insumos%rowtype;
  p public.prestamos%rowtype;
begin
  if not public.es_admin() then raise exception 'SOLO_ADMIN'; end if;
  if coalesce(length(trim(p_motivo)), 0) = 0 then raise exception 'FALTA_MOTIVO'; end if;

  if p_tipo = 'consumo' then
    select * into m from public.movimientos_insumos where id = p_id for update;
    if not found then raise exception 'NO_EXISTE'; end if;
    if m.revision = 'anulado' then raise exception 'YA_ANULADO'; end if;
    -- Devolver el stock (y el peso al rollo, si fue un consumo por rollo).
    perform set_config('insumos.por_consumo', 'si', true);
    update public.insumos set stock_actual = stock_actual + m.cantidad_retirada where id = m.insumo_id;
    if m.rollo_id is not null then
      update public.rollos
         set peso_actual_kg = peso_actual_kg + m.cantidad_retirada / nullif(factor, 0),
             estado = 'En uso', terminado_en = null
       where id = m.rollo_id;
    end if;
    perform set_config('insumos.por_consumo', '', true);
    update public.movimientos_insumos
       set revision = 'anulado', revisado_por = auth.uid(), revisado_en = now(), motivo_anulacion = trim(p_motivo)
     where id = p_id;

  elsif p_tipo = 'prestamo' then
    select * into p from public.prestamos where id = p_id for update;
    if not found then raise exception 'NO_EXISTE'; end if;
    if p.revision = 'anulado' then raise exception 'YA_ANULADO'; end if;
    perform set_config('stocklab.revision', 'si', true);
    if p.estado = 'Activo' then
      -- El equipo (y sus componentes, si es un conjunto) vuelve a estar disponible.
      perform set_config('equipos.por_prestamo', 'si', true);
      update public.equipos set estado = 'Disponible'
       where (id = p.equipo_id or conjunto_id = p.equipo_id) and estado = 'Prestado';
      perform set_config('equipos.por_prestamo', '', true);
      update public.prestamos set estado = 'Anulado' where id = p_id;
    end if;
    update public.prestamos
       set revision = 'anulado', revisado_por = auth.uid(), revisado_en = now(), motivo_anulacion = trim(p_motivo)
     where id = p_id;
    perform set_config('stocklab.revision', '', true);
  else
    raise exception 'TIPO_INVALIDO';
  end if;
end;
$$;

-- 4. Administración de usuarios
create or replace function public.cambiar_rol(p_usuario uuid, p_rol text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'SOLO_ADMIN'; end if;
  if p_rol not in ('admin', 'operador', 'invitado') then raise exception 'ROL_INVALIDO'; end if;
  if p_rol <> 'admin' and exists (select 1 from public.perfiles where id = p_usuario and rol = 'admin')
     and (select count(*) from public.perfiles where rol = 'admin' and activo) <= 1 then
    raise exception 'ULTIMO_ADMIN';
  end if;
  update public.perfiles set rol = p_rol where id = p_usuario;
  if not found then raise exception 'NO_EXISTE'; end if;
end;
$$;

create or replace function public.activar_usuario(p_usuario uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'SOLO_ADMIN'; end if;
  if p_usuario = auth.uid() and not p_activo then raise exception 'NO_A_SI_MISMO'; end if;
  update public.perfiles set activo = p_activo where id = p_usuario;
  if not found then raise exception 'NO_EXISTE'; end if;
end;
$$;

revoke execute on function public.aprobar_registro(text, bigint), public.anular_registro(text, bigint, text),
  public.cambiar_rol(uuid, text), public.activar_usuario(uuid, boolean) from public, anon;
grant execute on function public.aprobar_registro(text, bigint), public.anular_registro(text, bigint, text),
  public.cambiar_rol(uuid, text), public.activar_usuario(uuid, boolean) to authenticated;

-- 5. Vistas: lo anulado no cuenta en promedios ni reportes; el historial muestra las anulaciones.
drop view if exists public.v_insumos_estado;
create view public.v_insumos_estado
with (security_invoker = true) as
with calc as (
  -- Promedio real: consumo de las últimas 8 semanas dividido por las semanas con historial (mín. 1, máx. 8).
  select i.id,
         round(coalesce(h.total, 0) / greatest(1, least(8, coalesce(h.semanas, 1))), 3) as semanal,
         coalesce(h.semanas, 0) as semanas
    from public.insumos i
    left join lateral (
      select sum(m.cantidad_retirada) filter (where m.fecha_hora >= now() - interval '56 days') as total,
             ceil(extract(epoch from (now() - min(m.fecha_hora))) / 604800.0)::int as semanas
        from public.movimientos_insumos m
       where m.insumo_id = i.id and m.revision <> 'anulado'
    ) h on true
),
base as (
  select i.*,
         c.semanal  as consumo_semanal_calculado,
         least(c.semanas, 8) as semanas_historial,
         case when i.fuente_promedio = 'calculado' then c.semanal else i.consumo_semanal_manual end as consumo_semanal
    from public.insumos i
    join calc c on c.id = i.id
)
select b.*,
       case
         when b.stock_actual <= 0              then 'agotado'
         when b.stock_actual <= b.stock_minimo then 'bajo'
         else 'ok'
       end as estado_stock,
       -- Valor del stock en $ y en US$ (los precios en la otra moneda se convierten al tipo de cambio actual)
       round(b.stock_actual * case when b.moneda_precio = 'USD' then b.ultimo_precio * public.tipo_cambio_actual() else b.ultimo_precio end, 2) as valor_stock,
       round(b.stock_actual * case when b.moneda_precio = 'USD' then b.ultimo_precio else b.ultimo_precio / nullif(public.tipo_cambio_actual(), 0) end, 2) as valor_stock_usd,
       (select count(*) from public.rollos r where r.insumo_id = b.id and r.estado <> 'Terminado')::int as rollos_activos,
       (select count(*) from public.rollos r where r.insumo_id = b.id and r.estado = 'En uso')::int as rollos_en_uso,
       case when b.consumo_semanal > 0 then round(b.stock_actual / (b.consumo_semanal / 7), 1) end as dias_cobertura,
       case when b.consumo_semanal > 0
            then round(b.consumo_semanal / 7 * (b.plazo_reposicion_dias + b.dias_seguridad), 3) end as punto_pedido,
       case when b.consumo_semanal > 0
            then current_date + floor(b.stock_actual / (b.consumo_semanal / 7))::int end as fecha_quiebre,
       case
         when not (b.consumo_semanal > 0) then null
         when b.stock_actual <= b.consumo_semanal / 7 * (b.plazo_reposicion_dias + b.dias_seguridad) then 'pedir'
         when b.stock_actual <= b.consumo_semanal / 7 * (b.plazo_reposicion_dias + b.dias_seguridad + 7) then 'pronto'
       end as alerta_quiebre
  from base b;
revoke all on public.v_insumos_estado from anon;
grant select on public.v_insumos_estado to authenticated;

drop view if exists public.v_consumos;
create view public.v_consumos
with (security_invoker = true) as
select m.id,
       m.fecha_hora,
       (m.fecha_hora at time zone 'America/Montevideo')::date as dia,
       m.insumo_id,
       i.codigo,
       i.nombre              as insumo,
       i.categoria,
       i.unidad_medida,
       i.proveedor,
       m.cantidad_retirada   as cantidad,
       m.precio_unitario,
       round(m.cantidad_retirada * m.precio_unitario, 2) as costo,          -- en $ (al tipo de cambio del día)
       round(m.cantidad_retirada * m.precio_unitario / nullif(coalesce(m.tipo_cambio, public.tipo_cambio_actual()), 0), 2) as costo_usd,
       m.moneda_precio,
       m.precio_original,
       m.tipo_cambio,
       m.practica_motivo,
       m.responsable,
       m.usuario_id,
       coalesce(nullif(pf.nombre, ''), pf.email) as registrado_por,
       r.codigo              as rollo_codigo,
       m.peso_antes_kg,
       m.peso_despues_kg,
       m.revision
  from public.movimientos_insumos m
  join public.insumos i on i.id = m.insumo_id
  left join public.rollos r on r.id = m.rollo_id
  left join public.perfiles pf on pf.id = m.usuario_id
 where m.revision <> 'anulado';   -- lo anulado no cuenta en reportes
revoke all on public.v_consumos from anon;
grant select on public.v_consumos to authenticated;

drop view if exists public.v_prestamos;
create view public.v_prestamos
with (security_invoker = true) as
select p.id,
       p.equipo_id,
       e.codigo_serie,
       e.activo_fijo_utec,
       e.activo_fijo_n,
       e.nombre              as equipo,
       e.categoria,
       p.usuario_responsable,
       p.contacto,
       p.practica_motivo,
       p.fecha_retiro,
       p.fecha_prevista,
       p.fecha_devolucion,
       p.estado,
       p.condicion_devolucion,
       p.observaciones_retiro,
       p.observaciones_devolucion,
       case
         when p.fecha_prevista is null then false
         when p.fecha_devolucion is not null
           then (p.fecha_devolucion at time zone 'America/Montevideo')::date > p.fecha_prevista
         else p.fecha_prevista < (now() at time zone 'America/Montevideo')::date
       end as fuera_de_plazo,
       round((extract(epoch from (coalesce(p.fecha_devolucion, now()) - p.fecha_retiro)) / 86400)::numeric, 1) as dias,
       coalesce(nullif(pr.nombre, ''), pr.email) as registrado_por,
       coalesce(nullif(pd.nombre, ''), pd.email) as recibido_por,
       p.revision
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pr on pr.id = p.registrado_por
  left join public.perfiles pd on pd.id = p.recibido_por
 where p.revision <> 'anulado';
revoke all on public.v_prestamos from anon;
grant select on public.v_prestamos to authenticated;

drop view if exists public.v_historial;
create view public.v_historial
with (security_invoker = true) as
select 'insumos'::text  as modulo, 'consumo'::text as tipo, m.fecha_hora as fecha,
       m.insumo_id as item_id, i.nombre as item, i.codigo, i.unidad_medida,
       m.cantidad_retirada as cantidad, m.practica_motivo as motivo, m.responsable,
       null::jsonb as cambios,
       case when m.rollo_id is not null then
         'Rollo ' || r.codigo || ' · ' || replace(to_char(m.peso_antes_kg, 'FM999990.000'), '.', ',') || ' → ' ||
         replace(to_char(coalesce(m.peso_despues_kg, r.tara_kg), 'FM999990.000'), '.', ',') || ' kg' ||
         case when m.cerrar_rollo then ' · rollo terminado' else '' end
       end as detalle,
       m.usuario_id,
       coalesce(nullif(pf.nombre, ''), pf.email) as usuario
  from public.movimientos_insumos m
  join public.insumos i on i.id = m.insumo_id
  left join public.rollos r on r.id = m.rollo_id
  left join public.perfiles pf on pf.id = m.usuario_id
union all
select 'insumos', 'entrada', r.recibido_en, r.insumo_id, i.nombre, i.codigo, i.unidad_medida,
       round((r.peso_inicial_kg - r.tara_kg) * r.factor, 3), 'Rollo ' || r.codigo, null, null,
       concat_ws(' · ', 'Peso bruto ' || replace(to_char(r.peso_inicial_kg, 'FM999990.000'), '.', ',') || ' kg',
                 case when r.precio is not null then '$ ' || replace(to_char(r.precio, 'FM999999990.00'), '.', ',') end),
       r.creado_por, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.rollos r
  join public.insumos i on i.id = r.insumo_id
  left join public.perfiles pf on pf.id = r.creado_por
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
 where p.estado = 'Devuelto'
union all
-- Anulaciones hechas por un administrador
select 'insumos', 'anulacion', m.revisado_en, m.insumo_id, i.nombre, i.codigo, i.unidad_medida,
       m.cantidad_retirada, m.practica_motivo, m.responsable, null,
       concat_ws(' · ', 'Consumo anulado', nullif(trim(m.motivo_anulacion), '')),
       m.revisado_por, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.movimientos_insumos m
  join public.insumos i on i.id = m.insumo_id
  left join public.perfiles pf on pf.id = m.revisado_por
 where m.revision = 'anulado'
union all
select 'equipos', 'anulacion', p.revisado_en, p.equipo_id, e.nombre, e.codigo_serie, null,
       null, p.practica_motivo, p.usuario_responsable, null,
       concat_ws(' · ', 'Préstamo anulado', nullif(trim(p.motivo_anulacion), '')),
       p.revisado_por, coalesce(nullif(pf.nombre, ''), pf.email)
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pf on pf.id = p.revisado_por
 where p.revision = 'anulado';
revoke all on public.v_historial from anon;
grant select on public.v_historial to authenticated;

-- 6. Tiempo real para perfiles (cambios de rol al instante)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'perfiles') then
    alter publication supabase_realtime add table public.perfiles;
  end if;
end $$;

select email, nombre, rol, activo from public.perfiles order by rol, email;
