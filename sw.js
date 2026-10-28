// Service worker: guarda la "cáscara" de la app para que abra rápido.
// Los datos (Supabase) siempre se piden en vivo: nunca se muestra stock viejo.
const CACHE = 'insumos-web-v4';
const CASCARA = ['./', 'index.html', 'app.js', 'config.js', 'styles.css', 'manifest.webmanifest',
  'vendor/supabase.js', 'vendor/qrcode.js', 'icons/icon-192.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCARA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  // Solo archivos propios de la app; Supabase (otro dominio) pasa directo.
  if (ev.request.method !== 'GET' || url.origin !== location.origin) return;

  // Primero la red (versión más nueva); sin conexión, lo guardado.
  ev.respondWith(
    fetch(ev.request)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(ev.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(ev.request).then((r) => r || caches.match('./'))),
  );
});
