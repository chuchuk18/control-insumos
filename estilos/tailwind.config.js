// Configuración para regenerar styles.css si se cambian clases en index.html o app.js:
//   npx tailwindcss@3 -c estilos/tailwind.config.js -i estilos/entrada.css -o styles.css --minify
// Los colores salen de variables CSS (estilos/entrada.css) para poder cambiar a modo oscuro.
const tonos = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const paleta = (n) => Object.fromEntries(tonos.map((t) => [t, `rgb(var(--${n}-${t}) / <alpha-value>)`]));
module.exports = {
  content: ['./index.html', './app.js'],
  theme: { extend: {
    // Celulares y tabletas (pantalla táctil sin mouse): siempre con la barra de abajo, también en horizontal.
    screens: { tactil: { raw: '(hover: none) and (pointer: coarse)' } },
    borderColor: { DEFAULT: 'rgb(var(--slate-200) / <alpha-value>)' },
    colors: {
      slate: paleta('slate'), red: paleta('red'), amber: paleta('amber'), emerald: paleta('emerald'),
      violet: paleta('violet'), teal: paleta('teal'), marca: paleta('marca'),
      superficie: 'rgb(var(--superficie) / <alpha-value>)',   // fondo de tarjetas y ventanas
      tinta: '#0f172a',                                       // fondo oscuro fijo (avisos, visor de fotos)
      titulo: 'rgb(var(--titulo) / <alpha-value>)',
    },
  } },
};
