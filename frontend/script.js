// GPS Tracker Pro — script.js
// Real-time updates, smooth compass, stable WebSocket, no page refresh

const API    = "http://127.0.0.1:8000";
const WS_URL = "ws://127.0.0.1:8000/ws";

// ── State ──────────────────────────────────────────────────────────────────
let map, ws, wsHB, wsTimer;
let markers   = {};   // devId → L.Marker
let trails    = {};   // devId → L.Polyline
let gfCircles = [];
let followOn  = true;
let trailOn   = true;
let gfMode    = false;
let selDev    = "tracker-1";  // default — always start on tracker-1
let maxSpd    = 0;
let totDist   = 0;
let prevLL    = null;
let sessStart = Date.now();
let wsOK      = false;
let wsDelay   = 1500;
let curHeading = 0;

// ── Map Init ───────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
  }).setView([16.8130, 81.5303], 17);

  // Satellite layer (Google Satellite via proxy)
  const satellite = L.tileLayer(
    'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    { subdomains: ['0','1','2','3'], maxZoom: 21,
      attribution: '© Google Maps' }
  );

  // Satellite + roads hybrid (like Uber)
  const hybrid = L.tileLayer(
    'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    { subdomains: ['0','1','2','3'], maxZoom: 21,
      attribution: '© Google Maps' }
  );

  // Standard OSM fallback
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors',
  });

  // Start with hybrid (satellite + roads — like Uber/Rapido)
  hybrid.addTo(map);

  // Layer switcher
  L.control.layers({
    '🛰 Satellite': satellite,
    '🛰 Hybrid (Roads)': hybrid,
    '🗺 Street Map': osm,
  }, {}, { position: 'topright' }).addTo(map);

  map.on('click', onMapClick);

  setTimeout(() => { map.invalidateSize(true); }, 100);
  setTimeout(() => { map.invalidateSize(true); }, 500);
}

// ── Device color ───────────────────────────────────────────────────────────
const COLORS = ['#22d3ee','#f87171','#4ade80','#fbbf24','#a78bfa','#fb923c'];
const devClr = {};
let clrIdx   = 0;
function getColor(id) {
  if (!devClr[id]) devClr[id] = COLORS[clrIdx++ % COLORS.length];
  return devClr[id];
}

// ── Smooth marker animation (Uber/Rapido style) ───────────────────────────
const markerPos  = {};  // devId → {lat, lon}
const markerAnim = {};  // devId → animFrame id

function smoothMoveTo(id, targetLat, targetLon, hdg, color) {
  // First time — just place it
  if (!markers[id]) {
    upsertMarker(id, targetLat, targetLon, hdg, color);
    markerPos[id] = { lat: targetLat, lon: targetLon };
    return;
  }

  const start = markerPos[id] || { lat: targetLat, lon: targetLon };
  const startLat = start.lat, startLon = start.lon;
  const dLat = targetLat - startLat;
  const dLon = targetLon - startLon;

  // Skip animation if distance is tiny
  const dist = Math.abs(dLat) + Math.abs(dLon);
  if (dist < 0.000005) {
    markers[id].setIcon(makeIcon(color, hdg));
    return;
  }

  // Cancel previous animation
  if (markerAnim[id]) cancelAnimationFrame(markerAnim[id]);

  const duration = 800;  // ms — smooth like Uber
  const startTime = performance.now();

  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    // Ease in-out cubic
    const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    const curLat = startLat + dLat * ease;
    const curLon = startLon + dLon * ease;
    markers[id].setLatLng([curLat, curLon]);
    if (t < 1) {
      markerAnim[id] = requestAnimationFrame(step);
    } else {
      markers[id].setLatLng([targetLat, targetLon]);
      markers[id].setIcon(makeIcon(color, hdg));
      markerPos[id] = { lat: targetLat, lon: targetLon };
    }
  }

  // Rotate icon immediately, animate position
  markers[id].setIcon(makeIcon(color, hdg));
  markerAnim[id] = requestAnimationFrame(step);
  markerPos[id] = { lat: targetLat, lon: targetLon };
}

