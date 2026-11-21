import { getAllTracks, getTrack, saveTrack, deleteTrack } from './db.js';
import { parseTrackFile } from './gpx.js';
import { analyse, locateOnTrack, bearing, haversine, fmtDist, fmtEle, fmtInt, fmtBytes } from './geo.js';
import { LAYERS, DEFAULT_LAYER, COVERAGE, layerById, makeTileLayer } from './layers.js';
import { planForTrack, planForBounds, estimate, download, storageInfo, requestPersistence, clearTiles } from './offline.js';

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sense emmagatzematge */ } },
};

const OFF_TRACK_M = 40;     // a partir d'aquí avisem que estàs fora del track
const FAR_M = 1500;         // massa lluny: no té sentit calcular el progrés

const state = {
  layerId: store.get('layer', DEFAULT_LAYER),
  labels: store.get('labels', false),   // noms visibles al mapa de satèlit
  baseLayer: null,
  track: null,            // { rec, info }
  trackGroup: null,
  pos: null,              // { lat, lon, acc, heading, speed }
  compass: null,
  watchId: null,
  follow: false,
  progress: null,         // resultat de locateOnTrack
  wakeWanted: false,
  wakeLock: null,
  dlMode: 'track',
  dlAbort: null,
};

// ---------------------------------------------------------------- Mapa

const startView = store.get('view', null);
const map = L.map('map', {
  zoomControl: false,
  center: startView?.c || [41.7, 1.75],
  zoom: startView?.z || 8,
  maxZoom: 19,
  minZoom: 7,
  maxBounds: L.latLngBounds(COVERAGE).pad(0.6),
  worldCopyJump: false,
});
L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 110 }).addTo(map);
map.attributionControl.setPrefix(false);
map.on('moveend', () => {
  const c = map.getCenter();
  store.set('view', { c: [+c.lat.toFixed(5), +c.lng.toFixed(5)], z: map.getZoom() });
});
map.on('dragstart', () => setFollow(false));

function setBaseLayer(id) {
  const def = layerById(id);
  // Al satèlit, el botó «Noms» tria entre l'ortofoto normal i la que porta noms
  const shown = def.id === 'orto' && state.labels ? layerById('orto-noms') : def;
  if (state.baseLayer) map.removeLayer(state.baseLayer);
  state.baseLayer = makeTileLayer(shown).addTo(map);
  state.layerId = def.id;
  store.set('layer', def.id);
  const btn = $('#btn-labels');
  btn.hidden = def.id !== 'orto';
  btn.setAttribute('aria-pressed', String(state.labels));
  renderLayerList();
}

$('#btn-labels').onclick = () => {
  state.labels = !state.labels;
  store.set('labels', state.labels);
  setBaseLayer(state.layerId);
  toast(state.labels ? 'Noms visibles' : 'Noms amagats', 1800);
};

function renderLayerList() {
  const list = $('#layer-list');
  list.innerHTML = '';
  for (const def of LAYERS.filter(l => l.inPicker !== false)) {
    const b = document.createElement('button');
    b.className = 'choice';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(def.id === state.layerId));
    b.innerHTML = `<img alt="" loading="lazy" crossorigin="anonymous"><div><b></b><small></small></div>`;
    b.querySelector('img').src = def.thumb;
    b.querySelector('b').textContent = def.name;
    b.querySelector('small').textContent = def.desc;
    b.onclick = () => { setBaseLayer(def.id); closeSheets(); };
    list.append(b);
  }
}

// ---------------------------------------------------------------- Panells

function openSheet(id) {
  closeSheets();
  $('#backdrop').hidden = false;
  $(id).hidden = false;
}
function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => (s.hidden = true));
  $('#backdrop').hidden = true;
}
$('#backdrop').onclick = closeSheets;
document.querySelectorAll('.close-sheet').forEach(b => (b.onclick = closeSheets));

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

$('#btn-layers').onclick = () => openSheet('#sheet-layers');
$('#btn-tracks').onclick = async () => { await renderTrackList(); openSheet('#sheet-tracks'); };
$('#btn-download').onclick = () => openDownload(state.track ? 'track' : 'area');

// ---------------------------------------------------------------- Tracks

