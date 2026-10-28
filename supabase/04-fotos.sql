-- =====================================================================
--  Control de Insumos — Fotos de insumos y equipos (Supabase Storage)
--  Ejecutar después de 03-equipos.sql. Se puede repetir.
--
--  - Bucket privado "fotos": solo usuarios con sesión pueden ver o subir.
--  - Cada insumo/equipo guarda la ruta de su foto (foto_path). La app sube
--    la foto reducida (≈100 KB) y una miniatura (…_mini.jpg, ≈10 KB).
--  - Límite por archivo: 2 MB; solo imágenes JPEG, WebP o PNG.
-- =====================================================================

-- 1. Bucket privado
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Permisos: usuarios con sesión pueden ver, subir, reemplazar y borrar fotos del bucket.
drop policy if exists "fotos_leer"   on storage.objects;
drop policy if exists "fotos_subir"  on storage.objects;
drop policy if exists "fotos_editar" on storage.objects;
drop policy if exists "fotos_borrar" on storage.objects;
create policy "fotos_leer"   on storage.objects for select to authenticated using (bucket_id = 'fotos');
create policy "fotos_subir"  on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
create policy "fotos_editar" on storage.objects for update to authenticated using (bucket_id = 'fotos') with check (bucket_id = 'fotos');
create policy "fotos_borrar" on storage.objects for delete to authenticated using (bucket_id = 'fotos');

-- 3. Columna con la ruta de la foto
alter table public.insumos add column if not exists foto_path text;
alter table public.equipos add column if not exists foto_path text;

-- 4. Recrear las vistas para que incluyan la columna nueva
drop view if exists public.v_insumos_estado;
create view public.v_insumos_estado
with (security_invoker = true) as
select i.*,
       case
         when i.stock_actual <= 0              then 'agotado'
         when i.stock_actual <= i.stock_minimo then 'bajo'
         else 'ok'
       end as estado_stock,
       round(i.stock_actual * i.ultimo_precio, 2) as valor_stock
  from public.insumos i;
revoke all on public.v_insumos_estado from anon;
grant select on public.v_insumos_estado to authenticated;

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

select id, public, file_size_limit from storage.buckets where id = 'fotos';
