# Control de Insumos — versión web

App para registrar el consumo y la baja de insumos en prácticas académicas.

**Autor:** Tecnólogo Richard Castro (2026). Laboratorio de Logística, ITRSO, UTEC. Diseño, desarrollo y puesta en marcha del sistema.
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
| `supabase/07-conjuntos.sql` | Supabase | Conjuntos de equipos: armado, préstamo y devolución por partes (ejecutar después de `06`) |
| `supabase/08-rollos.sql` | Supabase | Seguimiento por rollo (film, cintas): entradas, consumo por pesada (ejecutar después de `07`) |
| `supabase/09-alarma-quiebre.sql` | Supabase | Alarma de quiebre: consumo promedio, demora del proveedor, punto de pedido (ejecutar después de `08`) |
| `supabase/10-moneda.sql` | Supabase | Precios en pesos o dólares y tipo de cambio (ejecutar después de `09`) |

La clave `anon` es pública por diseño. La seguridad la dan las reglas de la base:
sin sesión iniciada no se puede leer ni modificar nada, y el registro público está desactivado.

## Reglas de negocio (en la base)

- Al registrar un retiro se descuenta el stock en la misma operación. Si no alcanza el stock,
  se rechaza, aunque dos personas retiren a la vez.
- No se permite stock negativo ni cantidades ≤ 0.
- Los movimientos quedan como historial: no se editan ni se borran, y registran qué usuario los cargó.
- Alerta de reposición cuando el stock es igual o menor al mínimo.
- Código y nombre de insumo únicos (sin distinguir mayúsculas).

## Alarma de quiebre de stock

- En la ficha de cada insumo (**Alarma de quiebre**): consumo promedio por semana, demora del proveedor y margen de
  seguridad, en días.
- **Promedio manual** (el valor cargado) o **calculado** (consumo real de las últimas 8 semanas; si hay menos historial,
  divide por las semanas que hay). Se puede pasar de uno a otro en cualquier momento; la ficha muestra los dos.
- La app calcula cuántos días alcanza el stock y el **punto de pedido** = consumo diario × (demora + margen):
  - **Pedir ya**: el stock ya está en el punto de pedido o por debajo.
  - **Pedir pronto**: llega al punto de pedido en menos de una semana.
- Se ve en el **Panel** (*Riesgo de quiebre de stock*), en la tabla de Insumos y en la hoja *Stock actual* del Excel.
- Es independiente del *stock mínimo*, que sigue funcionando igual.

## Modo oscuro

- Botón de luna/sol en el encabezado para cambiar entre claro y oscuro. En **Mi cuenta → Apariencia** se elige Automático (sigue al celular o la PC), Claro u Oscuro. Se recuerda en cada dispositivo.
- Los colores salen de variables CSS en `estilos/entrada.css`; las etiquetas QR y la impresión siempre salen en claro.

## Moneda: pesos y dólares

- Cada insumo, rollo y equipo tiene su precio en **$ (UYU)** o **US$ (USD)**.
- El **tipo de cambio** (1 US$ = $ X) se carga en el botón "Tipo de cambio" (Insumos, Reportes o el Panel), con fecha y fuente (por defecto BCU). Queda un historial.
- Cada consumo guarda el tipo de cambio de ese día: los costos pasados no cambian aunque después cambie el dólar.
- El valor del stock, los reportes y el Excel se pueden ver en pesos o en dólares (botón **$ / US$** en Reportes). El Excel trae ambos.
- Si hay precios en US$ y todavía no se cargó ningún tipo de cambio, esos costos quedan sin calcular y la app lo avisa.

## Rollos (film stretch, cintas)

- **Se controla en kg**, lo que mide la balanza: stock, consumos, mínimos y alarmas. Al marcar *Controlar por rollo* la
  unidad del insumo queda en kg.
- **Configurar** (ficha del insumo): peso bruto de un rollo nuevo y peso del cono vacío. Opcional: **referencia por rollo**
  (por ejemplo 100 m) para mostrar equivalencias (≈ rollos, ≈ metros); no cambia el control.
