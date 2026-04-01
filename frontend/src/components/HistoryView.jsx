import { useState, useEffect } from 'react';
import { useGPS, API } from '../context/GPSContext';

export default function HistoryView() {
  const { activeView, devices, selectedDevice, addToast } = useGPS();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [dev, setDev] = useState(selectedDevice);
  const [hours, setHours] = useState('24');

  useEffect(() => { setDev(selectedDevice); }, [selectedDevice]);

  const load = async () => {
    try {
      const [r, s] = await Promise.all([
        fetch(`${API}/history?device_id=${dev}&hours=${hours}`).then(r => r.json()),
        fetch(`${API}/stats?device_id=${dev}&hours=${hours}`).then(r => r.json()),
      ]);
      setRows(r.slice(-500).reverse());
      setStats(s);
    } catch { addToast('Failed to load history', 'warn'); }
  };

  useEffect(() => { if (activeView === 'history') load(); }, [activeView]);

  const exportCSV = () => {
    window.open(`${API}/history/export?device_id=${dev}&hours=${hours}`, '_blank');
  };

  if (activeView !== 'history') return null;

  return (
    <div className="view-panel">
      <div className="view-header">
        <select className="fselect" value={dev} onChange={e => setDev(e.target.value)}>
          {devices.map(d => <option key={d.id} value={d.id}>{d.id}</option>)}
        </select>
        <select className="fselect" value={hours} onChange={e => setHours(e.target.value)}>
          <option value="1">1h</option>
          <option value="6">6h</option>
          <option value="24">24h</option>
          <option value="72">3d</option>
          <option value="168">7d</option>
        </select>
        <button className="btn btn-accent" onClick={load}>Load</button>
        <button className="btn btn-muted" onClick={exportCSV}>⬇ CSV</button>
        {stats && (
          <div className="hstat-bar">
            <span>📍 {stats.points}</span>
            <span>📏 {stats.total_distance_km} km</span>
            <span>⚡ {stats.max_speed_kmh} km/h</span>
            <span>〜 {stats.avg_speed_kmh} km/h avg</span>
          </div>
        )}
      </div>
      <div className="view-body">
        <table className="htable">
          <thead><tr><th>Time</th><th>Lat</th><th>Lon</th><th>Speed</th><th>Heading</th><th>Alt</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
                <td>{(+r.latitude).toFixed(5)}</td>
                <td>{(+r.longitude).toFixed(5)}</td>
                <td>{(+r.speed || 0).toFixed(1)}</td>
                <td>{Math.round(+r.heading || 0)}°</td>
                <td>{Math.round(+r.altitude || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
