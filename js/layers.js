// Capes de mapa per territori. Tots aquests serveis envien capçaleres CORS,
// cosa que permet guardar-los al mòbil per fer-los servir sense cobertura.
//
// Cada capa té un «tipus» (kind: topo, orto, orto-noms, simple) i un «territori» (region):
//   cat   → ICGC (Catalunya i Andorra), el més detallat
//   es    → IGN d'Espanya (Mapa Topogràfic Nacional i ortofoto PNOA)
//   fr    → IGN de França (Plan IGN i ortofoto)
//   world → OpenTopoMap (tot el món, només amb connexió)

const ATTR_ICGC = '© <a href="https://www.icgc.cat" target="_blank" rel="noopener">ICGC</a> CC BY 4.0';
const ATTR_ES = '© <a href="https://www.ign.es" target="_blank" rel="noopener">IGN España</a> CC BY 4.0';
const ATTR_FR = '© <a href="https://geoservices.ign.fr" target="_blank" rel="noopener">IGN France</a>';
const ATTR_OTM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, SRTM · <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC BY-SA)';

const ICGC = 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts';
const ES = (service, layer) => `https://www.ign.es/wmts/${service}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg`;
const FR = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&LAYER=${layer}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`;

const tile256 = { tileSize: 256, zoomOffset: 0 };

export const LAYERS = [
  // --- Catalunya (ICGC). Els id són els de sempre perquè els mapes ja guardats es continuïn reconeixent.
  {
    id: 'topo', kind: 'topo', region: 'cat', attr: ATTR_ICGC,
    name: 'Topogràfic',
    url: `${ICGC}/topografic/MON3857NW/{z}/{x}/{y}.png`,
    tileSize: 512,
    zoomOffset: -1,     // tessel·les de 512 px: al zoom Z del mapa es demana el nivell Z-1
    maxNativeZoom: 19,
    avgKB: 300,         // mida mitjana aproximada d'una tessel·la a muntanya (mesurada), per estimar descàrregues
    thumb: `${ICGC}/topografic/MON3857NW/15/16551/12218.png`,
  },
  {
    id: 'orto', kind: 'orto', region: 'cat', attr: ATTR_ICGC,
    name: 'Satèlit (ortofoto)',
    url: `${ICGC}/orto/MON3857NW/{z}/{x}/{y}.png`,
    ...tile256, maxNativeZoom: 19, avgKB: 35,
    thumb: `${ICGC}/orto/MON3857NW/15/16551/12218.png`,
  },
  {
    // Satèlit amb noms (pobles, cims, masies, camins): s'activa amb el botó «Aa»
    id: 'orto-noms', kind: 'orto-noms', region: 'cat', attr: ATTR_ICGC,
    name: 'Satèlit amb noms',
    url: `${ICGC}/orto-hibrida/MON3857NW/{z}/{x}/{y}.png`,
    ...tile256, maxNativeZoom: 19, avgKB: 180,
  },
  {
    id: 'simple', kind: 'simple', region: 'cat', attr: ATTR_ICGC,
    name: 'Topogràfic lleuger',
    url: 'https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/topo/GRID3857/{z}/{x}/{y}.jpeg',
    ...tile256, maxNativeZoom: 18, avgKB: 18,
    thumb: 'https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/topo/GRID3857/15/16551/12218.jpeg',
  },

  // --- Espanya (IGN)
  {
    id: 'es-topo', kind: 'topo', region: 'es', attr: ATTR_ES,
    name: 'Topogràfic (IGN Espanya)',
    url: ES('mapa-raster', 'MTN'),
    ...tile256, maxNativeZoom: 19, avgKB: 20,
    thumb: ES('mapa-raster', 'MTN').replace('{z}', 15).replace('{y}', 12084).replace('{x}', 16379),
  },
  {
    id: 'es-orto', kind: 'orto', region: 'es', attr: ATTR_ES,
    name: 'Satèlit (PNOA Espanya)',
    url: ES('pnoa-ma', 'OI.OrthoimageCoverage'),
    ...tile256, maxNativeZoom: 19, avgKB: 18,
    thumb: ES('pnoa-ma', 'OI.OrthoimageCoverage').replace('{z}', 15).replace('{y}', 12084).replace('{x}', 16379),
  },
  {
    id: 'es-simple', kind: 'simple', region: 'es', attr: ATTR_ES,
    name: 'Mapa lleuger (IGN Espanya)',
    url: ES('ign-base', 'IGNBaseTodo'),
    ...tile256, maxNativeZoom: 19, avgKB: 8,
    thumb: ES('ign-base', 'IGNBaseTodo').replace('{z}', 15).replace('{y}', 12084).replace('{x}', 16379),
  },

  // --- França (IGN)
  {
    id: 'fr-topo', kind: 'topo', region: 'fr', attr: ATTR_FR,
    name: 'Plan IGN (França)',
    url: FR('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'),
    ...tile256, maxNativeZoom: 19, avgKB: 35,
    thumb: FR('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png').replace('{z}', 15).replace('{y}', 12098).replace('{x}', 16607),
  },
  {
    id: 'fr-orto', kind: 'orto', region: 'fr', attr: ATTR_FR,
    name: 'Satèlit (IGN França)',
    url: FR('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'),
    ...tile256, maxNativeZoom: 19, avgKB: 20,
    thumb: FR('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg').replace('{z}', 15).replace('{y}', 12098).replace('{x}', 16607),
  },

  // --- Resta del món: OpenTopoMap. No permet descàrregues massives, per això no es guarda.
  {
    id: 'otm', kind: 'topo', region: 'world', attr: ATTR_OTM,
    name: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    ...tile256, maxNativeZoom: 17, avgKB: 25,
    noDownload: true,
  },

  // --- Relleu (altitud). No es veu al mapa: es descarrega sempre amb els mapes d'un track o d'una zona.
  {
    id: 'relleu', kind: 'relleu', region: null,
    name: 'Altitud (relleu)',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    ...tile256, maxNativeZoom: 13, avgKB: 125,
    terrain: true,
  },
];

// Tipus de mapa que es poden triar (es mostren igual a tot arreu)
export const KINDS = [
  { id: 'topo', name: 'Topogràfic', desc: 'Corriols, corbes de nivell i fonts' },
  { id: 'orto', name: 'Satèlit (ortofoto)', desc: 'Fotografia aèria recent' },
  { id: 'simple', name: 'Topogràfic lleuger', desc: 'Menys detall, però ocupa molt menys espai' },
];

// Tipus que es poden descarregar
export const DL_KINDS = [
  { id: 'topo', name: 'Topogràfic' },
  { id: 'orto', name: 'Satèlit (ortofoto)' },
  { id: 'orto-noms', name: 'Satèlit amb noms (només Catalunya)' },
  { id: 'simple', name: 'Topogràfic lleuger' },
];

export const REGIONS = [
  { id: 'cat', name: 'Catalunya i Andorra', src: 'ICGC', of: "de l'ICGC" },
  { id: 'es', name: 'Espanya', src: 'IGN Espanya', of: "de l'IGN d'Espanya" },
  { id: 'fr', name: 'França', src: 'IGN França', of: "de l'IGN de França" },
  { id: 'world', name: 'Resta del món', src: 'OpenTopoMap', of: "d'OpenTopoMap" },
];
export const regionById = id => REGIONS.find(r => r.id === id) || REGIONS[0];

export const DEFAULT_LAYER = 'topo';

// Zona aproximada amb mapa de l'ICGC (Catalunya i rodalies)
export const COVERAGE = [[40.3, -0.3], [43.0, 3.5]];

export function layerById(id) {
  return LAYERS.find(l => l.id === id) || LAYERS[0];
}
export const TERRAIN_LAYER = layerById('relleu');

/** Capa d'un tipus per a un territori. Si el territori no en té (p. ex. satèlit amb noms fora de Catalunya), torna null. */
export function defFor(kind, region) {
  const exact = LAYERS.find(l => l.kind === kind && l.region === region);
  if (exact) return exact;
  if (region === 'world') return layerById('otm');                 // al món només hi ha el topogràfic
  if (kind === 'simple') return defFor('topo', region);            // França: el Plan IGN ja és lleuger
  if (kind === 'orto-noms') return null;
  return null;
}

// ---- Territori d'un punt (aproximat: n'hi ha prou per triar quin mapa es veu millor)

// Contorn de Catalunya + Andorra (lon, lat), amb uns quants km de marge
const CAT = [
  [0.64, 42.86], [0.86, 42.84], [1.0, 42.80], [1.08, 42.74], [1.36, 42.73], [1.45, 42.66], [1.73, 42.66],
  [1.80, 42.57], [1.96, 42.47], [2.06, 42.37], [2.32, 42.43], [2.68, 42.41], [3.05, 42.46], [3.20, 42.44],
  [3.40, 42.32], [3.35, 41.95], [2.85, 41.60], [2.25, 41.38], [1.60, 41.15], [1.00, 41.00], [0.95, 40.70],
  [0.75, 40.50], [0.50, 40.50], [0.15, 40.70], [0.25, 40.92], [0.36, 41.10], [0.32, 41.30], [0.34, 41.50],
  [0.40, 41.70], [0.58, 41.95], [0.64, 42.10], [0.70, 42.30], [0.72, 42.50], [0.64, 42.68],
];
// Frontera dels Pirineus, d'oest a est (lon, lat): al nord és França, al sud Espanya
const PYRENEES = [
  [-1.80, 43.38], [-1.40, 43.26], [-1.00, 43.03], [-0.75, 42.95], [-0.30, 42.83], [0.00, 42.70], [0.35, 42.72],
  [0.66, 42.84], [1.00, 42.80], [1.40, 42.70], [1.75, 42.60], [1.96, 42.45], [2.30, 42.42], [2.70, 42.40],
  [3.10, 42.45], [3.30, 42.43],
];

function inPolygon(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pyreneesLat(lon) {
  for (let i = 1; i < PYRENEES.length; i++) {
    const [x0, y0] = PYRENEES[i - 1], [x1, y1] = PYRENEES[i];
    if (lon <= x1) return y0 + ((y1 - y0) * (lon - x0)) / (x1 - x0);
  }
  return PYRENEES[PYRENEES.length - 1][1];
}

export function regionAt(lat, lon) {
  if (inPolygon(lon, lat, CAT)) return 'cat';
  if (lat > 42.44 && lat < 42.49 && lon > 1.94 && lon < 2.03) return 'cat';    // Llívia
  if (lat > 41.3 && lat < 43.1 && lon > 8.5 && lon < 9.7) return 'fr';          // Còrsega
  // Canàries
  if (lat > 27 && lat < 29.6 && lon > -18.5 && lon < -13) return 'es';
  // Portugal (aproximat)
  if (lat > 36.9 && lat < 42.15 && lon < -6.9 && lon > -9.8) return 'world';
  // Península i Balears
  if (lat > 35.8 && lat < 44 && lon > -9.8 && lon < 4.5) {
    if (lon < -1.8) return lat < 44 ? 'es' : 'fr';            // costa cantàbrica
    if (lon > 3.3) return lat > 42.3 ? 'fr' : 'es';           // Menorca vs. Rosselló
    return lat > pyreneesLat(lon) ? 'fr' : 'es';
  }
  // França continental i Còrsega
  if (lat >= 42.3 && lat < 51.2 && lon > -5.3 && lon < 9.7) return 'fr';
  return 'world';
}

export function makeTileLayer(def) {
  return L.tileLayer(def.url, {
    tileSize: def.tileSize,
    zoomOffset: def.zoomOffset,
    maxNativeZoom: def.maxNativeZoom,
    subdomains: def.subdomains || 'abc',
    maxZoom: 19,
    minZoom: 5,
    crossOrigin: true,
    attribution: def.attr,
    keepBuffer: 3,
  });
}