- **Recibir rollos** (Insumos → *Rollos* → *Registrar entrada*): cantidad, peso bruto y precio de cada rollo. Suma stock,
  actualiza el precio por kg y genera códigos (`EMB-001-R001`…) con sus **etiquetas QR**.
- **Registrar consumo**: se elige el rollo (la app sugiere primero el abierto y después el más viejo) y se carga el **peso
  después de la práctica**: la base calcula los kg usados (y muestra ≈ metros si hay referencia). *El rollo se terminó*
  da por usado lo que quede.
- Al escanear la etiqueta de un rollo se abre *Registrar consumo* con ese rollo elegido.
- El stock de un insumo por rollo es la suma de sus rollos y no se edita a mano. Cada rollo guarda su cono y su precio al
  recibirlo, así que cambiar la ficha después solo afecta a los rollos nuevos.
- Al activar el control por rollo en un insumo que ya tenía stock, el stock arranca en 0: registrá los rollos que hay.
- Historial muestra entradas y pesadas (`Rollo EMB-001-R001 · 2,600 → 2,250 kg`); el Excel suma la hoja **Rollos**.

## Equipos (control de activos y préstamos)

- **Inventario:** N.º de serie, **activo fijo UTEC**, **activo fijo N**, nombre, categoría, marca/modelo, ubicación, fecha y valor de compra, observaciones.
- Los códigos de activo fijo son opcionales y no se pueden repetir entre equipos. Se buscan desde la lista,
  salen en las etiquetas QR, en el historial de cambios y en el Excel.
- **Conjuntos** (p. ej. *Pórtico RF* = lector + 4 antenas): en la ficha del equipo, **Es un conjunto** →
  agregar los componentes. Cada componente pertenece a un solo conjunto y conserva sus códigos de activo fijo.
  - Se prestan juntos: al prestar el conjunto, todos los componentes pasan a *Prestado*; no se prestan por separado.
  - Para prestar, todas las partes tienen que estar *Disponibles*; si no, la app avisa cuál falta.
  - Al recibir, se desmarca lo que volvió con daño o no volvió: eso pasa a *En mantenimiento* y el resto queda disponible.
  - Mientras está prestado no se agregan ni se sacan componentes. Los cambios de armado quedan en el Historial.
  - El QR de un componente abre su conjunto. En el Excel, la hoja Equipos indica el tipo y el conjunto de cada uno.
- **Estados:** Disponible · Prestado · En mantenimiento · De baja. *Prestado* lo manejan solo los préstamos.
- **Prestar:** quién retira, contacto, práctica/motivo y fecha de devolución. Solo se presta lo que está *Disponible*.
- **Recibir:** si vuelve con daño pasa a *En mantenimiento*; si no, a *Disponible*. También se puede extender el plazo.
- **Vencidos:** préstamos con la fecha de devolución pasada; se ven en Equipos y en el Panel.
- **Etiquetas QR:** botón *Etiquetas QR* → *Imprimir*. Al escanear una etiqueta se abre la app directo
  para prestar o recibir ese equipo (con la sesión iniciada en el celular).
- Los préstamos no se borran y guardan quién los registró y quién recibió la devolución.

## Fotos

- Cada insumo y equipo puede tener una foto (desde la cámara o la galería) al darlo de alta o editarlo.
- Apenas se elige, la app la reduce (también fotos de 50 MP de celulares nuevos): versión de máx. 1024 px
  (~100–150 KB) y miniatura de 240 px (~5–10 KB), y muestra el tamaño final. Solo eso se sube.
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
  (después `02-usuarios-y-auditoria.sql`, `03-equipos.sql`, `04-fotos.sql`, `05-reportes.sql`, `06-activos-fijos.sql`, `07-conjuntos.sql`, `08-rollos.sql`, `09-alarma-quiebre.sql`, `10-moneda.sql` y `datos-iniciales.sql` para los datos de ejemplo).

## Instalar en el celular

En celulares y tabletas la barra de navegación queda siempre abajo, también con el teléfono en horizontal.


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

- Entradas de stock para insumos que no van por rollo.