$('#file-input').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  let last = null;
  for (const f of files) {
    try {
      const parsed = parseTrackFile(await f.text(), f.name);
      const info = analyse(parsed.points);
      const rec = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        name: parsed.name,
        points: parsed.points,
        waypoints: parsed.waypoints,
        stats: { distance: info.distance, gain: info.gain, loss: info.loss, minEle: info.minEle, maxEle: info.maxEle },
        added: Date.now(),
        offline: null,
      };
      await saveTrack(rec);
      last = rec;
    } catch (err) {
      toast(`${f.name}: ${err.message}`, 6000);
    }
  }
  await renderTrackList();
  if (last) {
    closeSheets();
    await activateTrack(last.id);
    toast(files.length > 1 ? `${files.length} tracks afegits` : 'Track afegit');
  }
};

async function renderTrackList() {
  const tracks = (await getAllTracks()).sort((a, b) => b.added - a.added);
  const ul = $('#track-list');
  ul.innerHTML = '';
  $('#track-empty').hidden = tracks.length > 0;
  for (const t of tracks) {
    const li = document.createElement('li');
    li.className = 'track-item' + (state.track?.rec.id === t.id ? ' active' : '');
    const s = t.stats;
    const meta = [fmtDist(s.distance), s.gain != null ? `↑ ${fmtEle(s.gain)}` : null].filter(Boolean).join(' · ');
    li.innerHTML = `
      <button class="track-main"><b></b><small></small></button>
      <button class="icon-btn dl" aria-label="Mapes sense cobertura"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="icon-btn del" aria-label="Esborrar el track"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7m-7.5 0 1 13h9l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    li.querySelector('b').textContent = t.name;
    li.querySelector('small').textContent = meta;
    if (t.offline) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'OFFLINE';
      li.querySelector('small').append(' ', badge);
    }
    li.querySelector('.track-main').onclick = async () => { closeSheets(); await activateTrack(t.id); };
    li.querySelector('.dl').onclick = async () => { await activateTrack(t.id, false); openDownload('track'); };
    li.querySelector('.del').onclick = async () => {
      if (!confirm(`Vols esborrar «${t.name}»?`)) return;
      await deleteTrack(t.id);
      if (state.track?.rec.id === t.id) deactivateTrack();
      renderTrackList();
    };
    ul.append(li);
  }
}

async function activateTrack(id, fit = true) {
  const rec = await getTrack(id);
  if (!rec) return;
  const info = analyse(rec.points);
  state.track = { rec, info };
  state.progress = null;
  if (state.pos) state.progress = locateOnTrack(rec.points, info.cum, state.pos.lat, state.pos.lon, null);
  store.set('activeTrack', id);
  drawTrack();
  if (fit) map.fitBounds(state.trackGroup.getBounds(), { padding: [30, 30], maxZoom: 16 });
  $('#trackbar').hidden = false;
  $('#tb-name').textContent = rec.name;
  updateTrackbar();
  applyProfileVisibility();
}

function deactivateTrack() {
  state.track = null;
  state.progress = null;
  store.set('activeTrack', null);
  if (state.trackGroup) map.removeLayer(state.trackGroup);
  state.trackGroup = null;
  $('#trackbar').hidden = true;
  syncTrackbarHeight();
}
$('#tb-close').onclick = deactivateTrack;

function drawTrack() {
  if (state.trackGroup) map.removeLayer(state.trackGroup);
  const { rec, info } = state.track;
  const latlngs = rec.points.map(p => [p[0], p[1]]);
  const g = L.featureGroup();
  L.polyline(latlngs, { color: '#fff', weight: 8, opacity: 0.85, interactive: false }).addTo(g);
  L.polyline(latlngs, { color: '#d4007a', weight: 4.5, opacity: 1, interactive: false }).addTo(g);

  // Fletxes de direcció
  const every = Math.min(2000, Math.max(250, info.distance / 14));
  let nextAt = every / 2;
  for (let i = 1; i < rec.points.length; i++) {
    if (info.cum[i] < nextAt) continue;
    const a = rec.points[i - 1], b = rec.points[i];
    const ang = bearing(a[0], a[1], b[0], b[1]);
    L.marker([b[0], b[1]], {
      interactive: false,
      icon: L.divIcon({
        className: 'trk-arrow',
        iconSize: [16, 16],
        html: `<svg viewBox="0 0 16 16" style="transform:rotate(${ang}deg)"><path d="M8 2 13.5 13 8 10.2 2.5 13Z" fill="#d4007a" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
      }),
    }).addTo(g);
    nextAt += every;
  }

  for (const w of rec.waypoints || []) {
    L.marker([w.lat, w.lon], { icon: L.divIcon({ className: 'trk-wpt', iconSize: [14, 14] }) })
      .bindPopup(escapeHtml(w.name)).addTo(g);
  }
  const s = rec.points[0], e = rec.points[rec.points.length - 1];
  L.marker([e[0], e[1]], { icon: L.divIcon({ className: 'trk-end trk-finish', html: 'F', iconSize: [22, 22] }) })
    .bindPopup('Final').addTo(g);
  L.marker([s[0], s[1]], { icon: L.divIcon({ className: 'trk-end trk-start', html: 'I', iconSize: [22, 22] }) })
    .bindPopup('Inici').addTo(g);

  state.trackGroup = g.addTo(map);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- Barra del track i perfil

