// Service worker: fa que l'app i els mapes funcionin sense connexió.
// Quan canviïs fitxers de l'app, puja el número de versió perquè els mòbils s'actualitzin.
const APP_CACHE = 'app-v1';
const TILE_CACHE = 'tiles-v1';
const TILE_HOSTS = ['geoserveis.icgc.cat'];

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/geo.js',
  './js/gpx.js',
  './js/layers.js',
  './js/offline.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('app-') && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(tile(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(appFile(req, event));
  }
});

// Mapes: primer el que hi ha guardat; si no, internet (i es guarda per a la propera vegada).
async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') cache.put(req.url, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Sense connexió' });
  }
}

// Fitxers de l'app: es serveixen de seguida des de la memòria i s'actualitzen en segon pla.
async function appFile(req, event) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  if (res) return res;
  if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
  return Response.error();
}
