import { useState, useEffect } from 'react';
import { useGPS } from '../context/GPSContext';

export default function GeofenceView() {
  const { activeView, geofences, gfEvents, createGeofence, deleteGeofence, addToast, fetchGeofences } = useGPS();
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [rad, setRad] = useState('');

  useEffect(() => {
    if (activeView === 'geofences') {
      fetchGeofences();
      if (window.__gfClickLat != null) {
        setLat(window.__gfClickLat.toFixed(6));
        setLon(window.__gfClickLon.toFixed(6));
        window.__gfClickLat = null;
        window.__gfClickLon = null;
      }
    }
  }, [activeView, fetchGeofences]);

  const handleCreate = () => {
    const n = name.trim();
    const la = parseFloat(lat), lo = parseFloat(lon), r = parseFloat(rad);
    if (!n || isNaN(la) || isNaN(lo) || isNaN(r)) { addToast('Fill all fields', 'warn'); return; }
    createGeofence(n, la, lo, r);
    setName(''); setLat(''); setLon(''); setRad('');
  };

  if (activeView !== 'geofences') return null;

  return (
    <div className="view-panel">
      <div className="view-header">
        <input className="finput" placeholder="Zone name" style={{ width: 120 }} value={name} onChange={e => setName(e.target.value)} />
        <input className="finput" placeholder="Latitude" style={{ width: 100 }} value={lat} onChange={e => setLat(e.target.value)} />
        <input className="finput" placeholder="Longitude" style={{ width: 100 }} value={lon} onChange={e => setLon(e.target.value)} />
        <input className="finput" placeholder="Radius (m)" style={{ width: 90 }} value={rad} onChange={e => setRad(e.target.value)} />
        <button className="btn btn-accent" onClick={handleCreate}>Add</button>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>or click map in Follow mode OFF → + Fence</span>
      </div>
      <div className="view-body">
        <div>
          {geofences.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>No geofences yet.</div>}
          {geofences.map(f => (
            <div key={f.id} className="gf-row">
              <span>📍</span>
              <span className="gf-name">{f.name}</span>
              <span className="gf-r">{f.radius}m</span>
              <button onClick={() => deleteGeofence(f.id)}
                style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
          ))}
        </div>
        <div className="sec-title" style={{ marginTop: 16, marginBottom: 8 }}>Recent Events</div>
        <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", color: 'var(--muted)' }}>
          {gfEvents.length === 0 && 'No events in last 24h'}
          {gfEvents.slice(0, 20).map((e, i) => (
            <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              {e.event_type === 'enter' ? '🟢' : '🔴'} <b>{e.geofence_name}</b> {e.device_id} {new Date(e.timestamp).toLocaleString()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
