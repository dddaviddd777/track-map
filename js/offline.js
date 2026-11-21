// Descàrrega de mapes per fer-los servir sense cobertura.
// Les tessel·les es guarden a la Cache del navegador; el service worker (sw.js) les serveix quan no hi ha xarxa.

import { tilesAroundTrack, addTileRange } from './geo.js';

export const TILE_CACHE = 'tiles-v1';
export const MIN_ZOOM = 12;

function urlFor(def, key) {
  const [z, x, y] = key.split('/');
  return def.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// Zoom del servidor que es fa servir per a un zoom del mapa (té en compte les tessel·les de 512 px).
function urlZooms(def, minZoom, maxZoom) {
  const zs = new Set();
  for (let z = minZoom; z <= maxZoom; z++) zs.add(Math.min(z, def.maxNativeZoom) + def.zoomOffset);
  return [...zs];
}

/** Llista d'URL de tessel·les al voltant d'un track. */
export function planForTrack(defs, points, buffer, maxZoom) {
  return defs.map(def => {
    const set = new Set();
    for (const z of urlZooms(def, MIN_ZOOM, maxZoom)) tilesAroundTrack(set, points, z, buffer);
    return { def, urls: [...set].map(k => urlFor(def, k)) };
  });
}

/** Llista d'URL de tessel·les per a un rectangle del mapa. */
export function planForBounds(defs, bounds, minZoom, maxZoom) {
  return defs.map(def => {
    const set = new Set();
    for (const z of urlZooms(def, minZoom, maxZoom)) {
      addTileRange(set, z, bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast());
    }
    return { def, urls: [...set].map(k => urlFor(def, k)) };
  });
}

export function estimate(plan) {
  let tiles = 0, bytes = 0;
  for (const p of plan) { tiles += p.urls.length; bytes += p.urls.length * p.def.avgKB * 1024; }
  return { tiles, bytes };
}

async function fetchWithRetry(url, signal, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { mode: 'cors', signal });
      if (r.ok || r.status === 404 || i >= tries - 1) return r;
    } catch (e) {
      if (signal?.aborted || i >= tries - 1) throw e;
    }
    await new Promise(res => setTimeout(res, 600 * (i + 1)));
  }
}

/**
 * Descarrega les tessel·les que encara no estan guardades.
 * onProgress({ done, total, bytes, failed })
 */
export async function download(plan, { onProgress, signal, concurrency = 6 } = {}) {
  const cache = await caches.open(TILE_CACHE);
  const urls = plan.flatMap(p => p.urls);
  const total = urls.length;
  let next = 0, done = 0, bytes = 0, failed = 0;
  let totalBytes = 0;   // tot el que ocupa aquesta zona, incloent-hi el que ja estava guardat

  async function worker() {
    while (next < total && !signal?.aborted) {
      const url = urls[next++];
      try {
        const hit = await cache.match(url);
        if (hit) {
          totalBytes += Number(hit.headers.get('content-length')) || 0;
        } else {
          const r = await fetchWithRetry(url, signal);
          if (r.ok) {
            const blob = await r.clone().blob();
            bytes += blob.size;
            totalBytes += blob.size;
            await cache.put(url, r);
          } else if (r.status !== 404) {
            failed++;  // 404 = fora de la zona amb mapa, no és un error
          }
        }
      } catch {
        if (signal?.aborted) return;
        failed++;
      }
      done++;
      onProgress?.({ done, total, bytes, failed });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { done, total, bytes, totalBytes, failed, aborted: !!signal?.aborted };
}

export async function storageInfo() {
  let tiles = null;
  try { tiles = (await (await caches.open(TILE_CACHE)).keys()).length; } catch { /* sense Cache API */ }
  let usage = null, quota = null, persisted = null;
  try { ({ usage, quota } = await navigator.storage.estimate()); } catch { /* no disponible */ }
  try { persisted = await navigator.storage.persisted(); } catch { /* no disponible */ }
  return { tiles, usage, quota, persisted };
}

export async function requestPersistence() {
  try { return await navigator.storage.persist(); } catch { return false; }
}

export const clearTiles = () => caches.delete(TILE_CACHE);

// --- Gestió de l'espai ---------------------------------------------------------

/** URL de les tessel·les que pertanyen a un track amb mapes guardats. */
export function urlsForTrack(rec, layerById) {
  const o = rec.offline;
  if (!o) return new Set();
  const defs = (o.layers || []).map(layerById);
  const plan = planForTrack(defs, rec.points, o.buffer || 500, o.maxZoom || 17);
  return new Set(plan.flatMap(p => p.urls));
}

/** URL de les tessel·les d'una zona descarregada. */
export function urlsForArea(area, layerById) {
  const [s, w, n, e] = area.bounds;
  const bounds = L.latLngBounds([s, w], [n, e]);
  const plan = planForBounds(area.layers.map(layerById), bounds, area.minZoom, area.maxZoom);
  return new Set(plan.flatMap(p => p.urls));
}

/** Mida de cada tessel·la guardada: Map(url → bytes). */
export async function cachedTileSizes() {
  const sizes = new Map();
  const cache = await caches.open(TILE_CACHE);
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    let b = Number(res?.headers.get('content-length')) || 0;
    if (!b && res) b = (await res.blob()).size;
    sizes.set(req.url, b);
  }
  return sizes;
}

/** Esborra unes tessel·les concretes. Torna quantes n'ha esborrat. */
export async function deleteTiles(urls) {
  const cache = await caches.open(TILE_CACHE);
  let n = 0;
  for (const u of urls) if (await cache.delete(u)) n++;
  return n;
}
