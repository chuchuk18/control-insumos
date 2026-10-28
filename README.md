# Control de Insumos — versión web

App para registrar el consumo y la baja de insumos en prácticas académicas.
Funciona desde PC y celular, en cualquier red, y se instala en el celular como app.

- **Interfaz:** sitio estático (HTML + JavaScript + Tailwind compilado) publicado en GitHub Pages.
- **Datos y reglas:** Supabase (PostgreSQL), con inicio de sesión y actualización en vivo.

## Cómo funciona

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `index.html`, `app.js`, `styles.css` | GitHub Pages | Pantallas: Panel, Consumo, Insumos, Equipos, Historial, Reportes |
| `config.js` | GitHub Pages | Dirección del proyecto Supabase y clave pública (`anon`) |
| `supabase/schema.sql` | Supabase | Tablas, descuento automático de stock, seguridad, tiempo real |
| `supabase/02-usuarios-y-auditoria.sql` | Supabase | Perfiles, auditoría e historial (ejecutar después de `schema.sql`) |
| `supabase/03-equipos.sql` | Supabase | Control de activos y préstamos de equipos (ejecutar después de `02`) |
| `supabase/04-fotos.sql` | Supabase | Fotos de insumos y equipos en Storage (ejecutar después de `03`) |
| `supabase/05-reportes.sql` | Supabase | Precio histórico de cada consumo y vistas para reportes (ejecutar después de `04`) |
| `supabase/06-activos-fijos.sql` | Supabase | Códigos de activo fijo UTEC y N en equipos (ejecutar después de `05`) |

La clave `anon` es pública por diseño. La seguridad la dan las reglas de la base:
sin sesión iniciada no se puede leer ni modificar nada, y el registro público está desactivado.

## Reglas de negocio (en la base)

- Al registrar un retiro se descuenta el stock en la misma operación. Si no alcanza el stock,
  se rechaza, aunque dos personas retiren a la vez.
- No se permite stock negativo ni cantidades ≤ 0.
- Los movimientos quedan como historial: no se editan ni se borran, y registran qué usuario los cargó.
- Alerta de reposición cuando el stock es igual o menor al mínimo.
- Código y nombre de insumo únicos (sin distinguir mayúsculas).

## Equipos (control de activos y préstamos)

- **Inventario:** N.º de serie, **activo fijo UTEC**, **activo fijo N**, nombre, categoría, marca/modelo, ubicación, fecha y valor de compra, observaciones.
- Los códigos de activo fijo son opcionales y no se pueden repetir entre equipos. Se buscan desde la lista,
  salen en las etiquetas QR, en el historial de cambios y en el Excel.
- **Estados:** Disponible · Prestado · En mantenimiento · De baja. *Prestado* lo manejan solo los préstamos.
- **Prestar:** quién retira, contacto, práctica/motivo y fecha de devolución. Solo se presta lo que está *Disponible*.
- **Recibir:** si vuelve con daño pasa a *En mantenimiento*; si no, a *Disponible*. También se puede extender el plazo.
- **Vencidos:** préstamos con la fecha de devolución pasada; se ven en Equipos y en el Panel.
- **Etiquetas QR:** botón *Etiquetas QR* → *Imprimir*. Al escanear una etiqueta se abre la app directo
  para prestar o recibir ese equipo (con la sesión iniciada en el celular).
- Los préstamos no se borran y guardan quién los registró y quién recibió la devolución.

## Fotos

- Cada insumo y equipo puede tener una foto (desde la cámara o la galería) al darlo de alta o editarlo.
- Antes de subirla, la app la reduce: versión de máx. 1024 px (~100 KB) y miniatura de 240 px (~10 KB).
  Las listas cargan solo las miniaturas; tocándolas se ve la foto completa.
- Se ven en Panel, Insumos, Equipos, **Registrar consumo** (para identificar el producto) y al prestar o recibir.
- Se guardan en un bucket **privado** de Supabase Storage (`fotos`): solo las ven usuarios con sesión.
- Plan gratuito: 1 GB de almacenamiento (≈ 9.000 fotos) y 5 GB/mes de descarga.

## Reportes

- **Período:** últimos 7 o 30 días, este mes, mes anterior, últimos 3 meses, este año o fechas a elección.
  Filtro por categoría de insumo y selector **Medir por: Costo / Retiros**.
- **Indicadores:** costo de consumos, retiros, insumos usados y préstamos, con la variación contra el período anterior
  del mismo largo.
