-- =====================================================================
--  Control de Insumos — Alarma de quiebre de stock
--  Ejecutar después de 08-rollos.sql. Se puede repetir.
--
--  Por insumo:
--  - consumo_semanal_manual: promedio cargado a mano (en la unidad del insumo, por semana).
--  - fuente_promedio: 'manual' o 'calculado' (promedio real de las últimas 8 semanas).
--  - plazo_reposicion_dias: lo que tarda el proveedor en entregar.
--  - dias_seguridad: margen extra para no quedarse sin stock.
--
--  La vista calcula días de cobertura, punto de pedido y la alerta:
--  - 'pedir'  → el stock ya no alcanza para cubrir plazo + seguridad: pedir ahora.
--  - 'pronto' → lo alcanza en menos de una semana más: preparar el pedido.
-- =====================================================================

alter table public.insumos add column if not exists consumo_semanal_manual numeric(14,3)
  check (consumo_semanal_manual is null or consumo_semanal_manual >= 0);
alter table public.insumos add column if not exists fuente_promedio text not null default 'manual'
  check (fuente_promedio in ('manual', 'calculado'));
alter table public.insumos add column if not exists plazo_reposicion_dias integer not null default 7
  check (plazo_reposicion_dias between 0 and 365);
alter table public.insumos add column if not exists dias_seguridad integer not null default 3
  check (dias_seguridad between 0 and 365);

-- Auditoría: también los datos de la alarma
create or replace function public.auditar_insumo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campos  text[] := array['codigo', 'nombre', 'categoria', 'stock_actual', 'stock_minimo',
                          'unidad_medida', 'proveedor', 'ultimo_precio', 'fecha_ultimo_precio',
                          'control_por_rollo', 'tara_kg', 'peso_bruto_rollo_kg', 'contenido_por_rollo', 'unidad_referencia',
                          'consumo_semanal_manual', 'fuente_promedio', 'plazo_reposicion_dias', 'dias_seguridad'];
  campo   text;
  antes   jsonb;
  despues jsonb;
  cambios jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria (tabla, registro_id, accion, cambios, usuario_id)
    values ('insumos', new.id, 'alta',
            jsonb_build_object('stock_actual', jsonb_build_array(null, new.stock_actual)), auth.uid());
    return new;
  end if;

  if coalesce(current_setting('insumos.por_consumo', true), '') = 'si' then
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
    values ('insumos', new.id, 'edicion', cambios, auth.uid());
  end if;
  return new;
end;
$$;

-- Vista de insumos con cobertura y alerta de quiebre
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
       where m.insumo_id = i.id
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
       round(b.stock_actual * b.ultimo_precio, 2) as valor_stock,
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

select nombre, unidad_medida, stock_actual, consumo_semanal_calculado, dias_cobertura, alerta_quiebre
  from public.v_insumos_estado order by id;
