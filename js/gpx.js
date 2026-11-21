// Lectura de fitxers GPX i KML (els formats que exporta Wikiloc).

export function parseTrackFile(text, fileName = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El fitxer està malmès o no és GPX/KML.');
  const root = doc.documentElement.localName.toLowerCase();
  const fallbackName = fileName.replace(/\.(gpx|kml|xml)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Track';
  let result;
  if (root === 'gpx') result = parseGpx(doc);
  else if (root === 'kml') result = parseKml(doc);
  else throw new Error('Format no reconegut. Cal un fitxer GPX o KML.');
  if (result.points.length < 2) throw new Error('El fitxer no conté cap traçat.');
  result.name = (result.name || fallbackName).trim();
  return result;
}

const all = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));
const childText = (el, tag) => {
  for (const c of el.children) if (c.localName === tag) return c.textContent.trim();
  return '';
};
const round6 = v => Math.round(v * 1e6) / 1e6;
const num = v => (v === '' || v == null ? null : Number(v));

function gpxPoint(el) {
  const lat = num(el.getAttribute('lat'));
  const lon = num(el.getAttribute('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const e = num(childText(el, 'ele'));
  return [round6(lat), round6(lon), Number.isFinite(e) ? Math.round(e * 10) / 10 : null];
}

function parseGpx(doc) {
  const gpx = doc.documentElement;
  const meta = all(gpx, 'metadata')[0];
  const trk = all(gpx, 'trk')[0];
  const rte = all(gpx, 'rte')[0];
  const name = (trk && childText(trk, 'name')) || (meta && childText(meta, 'name')) || (rte && childText(rte, 'name'));

  let points = all(gpx, 'trkpt').map(gpxPoint).filter(Boolean);
  if (points.length < 2) points = all(gpx, 'rtept').map(gpxPoint).filter(Boolean);

  const waypoints = all(gpx, 'wpt').map(w => {
    const p = gpxPoint(w);
    return p && { lat: p[0], lon: p[1], name: childText(w, 'name') || 'Punt' };
  }).filter(Boolean);

  return { name, points: dedupe(points), waypoints };
}

function parseKml(doc) {
  const kml = doc.documentElement;
  let name = '';
  const docEl = all(kml, 'Document')[0];
  if (docEl) name = childText(docEl, 'name');

  let points = [];
  let lineName = '';
  for (const ls of all(kml, 'LineString')) {
    const coords = all(ls, 'coordinates')[0];
    if (!coords) continue;
    for (const tuple of coords.textContent.trim().split(/\s+/)) {
      const [lon, lat, ele] = tuple.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([round6(lat), round6(lon), Number.isFinite(ele) ? ele : null]);
    }
    const pm = ls.closest('Placemark');
    if (pm && !lineName) lineName = childText(pm, 'name');
  }
  if (points.length < 2) {
    for (const c of all(kml, 'coord')) { // gx:Track
      const [lon, lat, ele] = c.textContent.trim().split(/\s+/).map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([round6(lat), round6(lon), Number.isFinite(ele) ? ele : null]);
    }
  }

  const waypoints = [];
  for (const pm of all(kml, 'Placemark')) {
    const pt = all(pm, 'Point')[0];
    if (!pt) continue;
    const coords = all(pt, 'coordinates')[0];
    if (!coords) continue;
    const [lon, lat] = coords.textContent.trim().split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) waypoints.push({ lat: round6(lat), lon: round6(lon), name: childText(pm, 'name') || 'Punt' });
  }
  return { name: lineName || name, points: dedupe(points), waypoints };
}

function dedupe(points) {
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
}
