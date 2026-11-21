// Capes de mapa de l'ICGC (Institut Cartogràfic i Geològic de Catalunya), llicència CC BY 4.0.
// Tots aquests serveis envien capçaleres CORS, cosa que permet guardar-los al mòbil per fer-los servir sense cobertura.

const ATTR = '© <a href="https://www.icgc.cat" target="_blank" rel="noopener">ICGC</a> CC BY 4.0';

export const LAYERS = [
  {
    id: 'topo',
    name: 'Topogràfic',
    desc: 'Molt detallat: corriols, corbes de nivell i fonts',
    url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts/topografic/MON3857NW/{z}/{x}/{y}.png',
    tileSize: 512,
    zoomOffset: -1,     // tessel·les de 512 px: al zoom Z del mapa es demana el nivell Z-1
    maxNativeZoom: 19,
    avgKB: 300,         // mida mitjana aproximada d'una tessel·la a muntanya (mesurada), per estimar descàrregues
    thumb: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts/topografic/MON3857NW/15/16551/12218.png',
  },
  {
    id: 'orto',
    name: 'Satèlit (ortofoto)',
    desc: 'Fotografia aèria recent',
    url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts/orto/MON3857NW/{z}/{x}/{y}.png',
    tileSize: 256,
    zoomOffset: 0,
    maxNativeZoom: 19,
    avgKB: 35,
    thumb: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts/orto/MON3857NW/15/16551/12218.png',
  },
  {
    id: 'simple',
    name: 'Topogràfic lleuger',
    desc: 'Menys detall, però ocupa molt menys espai',
    url: 'https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/topo/GRID3857/{z}/{x}/{y}.jpeg',
    tileSize: 256,
    zoomOffset: 0,
    maxNativeZoom: 18,
    avgKB: 18,
    thumb: 'https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/topo/GRID3857/15/16551/12218.jpeg',
  },
];

export const DEFAULT_LAYER = 'topo';

// Zona aproximada amb mapa (Catalunya i rodalies). Evita demanar tessel·les buides fora.
export const COVERAGE = [[40.3, -0.3], [43.0, 3.5]];

export function layerById(id) {
  return LAYERS.find(l => l.id === id) || LAYERS[0];
}

export function makeTileLayer(def) {
  return L.tileLayer(def.url, {
    tileSize: def.tileSize,
    zoomOffset: def.zoomOffset,
    maxNativeZoom: def.maxNativeZoom,
    maxZoom: 19,
    minZoom: 7,
    bounds: COVERAGE,
    crossOrigin: true,
    attribution: ATTR,
    keepBuffer: 3,
  });
}
