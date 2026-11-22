// Altitud del terreny en qualsevol punt.
// 1) A Catalunya i amb connexió: model d'elevacions de l'ICGC (cel·les de 5 m, molt precís).
// 2) Si no: tessel·les de relleu «Terrarium» (tot el món, ~15-30 m). Es poden guardar per anar sense cobertura.

import { COVERAGE } from './layers.js';

export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const ICGC_WCS = 'https://geoserveis.icgc.cat/icc_mdt/wcs/service';
const TERRAIN_ZOOMS = [13, 12];   // primer el més detallat; el 12 com a reserva

// ---- Coordenades UTM 31N (ETRS89), les que fa servir l'ICGC

function toUtm31(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = lat * Math.PI / 180, lam = (lon - 3) * Math.PI / 180;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * lam;
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));
  const x = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x, y];
}

const inCoverage = (lat, lon) =>
  lat >= COVERAGE[0][0] && lat <= COVERAGE[1][0] && lon >= COVERAGE[0][1] && lon <= COVERAGE[1][1];

async function icgcElevation(lat, lon, timeoutMs = 4000) {
  const [x, y] = toUtm31(lat, lon);
  // Quadrat de 2×2 cel·les de 5 m centrat al punt: la mitjana és la interpolació al centre
  const bbox = [x - 5, y - 5, x + 5, y + 5].map(v => v.toFixed(1)).join(',');
  const url = `${ICGC_WCS}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE=icc%3Amet&CRS=EPSG%3A25831`
    + `&BBOX=${bbox}&WIDTH=2&HEIGHT=2&FORMAT=ARCGRID`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const lines = (await r.text()).trim().split(/\r?\n/);
    const nodata = Number((lines.find(l => /^NODATA_VALUE/i.test(l)) || '').split(/\s+/)[1] ?? -9999);
    const vals = lines.filter(l => !/^[A-Z_]+\s/i.test(l)).join(' ').trim().split(/\s+/).map(Number)
      .filter(v => Number.isFinite(v) && v !== nodata && v > -500);
    if (vals.length < 4) return null;    // fora de Catalunya (sense dades)
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Tessel·les Terrarium: altitud = R·256 + G + B/256 − 32768

const tileMemo = new Map();   // "z/x/y" → Promise<Float32Array|null>
const MEMO_MAX = 40;

export const terrainUrl = (z, x, y) => TERRAIN_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);

function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileMemo.has(key)) return tileMemo.get(key);
  const p = (async () => {
    try {
      const r = await fetch(terrainUrl(z, x, y), { mode: 'cors' });
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const cv = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(256, 256)
        : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      return out;
    } catch {
      return null;
    }
  })();
  tileMemo.set(key, p);
  p.then(v => { if (!v) tileMemo.delete(key); });   // si ha fallat (sense connexió), es podrà tornar a provar
  if (tileMemo.size > MEMO_MAX) tileMemo.delete(tileMemo.keys().next().value);
  return p;
}

function tilePos(lat, lon, z) {
  const n = 2 ** z;
  const fx = (lon + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  return { x, y, px: (fx - x) * 256 - 0.5, py: (fy - y) * 256 - 0.5 };
}

function sample(data, px, py) {
  const cl = v => Math.max(0, Math.min(255, v));
  const x0 = cl(Math.floor(px)), y0 = cl(Math.floor(py)), x1 = cl(x0 + 1), y1 = cl(y0 + 1);
  const tx = Math.max(0, Math.min(1, px - x0)), ty = Math.max(0, Math.min(1, py - y0));
  const v = (x, y) => data[y * 256 + x];
  return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
}

async function terrainElevation(lat, lon) {
  for (const z of TERRAIN_ZOOMS) {
    const t = tilePos(lat, lon, z);
    const data = await loadTile(z, t.x, t.y);
    if (data) return sample(data, t.px, t.py);
  }
  return null;
}

/**
 * Altitud del terreny en un punt: { ele, src: 'icgc' | 'relleu' } o null si no es pot saber
 * (per exemple, sense connexió i sense el relleu guardat).
 */
export async function elevationAt(lat, lon) {
  if (navigator.onLine !== false && inCoverage(lat, lon)) {
    const e = await icgcElevation(lat, lon);
    if (e != null) return { ele: e, src: 'icgc' };
  }
  const e = await terrainElevation(lat, lon);
  return e != null ? { ele: e, src: 'relleu' } : null;
}

/** Altitud de molts punts (per a tracks sense altitud). Torna un array amb null on no s'ha pogut. */
export async function elevationsFor(points) {
  const out = new Array(points.length).fill(null);
  for (const z of TERRAIN_ZOOMS) {
    const pending = [];
    points.forEach((p, i) => { if (out[i] == null) pending.push(i); });
    if (!pending.length) break;
    const byTile = new Map();
    for (const i of pending) {
      const t = tilePos(points[i][0], points[i][1], z);
      const key = `${t.x}/${t.y}`;
      if (!byTile.has(key)) byTile.set(key, { x: t.x, y: t.y, items: [] });
      byTile.get(key).items.push([i, t.px, t.py]);
    }
    await Promise.all([...byTile.values()].map(async ({ x, y, items }) => {
      const data = await loadTile(z, x, y);
      if (data) for (const [i, px, py] of items) out[i] = Math.round(sample(data, px, py) * 10) / 10;
    }));
  }
  return out;
}
