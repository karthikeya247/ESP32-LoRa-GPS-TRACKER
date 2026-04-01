import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

const API = 'http://127.0.0.1:8000';
const WS_URL = 'ws://127.0.0.1:8000/ws';

const GPSContext = createContext(null);
export function useGPS() { return useContext(GPSContext); }
export { API };

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p = (lat2 - lat1) * Math.PI / 180, q = (lon2 - lon1) * Math.PI / 180;
  const x = Math.sin(p / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(q / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const COLORS = ['#22d3ee', '#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#fb923c'];

export function GPSProvider({ children }) {
  const [activeView, setActiveView] = useState('map');
  const [followMode, setFollowMode] = useState(true);
  const [trailVisible, setTrailVisible] = useState(true);
  const [gfDrawMode, setGfDrawMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('tracker-1');
  const [positions, setPositions] = useState({});
  const [trails, setTrails] = useState({});
  const [totalDistance, setTotalDistance] = useState(0);
  const [maxSpeed, setMaxSpeed] = useState(0);
  const [lastUpdateTime, setLastUpdateTime] = useState('—');
  const [sessionStart] = useState(Date.now());
  const [geofences, setGeofences] = useState([]);
  const [gfEvents, setGfEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [eventLog, setEventLog] = useState([]);
  const [toasts, setToasts] = useState([]);

  const prevPosition = useRef(null);
  const wsRef = useRef(null);
  const wsHBRef = useRef(null);
  const wsTimerRef = useRef(null);
  const wsDelayRef = useRef(1500);
  const deviceColors = useRef({});
  const colorIdx = useRef(0);
  const mapRef = useRef(null);
  const selectedDeviceRef = useRef(selectedDevice);
  const maxSpeedRef = useRef(maxSpeed);

  useEffect(() => { selectedDeviceRef.current = selectedDevice; }, [selectedDevice]);
  useEffect(() => { maxSpeedRef.current = maxSpeed; }, [maxSpeed]);

  const getColor = useCallback((id) => {
    if (!deviceColors.current[id]) deviceColors.current[id] = COLORS[colorIdx.current++ % COLORS.length];
    return deviceColors.current[id];
  }, []);

  const addToast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2800);
  }, []);

  const handleLocation = useCallback((data) => {
    const lat = parseFloat(data.latitude) || 0;
    const lon = parseFloat(data.longitude) || 0;
    const hdg = parseFloat(data.heading) || 0;
    const spd = parseFloat(data.speed) || 0;
    const alt = parseFloat(data.altitude) || 0;
    const acc = parseFloat(data.accuracy) || 0;
    const id = data.device_id || 'default';
    if (!lat || !lon) return;

    const color = getColor(id);
    setPositions(prev => ({ ...prev, [id]: { lat, lon, heading: hdg, speed: spd, altitude: alt, accuracy: acc, color, timestamp: Date.now() } }));
    setTrails(prev => {
      const pts = prev[id] || [];
      const next = [...pts, [lat, lon]];
      return { ...prev, [id]: next.length > 5000 ? next.slice(-5000) : next };
    });
    setLastUpdateTime(new Date().toLocaleTimeString());

    if (id === selectedDeviceRef.current) {
      if (prevPosition.current) {
        const dist = haversine(prevPosition.current[0], prevPosition.current[1], lat, lon);
        setTotalDistance(prev => prev + dist);
      }
      prevPosition.current = [lat, lon];
      if (spd > maxSpeedRef.current) setMaxSpeed(spd);
    }
  }, [getColor]);

  const connectWS = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(wsTimerRef.current);
    clearInterval(wsHBRef.current);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      wsDelayRef.current = 1500;
      setWsConnected(true);
      wsHBRef.current = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 15000);
    };

    ws.onmessage = (e) => {
      if (e.data === 'pong' || e.data === 'ping') return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'location') {
          handleLocation(m.data);
          m.geofence_events?.forEach(ev => {
            setAlerts(prev => [ev, ...prev].slice(0, 8));
            setEventLog(prev => [{ time: new Date().toLocaleTimeString(), ...ev }, ...prev].slice(0, 50));
            addToast(`${ev.event === 'enter' ? '🟢' : '🔴'} ${ev.geofence}: ${ev.event}`, ev.event === 'enter' ? 'success' : 'warn');
          });
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      clearInterval(wsHBRef.current);
      setWsConnected(false);
      wsDelayRef.current = Math.min(wsDelayRef.current * 1.5, 12000);
      wsTimerRef.current = setTimeout(connectWS, wsDelayRef.current);
    };

    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  }, [handleLocation, addToast]);

  const fetchDevices = useCallback(async () => {
    try { setDevices(await (await fetch(`${API}/devices`)).json()); } catch { /* */ }
  }, []);

  const fetchGeofences = useCallback(async () => {
    try {
      const [f, e] = await Promise.all([
        fetch(`${API}/geofences`).then(r => r.json()),
        fetch(`${API}/geofences/events?hours=24`).then(r => r.json())
      ]);
      setGeofences(f);
      setGfEvents(e);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetch(`${API}/location/all`).then(r => r.json()).then(all => all.forEach(handleLocation)).catch(() => { });
    fetchDevices();
    fetchGeofences();
    connectWS();
    const devInt = setInterval(fetchDevices, 8000);
    return () => { clearInterval(devInt); clearInterval(wsHBRef.current); clearTimeout(wsTimerRef.current); if (wsRef.current) wsRef.current.close(); };
  }, []);

  useEffect(() => {
    const poll = async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN || !selectedDevice) return;
      try { const r = await fetch(`${API}/location?device_id=${selectedDevice}`); if (r.ok) handleLocation(await r.json()); } catch { /* */ }
    };
    const int = setInterval(poll, 2000);
    return () => clearInterval(int);
  }, [selectedDevice, handleLocation]);

  const selectDevice = useCallback((id) => {
    setSelectedDevice(id); prevPosition.current = null; setMaxSpeed(0); setTotalDistance(0);
  }, []);

  const toggleFollow = useCallback(() => { setFollowMode(p => { addToast(!p ? 'Following ON' : 'Following OFF', 'info'); return !p; }); }, [addToast]);
  const toggleTrail = useCallback(() => { setTrailVisible(p => { addToast(!p ? 'Trail ON' : 'Trail OFF', 'info'); return !p; }); }, [addToast]);
  const clearTrails = useCallback(() => { setTrails({}); setTotalDistance(0); prevPosition.current = null; addToast('Trail cleared', 'info'); }, [addToast]);
  const toggleGfDraw = useCallback(() => { setGfDrawMode(p => { addToast(!p ? 'Click map to set location' : 'Fence mode off', 'info'); return !p; }); }, [addToast]);

  const createGeofence = useCallback(async (name, lat, lon, radius) => {
    await fetch(`${API}/geofences`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, lat, lon, radius }) });
    addToast(`Fence "${name}" added`, 'success');
    fetchGeofences();
  }, [addToast, fetchGeofences]);

  const deleteGeofence = useCallback(async (id) => {
    await fetch(`${API}/geofences/${id}`, { method: 'DELETE' });
    addToast('Fence deleted', 'warn');
    fetchGeofences();
  }, [addToast, fetchGeofences]);

  const value = {
    wsConnected, activeView, setActiveView, followMode, trailVisible, gfDrawMode, mobileMenuOpen, setMobileMenuOpen, navOpen, setNavOpen,
    devices, selectedDevice, positions, trails, totalDistance, maxSpeed, lastUpdateTime, sessionStart,
    geofences, gfEvents, alerts, eventLog, toasts,
    selectDevice, toggleFollow, toggleTrail, clearTrails, toggleGfDraw, createGeofence, deleteGeofence,
    addToast, getColor, fetchGeofences, setGfDrawMode, mapRef, API: API,
  };

  return <GPSContext.Provider value={value}>{children}</GPSContext.Provider>;
}
