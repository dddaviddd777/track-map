// Càlculs geogràfics: distàncies, desnivells, posició sobre el track i tessel·les.

const R = 6371008.8;
const M_PER_DEG = 111320;
const rad = d => (d * Math.PI) / 180;

export function haversine(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(aLat, aLon, bLat, bLon) {
  const y = Math.sin(rad(bLon - aLon)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLon - aLon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Prepara un track per seguir-lo: distància acumulada i desnivell acumulat a cada punt.
 * points: [[lat, lon, ele|null], ...]
 */
export function analyse(points) {
  const n = points.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }

  // Desnivell amb histèresi de 3 m per no sumar el soroll del GPS.
  const gainCum = new Float64Array(n);
  const lossCum = new Float64Array(n);
  const hasEle = points.filter(p => p[2] != null).length > n * 0.8;
  let minEle = Infinity, maxEle = -Infinity;
  if (hasEle) {
    let ref = null, gain = 0, loss = 0;
    for (let i = 0; i < n; i++) {
      const e = points[i][2];
      if (e != null) {
        if (e < minEle) minEle = e;
        if (e > maxEle) maxEle = e;
        if (ref == null) ref = e;
        else if (e - ref >= 3) { gain += e - ref; ref = e; }
        else if (ref - e >= 3) { loss += ref - e; ref = e; }
      }
      gainCum[i] = gain;
      lossCum[i] = loss;
    }
  }
  return {
    cum, gainCum, lossCum, hasEle,
    distance: cum[n - 1] || 0,
    gain: hasEle ? gainCum[n - 1] : null,
    loss: hasEle ? lossCum[n - 1] : null,
    minEle: hasEle ? minEle : null,
    maxEle: hasEle ? maxEle : null,
  };
}

/**
 * Troba el punt del track més proper a la posició actual.
 * Si el track passa dues vegades pel mateix lloc (anada i tornada, bucles),
 * tria el tram més coherent amb el progrés anterior.
 */
export function locateOnTrack(points, cum, lat, lon, lastAlong) {
  const kx = M_PER_DEG * Math.cos(rad(lat));
  const ky = M_PER_DEG;
  const n = points.length;
  const cands = [];
  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const ax = (points[i][1] - lon) * kx, ay = (points[i][0] - lat) * ky;
    const bx = (points[i + 1][1] - lon) * kx, by = (points[i + 1][0] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best + 30) {
      if (d < best) best = d;
      cands.push({ i, t, d, along: cum[i] + t * (cum[i + 1] - cum[i]) });
    }
  }
  const near = cands.filter(c => c.d <= best + 30);
  let pick = near[0];
  for (const c of near) {
    // Sense progrés previ: el tram més proper; en cas d'empat (bucles) el més proper a l'inici
    if (lastAlong == null) { if (c.d < pick.d - 2) pick = c; }
    else if (Math.abs(c.along - lastAlong) < Math.abs(pick.along - lastAlong)) pick = c;
  }
  return pick || { i: 0, t: 0, d: Infinity, along: 0 };
}

// --- Tessel·les (Web Mercator) ---

export const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export function lat2y(lat, z) {
  const r = rad(lat);
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** Afegeix a `set` les tessel·les del nivell z dins el rectangle. */
export function addTileRange(set, z, south, west, north, east) {
  const max = 2 ** z - 1;
  const x0 = Math.max(0, Math.floor(lon2x(west, z)));
  const x1 = Math.min(max, Math.floor(lon2x(east, z)));
  const y0 = Math.max(0, Math.floor(lat2y(north, z)));
  const y1 = Math.min(max, Math.floor(lat2y(south, z)));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(`${z}/${x}/${y}`);
}

/** Tessel·les del nivell z que cobreixen una franja de `buffer` metres al voltant del track. */
export function tilesAroundTrack(set, points, z, buffer) {
  const dLat = buffer / M_PER_DEG;
  const step = buffer / 2;
  const addAt = (lat, lon) => {
    const dLon = buffer / (M_PER_DEG * Math.cos(rad(lat)));
    addTileRange(set, z, lat - dLat, lon - dLon, lat + dLat, lon + dLon);
  };
  for (let i = 0; i < points.length; i++) {
    const [lat, lon] = points[i];
    addAt(lat, lon);
    if (i + 1 < points.length) {
      const [lat2, lon2] = points[i + 1];
      const d = haversine(lat, lon, lat2, lon2);
      const k = Math.floor(d / step);
      for (let j = 1; j <= k; j++) addAt(lat + ((lat2 - lat) * j) / (k + 1), lon + ((lon2 - lon) * j) / (k + 1));
    }
  }
}

// --- Format ---

const nf1 = new Intl.NumberFormat('ca', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ca', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('ca', { maximumFractionDigits: 0 });

export function fmtDist(m) {
  if (m == null || !isFinite(m)) return '–';
  if (m < 1000) return `${nf0.format(Math.round(m / 10) * 10)} m`;
  return `${(m < 10000 ? nf2 : nf1).format(m / 1000)} km`;
}
export const fmtEle = m => (m == null || !isFinite(m) ? '–' : `${nf0.format(Math.round(m))} m`);
export const fmtInt = n => nf0.format(n);
export function fmtBytes(b) {
  if (!b) return '0 MB';
  if (b < 1024 * 1024) return `${nf0.format(Math.max(1, Math.round(b / 1024)))} kB`;
  if (b < 1024 ** 3) return `${nf0.format(Math.round(b / 1024 ** 2))} MB`;
  return `${nf1.format(b / 1024 ** 3)} GB`;
}