function stat(label, value) {
  return `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
}

function updateTrackbar() {
  if (!state.track) return;
  const { info } = state.track;
  const p = state.progress;
  const alert = $('#tb-alert');
  let html;

  if (p && p.d <= FAR_M) {
    const left = info.distance - p.along;
    const gainLeft = info.hasEle ? info.gain - interp(info.gainCum, p) : null;
    const lossLeft = info.hasEle ? info.loss - interp(info.lossCum, p) : null;
    html = stat('Fet', fmtDist(p.along)) + stat('Falta', fmtDist(left))
      + stat('↑ Falta', fmtEle(gainLeft)) + stat('↓ Falta', fmtEle(lossLeft));
    const limit = Math.max(OFF_TRACK_M, Math.min(state.pos?.acc || 0, 80));
    alert.hidden = p.d <= limit;
    alert.textContent = `Fora del track: ets a ${fmtDist(p.d)}`;
  } else {
    html = stat('Distància', fmtDist(info.distance)) + stat('↑ Pujada', fmtEle(info.gain))
      + stat('↓ Baixada', fmtEle(info.loss)) + stat('Alt. màx.', fmtEle(info.maxEle));
    alert.hidden = !p;
    if (p) alert.textContent = `Ets a ${fmtDist(p.d)} del track`;
  }
  $('#tb-stats').innerHTML = html;
  drawProfile();
  syncTrackbarHeight();
}

function interp(arr, p) {
  const a = arr[p.i], b = arr[Math.min(p.i + 1, arr.length - 1)];
  return a + (b - a) * p.t;
}

$('#tb-toggle').onclick = () => {
  const btn = $('#tb-toggle');
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  store.set('profileOpen', open);
  applyProfileVisibility();
};

function applyProfileVisibility() {
  const open = $('#tb-toggle').getAttribute('aria-expanded') === 'true';
  $('#tb-profile').hidden = !open || !state.track?.info.hasEle;
  drawProfile();
  syncTrackbarHeight();
}

function syncTrackbarHeight() {
  const tb = $('#trackbar');
  const h = tb.hidden ? 0 : tb.offsetHeight;
  document.documentElement.style.setProperty('--tb-h', `${h}px`);
}
window.addEventListener('resize', () => { syncTrackbarHeight(); drawProfile(); });

let profilePin = null;
function drawProfile() {
  const canvas = $('#profile');
  const box = $('#tb-profile');
  if (!state.track || box.hidden) return;
  const { rec, info } = state.track;
  if (!info.hasEle) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const padL = 40, padB = 4, padT = 8;
  const min = info.minEle, max = info.maxEle;
  const range = Math.max(20, max - min);
  const lo = min - range * 0.08, hi = max + range * 0.08;
  const X = d => padL + (d / info.distance) * (w - padL - 2);
  const Y = e => padT + (1 - (e - lo) / (hi - lo)) * (h - padT - padB);

  // Corba (mostrejada a ~2 punts per píxel)
  const stepPx = 0.5;
  ctx.beginPath();
  let lastX = -Infinity, firstX = null, lastE = rec.points[0][2] ?? min;
  for (let i = 0; i < rec.points.length; i++) {
    const x = X(info.cum[i]);
    const e = rec.points[i][2] ?? lastE;
    lastE = e;
    if (x - lastX < stepPx && i !== rec.points.length - 1) continue;
    if (firstX == null) { ctx.moveTo(x, Y(e)); firstX = x; } else ctx.lineTo(x, Y(e));
    lastX = x;
  }
  ctx.strokeStyle = '#d4007a';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(lastX, h - padB);
  ctx.lineTo(firstX, h - padB);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, h);
  grad.addColorStop(0, 'rgba(212,0,122,.28)');
  grad.addColorStop(1, 'rgba(212,0,122,.04)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Etiquetes d'altitud
  ctx.fillStyle = '#5a6560';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmtInt(Math.round(max)), 2, Y(max));
  ctx.fillText(fmtInt(Math.round(min)), 2, Y(min));
  ctx.strokeStyle = '#dfe5e2';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const e of [max, min]) { ctx.beginPath(); ctx.moveTo(padL - 4, Y(e)); ctx.lineTo(w, Y(e)); ctx.stroke(); }
  ctx.setLineDash([]);

  // On sóc
  const p = state.progress;
  if (p && p.d <= FAR_M) {
    const x = X(p.along);
    const a = rec.points[p.i], b = rec.points[Math.min(p.i + 1, rec.points.length - 1)];
    const e = (a[2] ?? min) + ((b[2] ?? min) - (a[2] ?? min)) * p.t;
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    ctx.fillStyle = '#1a73e8';
    ctx.beginPath(); ctx.arc(x, Y(e), 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  canvas._X = { padL, w };
}

// Tocar el perfil mostra aquell punt al mapa
function profileTouch(ev) {
  if (!state.track) return;
  const { rec, info } = state.track;
  const r = $('#profile').getBoundingClientRect();
  const geo = $('#profile')._X;
  if (!geo) return;
  const frac = Math.min(1, Math.max(0, (ev.clientX - r.left - geo.padL) / (geo.w - geo.padL - 2)));
  const target = frac * info.distance;
  let i = 0;
  while (i < info.cum.length - 1 && info.cum[i + 1] < target) i++;
  const pt = rec.points[i];
  const ll = [pt[0], pt[1]];
  const label = `${fmtDist(info.cum[i])}${pt[2] != null ? ' · ' + fmtEle(pt[2]) : ''}`;
  if (!profilePin) {
    profilePin = L.marker(ll, { icon: L.divIcon({ className: 'profile-pin', iconSize: [14, 14] }), interactive: false })
      .bindTooltip('', { permanent: true, direction: 'top', offset: [0, -8] }).addTo(map);
  }
  profilePin.setLatLng(ll).setTooltipContent(label);
  setFollow(false);
  map.panTo(ll);
}
$('#profile').addEventListener('pointerdown', e => { profileTouch(e); $('#profile').setPointerCapture(e.pointerId); });
$('#profile').addEventListener('pointermove', e => { if (e.buttons) profileTouch(e); });
$('#profile').addEventListener('pointerup', () => setTimeout(() => { profilePin?.remove(); profilePin = null; }, 2500));

// ---------------------------------------------------------------- Posició GPS

let meMarker = null, accCircle = null;

function ensureMeMarker(ll) {
  if (meMarker) return;
  accCircle = L.circle(ll, { radius: 10, color: '#1a73e8', weight: 1, opacity: 0.4, fillOpacity: 0.12, interactive: false }).addTo(map);
  meMarker = L.marker(ll, {
    zIndexOffset: 1000,
    keyboard: false,
    icon: L.divIcon({ className: 'me-icon', iconSize: [64, 64], html: '<div class="me-cone"></div><div class="me-dot"></div>' }),
  }).addTo(map);
  // Tocar el punt blau: finestra amb la meva ubicació i l'opció de compartir-la
  meMarker.on('click', e => {
    L.DomEvent.stopPropagation(e);
    if (state.pos) openPointPopup(L.latLng(state.pos.lat, state.pos.lon), { mine: true });
  });
}

// ---------------------------------------------------------------- Finestra d'un punt (Google Maps / compartir)

let pointPin = null;
const coordText = ll => `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
const gmapsSearch = ll => `https://www.google.com/maps/search/?api=1&query=${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
const gmapsDirections = ll => `https://www.google.com/maps/dir/?api=1&destination=${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}&travelmode=driving`;

const ICONS = {
  route: '<svg viewBox="0 0 24 24"><path d="M12 2 3 21l9-5 9 5-9-19Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8.3 10.8 7.4-4.4M8.3 13.2l7.4 4.4" stroke="currentColor" stroke-width="2"/></svg>',
};

function popupButton(icon, label, onClick, primary = false) {
  const b = document.createElement(onClick.href ? 'a' : 'button');
  b.className = 'pp-btn' + (primary ? ' pp-primary' : '');
  b.innerHTML = ICONS[icon] + '<span></span>';
  b.querySelector('span').textContent = label;
  if (onClick.href) { b.href = onClick.href; b.target = '_blank'; b.rel = 'noopener'; }
  else b.onclick = onClick;
  return b;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Coordenades copiades'); }
  catch { toast(text, 8000); }
}

async function shareMyLocation(ll) {
  const acc = state.pos?.acc ? ` (precisió ±${Math.round(state.pos.acc)} m)` : '';
  const text = `Sóc aquí: ${coordText(ll)}${acc}`;
  const url = gmapsSearch(ll);
  if (navigator.share) {
    try { await navigator.share({ title: 'La meva ubicació', text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(`${text}\n${url}`);
}

function openPointPopup(ll, { mine = false } = {}) {
  map.closePopup();
  const box = document.createElement('div');
  box.className = 'pp';
  const title = document.createElement('b');
  title.textContent = mine ? 'La meva ubicació' : 'Punt seleccionat';
  const info = document.createElement('small');
  let infoText = coordText(ll);
  if (mine && state.pos?.acc) infoText += ` · ±${Math.round(state.pos.acc)} m`;
  if (!mine && state.pos) infoText += ` · a ${fmtDist(haversine(state.pos.lat, state.pos.lon, ll.lat, ll.lng))} de tu`;
  info.textContent = infoText;
  box.append(title, info);

  if (mine) box.append(popupButton('share', 'Compartir la meva ubicació', () => shareMyLocation(ll), true));
  box.append(
    popupButton('route', 'Com arribar-hi', { href: gmapsDirections(ll) }, !mine),
    popupButton('map', 'Veure a Google Maps', { href: gmapsSearch(ll) }),
    popupButton('copy', 'Copiar coordenades', () => copyText(coordText(ll))),
  );

  if (!mine) {
    pointPin ??= L.marker(ll, { interactive: false, icon: L.divIcon({ className: 'point-pin', iconSize: [26, 34], iconAnchor: [13, 34], html: ICONS.map }) });
    pointPin.setLatLng(ll).addTo(map);
  }
  const popup = L.popup({ className: 'point-popup', offset: mine ? [0, -6] : [0, -30], maxWidth: 260, minWidth: 220, autoPanPaddingBottomRight: [20, 20 + (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tb-h')) || 0)] })
    .setLatLng(ll).setContent(box).openOn(map);
  popup.on('remove', () => { if (!mine) pointPin?.remove(); });
}

// Mantenir premut un punt del mapa (al mòbil) o clic dret (a l'ordinador)
map.on('contextmenu', e => {
  if (navigator.vibrate) navigator.vibrate(25);
  setFollow(false);
  openPointPopup(e.latlng);
});

function startGeo() {
  if (state.watchId != null) return;
  if (!('geolocation' in navigator)) { toast('Aquest navegador no té GPS'); return; }
  $('#btn-locate').dataset.state = 'searching';
  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 60000,
  });
  startCompass();
}

function onPosition(pos) {
  const c = pos.coords;
  const first = !state.pos;
  state.pos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, heading: c.heading, speed: c.speed };
  const ll = [c.latitude, c.longitude];
  ensureMeMarker(ll);
  meMarker.setLatLng(ll);
  accCircle.setLatLng(ll).setRadius(c.accuracy);
  updateHeading();
  if (state.follow) map.setView(ll, first ? Math.max(map.getZoom(), 16) : map.getZoom(), { animate: true });
  $('#btn-locate').dataset.state = state.follow ? 'follow' : 'located';
  if (state.track) {
    const prev = state.progress && state.progress.d <= FAR_M ? state.progress.along : null;
    state.progress = locateOnTrack(state.track.rec.points, state.track.info.cum, c.latitude, c.longitude, prev);
    updateTrackbar();
  }
}

function onPositionError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    toast('Cal donar permís d\'ubicació a l\'app (configuració del navegador).', 6000);
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    $('#btn-locate').dataset.state = 'off';
    setFollow(false);
  } else if (!state.pos) {
    toast('Buscant senyal GPS…');
  }
}

function startCompass() {
  const handler = e => {
    if (e.alpha == null) return;
    if (e.type === 'deviceorientation' && e.absolute !== true) return;
    const screenAngle = screen.orientation?.angle || 0;
    state.compass = (360 - e.alpha + screenAngle) % 360;
    updateHeading();
  };
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', handler);
  else window.addEventListener('deviceorientation', handler);
}

let headingRaf = 0;
function updateHeading() {
  if (headingRaf) return;
  headingRaf = requestAnimationFrame(() => {
    headingRaf = 0;
    if (!meMarker) return;
    const el = meMarker.getElement()?.querySelector('.me-cone');
    if (!el) return;
    const moving = state.pos?.speed > 1.2 && Number.isFinite(state.pos?.heading);
    const h = moving ? state.pos.heading : state.compass;
    el.classList.toggle('on', h != null);
    if (h != null) el.style.transform = `rotate(${h}deg)`;
  });
}

function setFollow(on) {
  state.follow = on;
  const btn = $('#btn-locate');
  if (state.watchId == null) btn.dataset.state = 'off';
  else if (!state.pos) btn.dataset.state = 'searching';
  else btn.dataset.state = on ? 'follow' : 'located';
}

$('#btn-locate').onclick = () => {
  if (state.watchId == null) { startGeo(); setFollow(true); return; }
  if (!state.pos) { setFollow(true); return; }
  if (state.follow) { setFollow(false); return; }
  setFollow(true);
  map.setView([state.pos.lat, state.pos.lon], Math.max(map.getZoom(), 15));
};

// ---------------------------------------------------------------- Pantalla encesa

async function setWake(on) {
  state.wakeWanted = on;
  $('#btn-wake').setAttribute('aria-pressed', String(on));
  if (on) {
    if (!('wakeLock' in navigator)) { toast('Aquest navegador no pot mantenir la pantalla encesa'); return; }
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    } catch { /* es reintenta quan l'app torni a ser visible */ }
  } else {
    await state.wakeLock?.release();
    state.wakeLock = null;
  }
}
$('#btn-wake').onclick = () => {
  const on = !state.wakeWanted;
  setWake(on);
  toast(on ? 'La pantalla es mantindrà encesa' : 'La pantalla s\'apagarà com sempre');
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.wakeWanted && !state.wakeLock) setWake(true);
});

// ---------------------------------------------------------------- Mapes sense cobertura

function openDownload(mode) {
  state.dlMode = state.track ? mode : 'area';
  $('#dl-mode-track').disabled = !state.track;
  renderDlLayers();
  refreshDownload();
  refreshStorage();
  openSheet('#sheet-download');
}

function renderDlLayers() {
  const box = $('#dl-layers');
  if (box.childElementCount) return;
  const chosen = store.get('dlLayers', state.labels ? ['topo', 'orto', 'orto-noms'] : ['topo', 'orto']);
  for (const def of LAYERS) {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" value="${def.id}"><span></span>`;
    l.querySelector('input').checked = chosen.includes(def.id);
    l.querySelector('span').textContent = def.name;
    l.querySelector('input').onchange = () => {
      store.set('dlLayers', [...box.querySelectorAll('input:checked')].map(i => i.value));
      refreshDownload();
    };
    box.append(l);
  }
}

$('#dl-mode-track').onclick = () => { state.dlMode = 'track'; refreshDownload(); };
$('#dl-mode-area').onclick = () => { state.dlMode = 'area'; refreshDownload(); };
$('#dl-buffer').onchange = refreshDownload;
$('#dl-maxzoom').onchange = refreshDownload;

const MAX_AREA_TILES = 15000;

function currentPlan() {
  const defs = [...document.querySelectorAll('#dl-layers input:checked')].map(i => layerById(i.value));
  const maxZoom = Number($('#dl-maxzoom').value);
  if (state.dlMode === 'track' && state.track) {
    return planForTrack(defs, state.track.rec.points, Number($('#dl-buffer').value), maxZoom);
  }
  const minZoom = Math.max(10, Math.min(map.getZoom(), maxZoom));
  return planForBounds(defs, map.getBounds(), minZoom, maxZoom);
}

function refreshDownload() {
  const isTrack = state.dlMode === 'track';
  $('#dl-mode-track').setAttribute('aria-selected', String(isTrack));
  $('#dl-mode-area').setAttribute('aria-selected', String(!isTrack));
  $('#dl-buffer-wrap').hidden = !isTrack;
  $('#dl-target').textContent = isTrack ? state.track.rec.name : 'La part del mapa que veus ara a la pantalla';
  const plan = currentPlan();
  const { tiles, bytes } = estimate(plan);
  const est = $('#dl-estimate');
  const tooBig = !isTrack && tiles > MAX_AREA_TILES;
  est.classList.toggle('warn', tooBig);
  if (!tiles) est.textContent = 'Tria almenys un tipus de mapa.';
  else if (tooBig) est.textContent = `Zona massa gran (${fmtInt(tiles)} tessel·les). Apropa't més al mapa o baixa el detall màxim.`;
  else est.textContent = `Aproximadament ${fmtInt(tiles)} tessel·les, uns ${fmtBytes(bytes)}. Les que ja tinguis guardades no es tornen a baixar.`;
  $('#dl-start').disabled = !tiles || tooBig || !!state.dlAbort;
}

async function refreshStorage() {
  const s = await storageInfo();
  const parts = [];
  if (s.tiles != null) parts.push(`Tessel·les guardades: ${fmtInt(s.tiles)}`);
  if (s.usage != null) parts.push(`espai ocupat per l'app: ${fmtBytes(s.usage)}`);
  $('#storage-info').textContent = parts.join(' · ') + '.';
}

$('#dl-start').onclick = async () => {
  const plan = currentPlan();
  const { tiles } = estimate(plan);
  if (!tiles) return;
  if (!navigator.onLine) { toast('Cal connexió a internet per descarregar els mapes'); return; }
  await requestPersistence();
  const ctrl = new AbortController();
  state.dlAbort = ctrl;
  $('#dl-start').disabled = true;
  $('#dl-cancel').hidden = false;
  $('#dl-progress').hidden = false;
  const bar = $('#dl-bar'), txt = $('#dl-progress-text');
  bar.style.width = '0%';
  txt.textContent = 'Començant…';
  const wasTrack = state.dlMode === 'track' && state.track;
  const res = await download(plan, {
    signal: ctrl.signal,
    onProgress: ({ done, total, bytes, failed }) => {
      bar.style.width = `${(done / total) * 100}%`;
      txt.textContent = `${fmtInt(done)} de ${fmtInt(total)} · ${fmtBytes(bytes)} nous${failed ? ` · ${failed} errors` : ''}`;
    },
  });
  state.dlAbort = null;
  $('#dl-cancel').hidden = true;
  if (res.aborted) {
    txt.textContent = `Aturat. ${fmtInt(res.done)} de ${fmtInt(res.total)} guardades.`;
  } else {
    txt.textContent = res.failed
      ? `Fet, però ${res.failed} tessel·les han fallat. Torna-ho a provar per completar-ho.`
      : 'Fet! Ja pots fer servir aquests mapes sense cobertura.';
    if (wasTrack && !res.failed) {
      const rec = state.track.rec;
      rec.offline = { at: Date.now(), layers: plan.map(p => p.def.id), maxZoom: Number($('#dl-maxzoom').value) };
      await saveTrack(rec);
    }
  }
  refreshDownload();
  refreshStorage();
};
$('#dl-cancel').onclick = () => state.dlAbort?.abort();

$('#dl-clear').onclick = async () => {
  if (!confirm('Vols esborrar tots els mapes guardats? Els tracks no s\'esborren.')) return;
  await clearTiles();
  for (const t of await getAllTracks()) if (t.offline) { t.offline = null; await saveTrack(t); }
  if (state.track) state.track.rec.offline = null;
  toast('Mapes esborrats');
  refreshStorage();
};

// ---------------------------------------------------------------- Inici

async function init() {
  setBaseLayer(state.layerId);
  $('#tb-toggle').setAttribute('aria-expanded', String(store.get('profileOpen', true)));

  const active = store.get('activeTrack', null);
  if (active) {
    try { await activateTrack(active, !startView); } catch { /* track esborrat */ }
  }
  applyProfileVisibility();

  // Si ja tenim permís d'ubicació, comencem a seguir la posició de seguida.
  try {
    const perm = await navigator.permissions.query({ name: 'geolocation' });
    if (perm.state === 'granted') startGeo();
  } catch { /* API no disponible */ }

  if ('serviceWorker' in navigator) {
    // Quan hi ha una versió nova de l'app, es recarrega sola un cop instal·lada
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
  window.addEventListener('offline', () => toast('Sense connexió: es fan servir els mapes guardats'));
}
init();