- **Gráficos:** consumo en el tiempo (por día, semana o mes según el largo del período), insumos más consumidos,
  por práctica, por categoría y quién retira. Pasando el mouse o tocando una barra se ve el detalle.
- **Proyección de reposición:** con el ritmo de consumo del período, cuántos días alcanza el stock de cada insumo,
  hasta qué fecha, y cuánto comprar para cubrir 30 días más el mínimo (con costo estimado).
- **Préstamos:** cantidad, devueltos, fuera de plazo, con daño, duración media y equipos más prestados.
- **Sin consumo:** insumos con stock que no se usaron en el período y el valor inmovilizado.
- **Excel:** descarga un archivo con hojas *Resumen, Consumos, Por insumo, Por práctica, Préstamos, Stock actual y Equipos*
  (fechas reales, montos en $ y filtros en los encabezados).
- **Imprimir / PDF:** imprime el reporte sin menús ni filtros; para PDF elegir *Guardar como PDF* en la impresora.
- Cada consumo guarda el **precio unitario del momento**, así el costo de meses anteriores no cambia si después
  sube el precio. Los consumos anteriores a este cambio toman el último precio que tenía el insumo.

## Usuarios y contraseñas

- **Dar de alta a alguien:** Supabase → Authentication → Users → *Add user* → *Send invitation*.
  Le llega un correo; al tocar el enlace, la app le pide **nombre y contraseña nueva**.
  (Alternativa: *Create new user* con una contraseña provisoria y *Auto Confirm User*; la persona
  la cambia desde **Mi cuenta**.)
- **Olvidé mi contraseña:** botón en la pantalla de ingreso → llega un correo con un enlace para crear una nueva.
- **Mi cuenta** (iniciales arriba a la derecha): cambiar nombre visible y contraseña, cerrar sesión.
- Nadie, ni el administrador, puede ver las contraseñas: Supabase las guarda cifradas.
- Los enlaces de los correos van a la *Site URL* de Supabase (Authentication → URL Configuration):
  tiene que ser la dirección pública de la app.
- El correo gratuito de Supabase permite **2 correos por hora** para todo el proyecto. Si se agota, se puede asignar
  una contraseña provisoria desde el SQL Editor (ver abajo) o configurar un servicio de correo propio (SMTP).

## Quién hizo qué

- Cada consumo guarda el usuario que lo cargó (además del *responsable* que retiró el material).
- Cada alta y modificación de insumos queda en `auditoria` con los valores anteriores y nuevos.
  Los ajustes manuales de stock se marcan como **Ajuste de stock**.
- La pestaña **Historial** muestra consumos, préstamos, devoluciones, altas y modificaciones, con filtros, y la lista de usuarios:
  quién está conectado ahora y el último acceso de cada uno.
- La base completa estos datos sola: no se pueden falsear desde la app.

## Administración

- **Contraseña provisoria sin correo** (SQL Editor; reemplazar contraseña y correo, no guardar la consulta):
  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('CONTRASEÑA', extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
   where email = 'persona@utec.edu.uy';
  ```
- **Respaldo de datos:** pestaña **Reportes** → período *Este año* (o fechas a elección) → **Excel**.
  También: Supabase → Table Editor → tabla → *Export to CSV*.
- **Volver a crear la base desde cero:** SQL Editor → pegar `supabase/schema.sql` → Run
  (después `02-usuarios-y-auditoria.sql`, `03-equipos.sql`, `04-fotos.sql`, `05-reportes.sql`, `06-activos-fijos.sql` y `datos-iniciales.sql` para los datos de ejemplo).

## Instalar en el celular

Abrir la dirección de la app → iniciar sesión → Android: menú ⋮ → *Instalar app* /
*Agregar a pantalla principal*; iPhone: Compartir → *Agregar a inicio*.
En la PC, el botón **Abrir en el celular** muestra un QR con la dirección.

## Cambiar estilos

Las clases de Tailwind se compilan en `styles.css`. Si agregás clases nuevas en `index.html` o `app.js`:

```bash
npx tailwindcss@3 -c estilos/tailwind.config.js -i estilos/entrada.css -o styles.css --minify
```

Colores institucionales: celeste `#00a9e0` (`marca-500`) y azul de títulos `#1d559d` (`titulo`).

## Próximos pasos sugeridos

- Movimientos de entrada/reposición (actualizando último precio y proveedor automáticamente).
