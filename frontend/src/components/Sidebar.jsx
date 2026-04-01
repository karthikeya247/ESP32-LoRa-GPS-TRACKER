import { useGPS } from '../context/GPSContext';

function ago(ts) {
  const s = Math.round((Date.now() - new Date(ts + 'Z')) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export default function Sidebar() {
  const {
    positions, selectedDevice, devices, selectDevice, getColor,
    totalDistance, maxSpeed, alerts, mobileMenuOpen, mapRef,
  } = useGPS();

  const pos = positions[selectedDevice];
  const lat = pos?.lat ?? 0;
  const lon = pos?.lon ?? 0;
  const alt = pos?.altitude ?? 0;
  const acc = pos?.accuracy ?? 0;
  const spd = pos?.speed ?? 0;
  const hdg = pos?.heading ?? 0;

  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  const dir = dirs[Math.round(hdg / 45) % 8];

  return (
    <div className={`sidebar${mobileMenuOpen ? ' open' : ''}`}>
      {/* Live Position */}
      <div className="sec">
        <div className="sec-title">Live Position</div>
        <div className="coord-box">
          <div className="coord-row"><span className="coord-key">LAT</span><span className="coord-val">{lat.toFixed(6)}</span></div>
          <div className="coord-row"><span className="coord-key">LON</span><span className="coord-val">{lon.toFixed(6)}</span></div>
          <div className="coord-row"><span className="coord-key">ALT</span><span className="coord-val">{alt.toFixed(1)}</span> m</div>
          <div className="coord-row"><span className="coord-key">ACC</span><span className="coord-val">{acc.toFixed(1)}</span> m</div>
        </div>
      </div>

      {/* Trip Stats */}
      <div className="sec">
        <div className="sec-title">Trip Stats</div>
        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-label">Speed</div>
            <div className="stat-num">{spd.toFixed(1)}<span className="stat-unit"> km/h</span></div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Heading</div>
            <div className="stat-num">{Math.round(hdg)}<span className="stat-unit">°</span></div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Distance</div>
            <div className="stat-num">{totalDistance.toFixed(3)}<span className="stat-unit"> km</span></div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Max Speed</div>
            <div className="stat-num">{maxSpeed.toFixed(1)}<span className="stat-unit"> km/h</span></div>
          </div>
        </div>
      </div>

      {/* Compass */}
      <div className="sec">
        <div className="sec-title">Compass</div>
        <div className="compass-wrap">
          <div className="compass-outer">
            <span className="compass-cardinal n">N</span>
            <span className="compass-cardinal s">S</span>
            <span className="compass-cardinal e">E</span>
            <span className="compass-cardinal w">W</span>
            <div className="compass-needle-wrap" style={{ transform: `rotate(${hdg}deg)` }}>
              <div className="c-needle c-north" />
              <div className="c-needle c-south" />
              <div className="c-center" />
            </div>
          </div>
        </div>
        <div className="heading-text">{Math.round(hdg)}° {dir}</div>
      </div>

      {/* Devices */}
      <div className="sec">
        <div className="sec-title">Devices</div>
        <div>
          {devices.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 11 }}>Waiting...</div>}
          {devices.map(d => (
            <div key={d.id} className={`dev-item${d.id === selectedDevice ? ' active' : ''}`}
              onClick={() => {
                selectDevice(d.id);
                if (mapRef.current && positions[d.id]) mapRef.current.setView([positions[d.id].lat, positions[d.id].lon], 16);
              }}>
              <div className="dev-dot" style={{ background: getColor(d.id) }} />
              <span className="dev-name">{d.name || d.id}</span>
              <span className="dev-age">{d.last_seen ? ago(d.last_seen) : '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <div className="sec">
        <div className="sec-title">Alerts</div>
        <div>
          {alerts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 11 }}>No alerts</div>}
          {alerts.map((a, i) => (
            <div key={i} className={`alert-row ${a.event === 'enter' ? 'al-enter' : 'al-exit'}`}>
              {a.event === 'enter' ? '🟢' : '🔴'} {a.geofence} {a.event}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
