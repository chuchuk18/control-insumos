-- =====================================================================
--  Control de Insumos — Datos para reportes
--  Ejecutar después de 04-fotos.sql. Se puede repetir.
--
--  - Cada consumo guarda el precio unitario vigente al momento del retiro,
--    así los costos de meses anteriores no cambian si después sube el precio.
--    (Los consumos ya cargados toman el último precio actual del insumo.)
--  - v_consumos: consumos con datos del insumo, costo y quién lo registró.
--  - v_prestamos: préstamos con datos del equipo, duración y si se pasó del plazo.
-- =====================================================================

-- 1. Precio unitario en cada consumo
alter table public.movimientos_insumos add column if not exists precio_unitario numeric(14,4);

update public.movimientos_insumos m
   set precio_unitario = i.ultimo_precio
  from public.insumos i
 where i.id = m.insumo_id
   and m.precio_unitario is null
   and i.ultimo_precio is not null;

-- La base completa usuario, fecha y precio: no se pueden cargar desde la app.
create or replace function public.sellar_movimiento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.usuario_id := auth.uid();
  new.fecha_hora := now();
  new.precio_unitario := (select ultimo_precio from public.insumos where id = new.insumo_id);
  return new;
end;
$$;

-- 2. Consumos listos para reportar
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
       round(m.cantidad_retirada * m.precio_unitario, 2) as costo,
       m.practica_motivo,
       m.responsable,
       m.usuario_id,
       coalesce(nullif(pf.nombre, ''), pf.email) as registrado_por
  from public.movimientos_insumos m
  join public.insumos i on i.id = m.insumo_id
  left join public.perfiles pf on pf.id = m.usuario_id;

revoke all on public.v_consumos from anon;
grant select on public.v_consumos to authenticated;

-- 3. Préstamos listos para reportar
drop view if exists public.v_prestamos;
create view public.v_prestamos
with (security_invoker = true) as
select p.id,
       p.equipo_id,
       e.codigo_serie,
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
       coalesce(nullif(pd.nombre, ''), pd.email) as recibido_por
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pr on pr.id = p.registrado_por
  left join public.perfiles pd on pd.id = p.recibido_por;

revoke all on public.v_prestamos from anon;
grant select on public.v_prestamos to authenticated;

create index if not exists prestamos_retiro_idx on public.prestamos (fecha_retiro desc);

select (select count(*) from public.v_consumos)  as consumos,
       (select count(*) from public.v_consumos where costo is not null) as consumos_con_costo,
       (select count(*) from public.v_prestamos) as prestamos;