// ── Marker ─────────────────────────────────────────────────────────────────
function makeIcon(color, hdg) {
  const px = 16 + 11 * Math.sin(hdg * Math.PI / 180);
  const py = 16 - 11 * Math.cos(hdg * Math.PI / 180);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="12" fill="${color}" opacity=".2"/>
    <circle cx="16" cy="16" r="7"  fill="${color}"/>
    <circle cx="16" cy="16" r="3"  fill="white"/>
    <line x1="16" y1="16" x2="${px}" y2="${py}"
          stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [32,32], iconAnchor: [16,16] });
}

function upsertMarker(id, lat, lon, hdg, color) {
  if (markers[id]) {
    // Smooth animate marker to new position
    markers[id].setLatLng([lat, lon]);
    markers[id].setIcon(makeIcon(color, hdg));
  } else {
    markers[id] = L.marker([lat, lon], { icon: makeIcon(color, hdg) })
      .addTo(map)
      .bindPopup(`<b style="font-family:Rajdhani,sans-serif">${id}</b>`);
    trails[id] = L.polyline([], {
      color,
      weight: 4,
      opacity: 0.75,
      lineJoin: 'round',
    }).addTo(map);
  }
}

// ── Trail ──────────────────────────────────────────────────────────────────
function addTrail(id, lat, lon) {
  if (!trails[id]) return;
  const pts = trails[id].getLatLngs();
  pts.push([lat, lon]);
  trails[id].setLatLngs(pts);
}
function toggleTrail() {
  trailOn = !trailOn;
  Object.values(trails).forEach(t => trailOn ? map.addLayer(t) : map.removeLayer(t));
  toast(trailOn ? 'Trail ON' : 'Trail OFF', 'info');
}
function clearTrail() {
  Object.values(trails).forEach(t => t.setLatLngs([]));
  totDist = 0; prevLL = null;
  document.getElementById('sDist').innerHTML = '0<span class="stat-unit"> km</span>';
  toast('Trail cleared', 'info');
}
function toggleFollow() {
  followOn = !followOn;
  document.getElementById('btnFollow').classList.toggle('active', followOn);
  toast(followOn ? 'Following ON' : 'Following OFF', 'info');
}
function centerMap() {
  if (selDev && markers[selDev]) map.setView(markers[selDev].getLatLng(), 16);
}

// ── Compass ────────────────────────────────────────────────────────────────
function updateCompass(hdg) {
  // Smooth rotation using CSS transition on the wrapper div
  document.getElementById('compassWrap').style.transform = `rotate(${hdg}deg)`;
  // Heading label
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
  const dir  = dirs[Math.round(hdg / 45) % 8];
  document.getElementById('headDeg').textContent = `${Math.round(hdg)}° ${dir}`;
}

