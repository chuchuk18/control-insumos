# Control de Insumos — versión web

App para registrar el consumo y la baja de insumos en prácticas académicas.
Funciona desde PC y celular, en cualquier red, y se instala en el celular como app.

- **Interfaz:** sitio estático (HTML + JavaScript + Tailwind compilado) publicado en GitHub Pages.
- **Datos y reglas:** Supabase (PostgreSQL), con inicio de sesión y actualización en vivo.

## Cómo funciona

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `index.html`, `app.js`, `styles.css` | GitHub Pages | Pantallas: Panel, Registrar consumo, Insumos, Historial |
| `config.js` | GitHub Pages | Dirección del proyecto Supabase y clave pública (`anon`) |
| `supabase/schema.sql` | Supabase | Tablas, descuento automático de stock, seguridad, tiempo real |
| `supabase/02-usuarios-y-auditoria.sql` | Supabase | Perfiles, auditoría e historial (ejecutar después de `schema.sql`) |

La clave `anon` es pública por diseño. La seguridad la dan las reglas de la base:
sin sesión iniciada no se puede leer ni modificar nada, y el registro público está desactivado.

## Reglas de negocio (en la base)

- Al registrar un retiro se descuenta el stock en la misma operación. Si no alcanza el stock,
  se rechaza, aunque dos personas retiren a la vez.
- No se permite stock negativo ni cantidades ≤ 0.
- Los movimientos quedan como historial: no se editan ni se borran, y registran qué usuario los cargó.
- Alerta de reposición cuando el stock es igual o menor al mínimo.
- Código y nombre de insumo únicos (sin distinguir mayúsculas).

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
- El correo gratuito de Supabase envía pocos mensajes por hora: alcanza para un laboratorio.

## Quién hizo qué

- Cada consumo guarda el usuario que lo cargó (además del *responsable* que retiró el material).
- Cada alta y modificación de insumos queda en `auditoria` con los valores anteriores y nuevos.
  Los ajustes manuales de stock se marcan como **Ajuste de stock**.
- La pestaña **Historial** muestra todo, con filtros por tipo y usuario, y la lista de usuarios:
  quién está conectado ahora y el último acceso de cada uno.
- La base completa estos datos sola: no se pueden falsear desde la app.

## Administración

- **Respaldo de datos:** Supabase → Table Editor → tabla → *Export to CSV*.
- **Volver a crear la base desde cero:** SQL Editor → pegar `supabase/schema.sql` → Run
  (después `supabase/02-usuarios-y-auditoria.sql`, y `supabase/datos-iniciales.sql` para los datos de ejemplo).

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
- Exportar historial de consumos a Excel por fecha o práctica.
- Módulo de préstamos de equipos (las tablas `equipos` y `prestamos` ya existen).
