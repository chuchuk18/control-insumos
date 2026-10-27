// Configuración para regenerar styles.css si se cambian clases en index.html o app.js:
//   npx tailwindcss@3 -c estilos/tailwind.config.js -i estilos/entrada.css -o styles.css --minify
module.exports = {
  content: ['./index.html', './app.js'],
  theme: { extend: { colors: {
    marca: { 50:'#e5f6fc', 100:'#ccedf9', 200:'#99dbf3', 300:'#66c9ec', 400:'#33b7e6',
             500:'#00a9e0', 600:'#0090c0', 700:'#00759c', 800:'#005a78', 900:'#003f55' },
    titulo: '#1d559d',
  } } },
};