// ── Haversine (km) ─────────────────────────────────────────────────────────
function hav(a, b, c, d) {
  const R = 6371;
  const p = (c-a)*Math.PI/180, q = (d-b)*Math.PI/180;
  const x = Math.sin(p/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(q/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

// ── Speed Gauge ────────────────────────────────────────────────────────────
function updateGauge(spd) {
  const arc  = document.getElementById('gArc');
  const num  = document.getElementById('gNum');
  const frac = Math.min(spd / 160, 1);
  arc.style.strokeDashoffset = 235 * (1 - frac);
  const hue  = Math.round(120 - frac * 120);
  arc.style.stroke = `hsl(${hue},88%,58%)`;
  num.textContent  = Math.round(spd);
  num.style.color  = `hsl(${hue},88%,58%)`;
}

// ── Apply location — called on EVERY GPS update, instant UI update ─────────
function applyLoc(d) {
  const lat = parseFloat(d.latitude)  || 0;
  const lon = parseFloat(d.longitude) || 0;
  const hdg = parseFloat(d.heading)   || 0;
  const spd = parseFloat(d.speed)     || 0;
  const alt = parseFloat(d.altitude)  || 0;
  const acc = parseFloat(d.accuracy)  || 0;
  const id  = d.device_id || 'default';

  if (!lat || !lon) return;

  // Auto-select first device
  if (!selDev) { selDev = id; refreshDevList(); }

  const color = getColor(id);
  smoothMoveTo(id, lat, lon, hdg, color);
  addTrail(id, lat, lon);

  if (id !== selDev) return;

  // ── Update all UI elements immediately (no throttle) ──

  // Coordinates
  document.getElementById('cLat').textContent = lat.toFixed(6);
  document.getElementById('cLon').textContent = lon.toFixed(6);
  document.getElementById('cAlt').textContent = alt.toFixed(1);
  document.getElementById('cAcc').textContent = acc.toFixed(1);

  // Speed & heading
  document.getElementById('sSpeed').innerHTML = `${spd.toFixed(1)}<span class="stat-unit"> km/h</span>`;
  document.getElementById('sHead').innerHTML  = `${Math.round(hdg)}<span class="stat-unit">°</span>`;
  updateGauge(spd);

  // Compass — smooth rotation
  updateCompass(hdg);

  // Distance
  if (prevLL) {
    totDist += hav(prevLL[0], prevLL[1], lat, lon);
    document.getElementById('sDist').innerHTML = `${totDist.toFixed(3)}<span class="stat-unit"> km</span>`;
  }
  prevLL = [lat, lon];

  // Max speed
  if (spd > maxSpd) {
    maxSpd = spd;
    document.getElementById('sMax').innerHTML = `${maxSpd.toFixed(1)}<span class="stat-unit"> km/h</span>`;
  }

  // Last update time header
  document.getElementById('hTime').textContent = new Date().toLocaleTimeString();

  // Follow — smooth pan (like Google Maps)
  if (followOn) {
    // Smooth camera follow — like Uber
    map.panTo([lat, lon], { animate: true, duration: 0.9, easeLinearity: 0.1 });
  }

  // Session summary
  const mins = Math.round((Date.now() - sessStart) / 60000);
  document.getElementById('sessStats').innerHTML =
    `Time: ${mins} min\nDist: ${totDist.toFixed(3)} km\nMaxV: ${maxSpd.toFixed(1)} km/h\nPts: ${trails[id]?.getLatLngs().length || 0}`;
}

// ── WebSocket — stable connection ──────────────────────────────────────────
function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(wsTimer);
  clearInterval(wsHB);

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsOK = true; wsDelay = 1500;
    setWS(true);
    // Heartbeat every 15s to prevent timeout
    wsHB = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 15000);
  };

  ws.onmessage = (e) => {
    if (e.data === 'pong' || e.data === 'ping') return;
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'location') {
        applyLoc(m.data);  // instant update
        m.geofence_events?.forEach(ev => addAlert(ev));
      }
    } catch {}
  };

  ws.onclose = () => {
    wsOK = false; clearInterval(wsHB);
    setWS(false);
    wsDelay = Math.min(wsDelay * 1.5, 12000);
    wsTimer = setTimeout(connectWS, wsDelay);
  };

  ws.onerror = () => { try { ws.close(); } catch {} };
}

function setWS(ok) {
  const b = document.getElementById('wsBadge');
  const d = document.getElementById('dotLive');
  b.textContent = ok ? 'LIVE' : 'RECONNECTING';
  b.className   = ok ? 'ws-badge' : 'ws-badge off';
  d.style.background = ok ? 'var(--green)' : 'var(--yellow)';
}

// Polling fallback when WS is down
async function poll() {
  if (wsOK || !selDev) return;
  try {
    const r = await fetch(`${API}/location?device_id=${selDev}`);
    if (r.ok) applyLoc(await r.json());
  } catch {}
}

// ── Device list ────────────────────────────────────────────────────────────
async function refreshDevList() {
  try {
    const devs = await (await fetch(`${API}/devices`)).json();
    if (!selDev && devs.length) selDev = devs[0].id;

    const list = document.getElementById('devList');
    list.innerHTML = '';
    devs.forEach(d => {
      const clr  = getColor(d.id);
      const age  = d.last_seen ? ago(d.last_seen) : '—';
      const div  = document.createElement('div');
      div.className = 'dev-item' + (d.id === selDev ? ' active' : '');
      div.innerHTML = `<div class="dev-dot" style="background:${clr}"></div>
        <span class="dev-name">${d.name || d.id}</span>
        <span class="dev-age">${age}</span>`;
      div.onclick = () => {
        selDev = d.id; prevLL = null; maxSpd = 0; totDist = 0;
        refreshDevList();
        if (markers[d.id]) map.setView(markers[d.id].getLatLng(), 16);
      };
      list.appendChild(div);
    });

    // Update history device select
    const sel = document.getElementById('hDev');
    const cur = sel.value;
    sel.innerHTML = '';
    devs.forEach(d => {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.id;
      if (d.id === (cur || selDev)) o.selected = true;
      sel.appendChild(o);
    });
  } catch {}
}

