-- =====================================================================
--  Control de Insumos — Códigos de activo fijo de equipos
--  Ejecutar después de 05-reportes.sql. Se puede repetir.
--
--  - activo_fijo_utec: número de activo fijo UTEC.
--  - activo_fijo_n:    número de activo fijo N.
--  Ambos opcionales y únicos (sin distinguir mayúsculas) cuando se cargan.
--  Los cambios quedan en auditoría como el resto de los datos del equipo.
-- =====================================================================

-- 1. Columnas
alter table public.equipos add column if not exists activo_fijo_utec text;
alter table public.equipos add column if not exists activo_fijo_n    text;

-- Vacíos → null (para que no choquen con el índice único)
update public.equipos set activo_fijo_utec = null where trim(activo_fijo_utec) = '';
update public.equipos set activo_fijo_n    = null where trim(activo_fijo_n) = '';

create unique index if not exists equipos_activo_utec_unico on public.equipos (upper(activo_fijo_utec)) where activo_fijo_utec is not null;
create unique index if not exists equipos_activo_n_unico    on public.equipos (upper(activo_fijo_n))    where activo_fijo_n is not null;

-- 2. Auditoría: incluir los códigos de activo fijo
create or replace function public.auditar_equipo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  campos  text[] := array['codigo_serie', 'activo_fijo_utec', 'activo_fijo_n', 'nombre', 'categoria', 'marca_modelo',
                          'ubicacion', 'estado', 'fecha_adquisicion', 'valor_compra', 'observaciones'];
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

-- 3. Recrear las vistas para que incluyan las columnas nuevas
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
       (p.id is not null and p.fecha_prevista < (now() at time zone 'America/Montevideo')::date) as vencido
  from public.equipos e
  left join public.prestamos p on p.equipo_id = e.id and p.estado = 'Activo';
revoke all on public.v_equipos from anon;
grant select on public.v_equipos to authenticated;

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
       coalesce(nullif(pd.nombre, ''), pd.email) as recibido_por
  from public.prestamos p
  join public.equipos e on e.id = p.equipo_id
  left join public.perfiles pr on pr.id = p.registrado_por
  left join public.perfiles pd on pd.id = p.recibido_por;
revoke all on public.v_prestamos from anon;
grant select on public.v_prestamos to authenticated;

select codigo_serie, activo_fijo_utec, activo_fijo_n, nombre from public.equipos order by id;
