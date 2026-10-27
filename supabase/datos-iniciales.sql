-- =====================================================================
--  Datos iniciales migrados desde la versión local (27/10/2026).
--  Ejecutar UNA vez, después de schema.sql. No duplica si se repite.
-- =====================================================================
insert into public.insumos (id, codigo, nombre, categoria, stock_actual, stock_minimo, unidad_medida,
                            proveedor, ultimo_precio, fecha_ultimo_precio)
values
  (1, 'EPP-001', 'Guantes de nitrilo (par)', 'EPP', 120, 40, 'pares', 'Distribuidora Sur', 18.5, '2026-10-15'),
  (2, 'EMB-001', 'Film stretch 50 cm', 'Embalaje', 8, 5, 'rollos', 'Embalajes del Este', 420, '2026-09-27'),
  (3, 'EMB-002', 'Cinta de embalaje 48 mm', 'Embalaje', 3, 6, 'rollos', 'Embalajes del Este', 95, '2026-09-27'),
  (4, 'IDN-001', 'Etiquetas térmicas 100x150', 'Identificación', 950, 300, 'unidades', 'Etiquetas Uruguay', 1.2, '2026-09-12'),
  (5, 'EMB-003', 'Precintos plásticos', 'Embalaje', 400, 100, 'unidades', 'Ferretería Central', 2.5, '2026-08-28'),
  (6, 'LIM-001', 'Alcohol 70%', 'Limpieza', 2500, 1000, 'ml', 'Distribuidora Sur', 0.32, '2026-10-07'),
  (7, 'EMB-004', 'Fleje de polipropileno', 'Embalaje', 0, 50, 'metros', 'Embalajes del Este', 6.8, '2026-07-29'),
  (8, 'LIB-001', 'Marcadores permanentes', 'Librería', 24, 10, 'unidades', 'Papelería Centro', 65, '2026-10-12')
on conflict (id) do nothing;

insert into public.equipos (codigo_serie, nombre, estado) values
  ('LECT-001', 'Lector de código de barras Zebra', 'Disponible'),
  ('TERM-001', 'Terminal portátil RF',             'Disponible'),
  ('BAL-001',  'Balanza de plataforma 300 kg',     'En mantenimiento')
on conflict (codigo_serie) do nothing;

-- Que los próximos insumos nuevos sigan la numeración.
select setval(pg_get_serial_sequence('public.insumos', 'id'), (select coalesce(max(id), 1) from public.insumos));
select count(*) as insumos_cargados from public.insumos;