function ago(ts) {
  const s = Math.round((Date.now() - new Date(ts + 'Z')) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.round(s/60)}m`;
  return `${Math.round(s/3600)}h`;
}

// ── Geofences ──────────────────────────────────────────────────────────────
function toggleGfDraw() {
  gfMode = !gfMode;
  document.getElementById('btnGf').classList.toggle('active', gfMode);
  map.getContainer().style.cursor = gfMode ? 'crosshair' : '';
  toast(gfMode ? 'Click map to set location' : 'Fence mode off', 'info');
}
function onMapClick(e) {
  if (!gfMode) return;
  document.getElementById('gfLat').value = e.latlng.lat.toFixed(6);
  document.getElementById('gfLon').value = e.latlng.lng.toFixed(6);
  showView('geofences');
  gfMode = false;
  document.getElementById('btnGf').classList.remove('active');
  map.getContainer().style.cursor = '';
  toast('Coords set — fill name & radius', 'success');
}
async function loadGeofences() {
  try {
    const fences = await (await fetch(`${API}/geofences`)).json();
    gfCircles.forEach(c => map.removeLayer(c)); gfCircles = [];
    const list = document.getElementById('gfList');
    list.innerHTML = fences.length ? '' : '<div style="color:var(--muted);font-size:12px">No geofences yet.</div>';
    fences.forEach(f => {
      const c = L.circle([f.lat, f.lon], {
        radius: f.radius, color: '#22d3ee',
        fillColor: '#22d3ee', fillOpacity: 0.07,
        weight: 1.5, dashArray: '5 5',
      }).addTo(map).bindPopup(`<b>${f.name}</b> r=${f.radius}m`);
      gfCircles.push(c);
      const div = document.createElement('div');
      div.className = 'gf-row';
      div.innerHTML = `<span>📍</span><span class="gf-name">${f.name}</span>
        <span class="gf-r">${f.radius}m</span>
        <button onclick="delGF(${f.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px">✕</button>`;
      list.appendChild(div);
    });
    const evs = await (await fetch(`${API}/geofences/events?hours=24`)).json();
    document.getElementById('gfEvents').innerHTML = evs.length
      ? evs.slice(0,20).map(e =>
          `<div style="padding:3px 0;border-bottom:1px solid var(--border)">
            ${e.event_type==='enter'?'🟢':'🔴'} <b>${e.geofence_name}</b>
            ${e.device_id} ${new Date(e.timestamp).toLocaleString()}
           </div>`).join('')
      : 'No events in last 24h';
  } catch {}
}
async function createGeofence() {
  const name = document.getElementById('gfName').value.trim();
  const lat  = parseFloat(document.getElementById('gfLat').value);
  const lon  = parseFloat(document.getElementById('gfLon').value);
  const rad  = parseFloat(document.getElementById('gfRad').value);
  if (!name || isNaN(lat) || isNaN(lon) || isNaN(rad)) { toast('Fill all fields', 'warn'); return; }
  await fetch(`${API}/geofences`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({name, lat, lon, radius: rad})
  });
  toast(`Fence "${name}" added`, 'success');
  ['gfName','gfLat','gfLon','gfRad'].forEach(id => document.getElementById(id).value = '');
  loadGeofences();
}
async function delGF(id) {
  await fetch(`${API}/geofences/${id}`, {method:'DELETE'});
  toast('Fence deleted', 'warn'); loadGeofences();
}

// ── Alerts ─────────────────────────────────────────────────────────────────
function addAlert(ev) {
  const list = document.getElementById('alertList');
  const cls  = ev.event === 'enter' ? 'al-enter' : 'al-exit';
  const icon = ev.event === 'enter' ? '🟢' : '🔴';
  const div  = document.createElement('div');
  div.className = `alert-row ${cls}`;
  div.textContent = `${icon} ${ev.geofence} ${ev.event}`;
  if (list.firstChild?.textContent === 'No alerts') list.innerHTML = '';
  list.prepend(div);
  if (list.children.length > 8) list.removeChild(list.lastChild);
  toast(`${icon} ${ev.geofence}: ${ev.event}`, ev.event === 'enter' ? 'success' : 'warn');
  const log = document.getElementById('evLog');
  const row = document.createElement('div');
  row.textContent = `${new Date().toLocaleTimeString()} ${icon} ${ev.geofence}`;
  log.prepend(row);
}

// ── History ────────────────────────────────────────────────────────────────
async function loadHistory() {
  const dev  = document.getElementById('hDev').value   || selDev || 'default';
  const hrs  = document.getElementById('hHours').value;
  try {
    const [rows, stats] = await Promise.all([
      fetch(`${API}/history?device_id=${dev}&hours=${hrs}`).then(r=>r.json()),
      fetch(`${API}/stats?device_id=${dev}&hours=${hrs}`).then(r=>r.json()),
    ]);
    document.getElementById('hBody').innerHTML = rows.slice(-500).reverse().map(r=>`
      <tr>
        <td>${new Date(r.timestamp).toLocaleTimeString()}</td>
        <td>${(+r.latitude).toFixed(5)}</td>
        <td>${(+r.longitude).toFixed(5)}</td>
        <td>${(+r.speed||0).toFixed(1)}</td>
        <td>${Math.round(+r.heading||0)}°</td>
        <td>${Math.round(+r.altitude||0)}</td>
      </tr>`).join('');
    document.getElementById('hStats').innerHTML =
      `<span>📍 ${stats.points}</span>` +
      `<span>📏 ${stats.total_distance_km} km</span>` +
      `<span>⚡ ${stats.max_speed_kmh} km/h</span>` +
      `<span>〜 ${stats.avg_speed_kmh} km/h avg</span>`;
  } catch { toast('Failed to load history', 'warn'); }
}
function exportCSV() {
  const dev = document.getElementById('hDev').value || selDev || 'default';
  const hrs = document.getElementById('hHours').value;
  window.open(`${API}/history/export?device_id=${dev}&hours=${hrs}`, '_blank');
}

// ── Views ──────────────────────────────────────────────────────────────────
function showView(name) {
  document.getElementById('viewHistory').style.display   = name==='history'   ? 'flex' : 'none';
  document.getElementById('viewGeofences').style.display = name==='geofences' ? 'flex' : 'none';
  document.querySelectorAll('.nav-btn').forEach((b,i) =>
    b.classList.toggle('active', ['map','history','geofences'][i] === name));
  if (name === 'map') {
    // Force map resize when switching back to map view
    setTimeout(() => map.invalidateSize(true), 50);
  }
  if (name === 'history')   loadHistory();
  if (name === 'geofences') loadGeofences();
}

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast t-${type}`;
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ── Session stats (from API) ───────────────────────────────────────────────
async function loadSessStats() {
  if (!selDev) return;
  try {
    const s = await (await fetch(`${API}/stats?device_id=${selDev}&hours=24`)).json();
    document.getElementById('sessStats').innerHTML =
      `Dist: ${s.total_distance_km} km\nMaxV: ${s.max_speed_kmh} km/h\nAvgV: ${s.avg_speed_kmh} km/h\nPts: ${s.points}`;
  } catch {}
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  initMap();

  // Load all latest positions
  try {
    const all = await (await fetch(`${API}/location/all`)).json();
    all.forEach(applyLoc);
    if (all.length && !selDev) selDev = all[0].device_id;
  } catch {}

  await refreshDevList();
  loadGeofences();
  loadSessStats();
  connectWS();

  // Polling fallback every 2s (only fires if WS is down)
  setInterval(poll, 2000);
  // Refresh device list every 8s
  setInterval(refreshDevList, 8000);
  // Session stats every 20s
  setInterval(loadSessStats, 20000);
}

boot();