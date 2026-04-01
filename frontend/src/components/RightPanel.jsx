import { useGPS } from '../context/GPSContext';

export default function RightPanel() {
  const { positions, selectedDevice, totalDistance, maxSpeed, sessionStart, trails, eventLog } = useGPS();
  const pos = positions[selectedDevice];
  const spd = pos?.speed ?? 0;
  const frac = Math.min(spd / 160, 1);
  const hue = Math.round(120 - frac * 120);
  const dashOffset = 235 * (1 - frac);
  const strokeColor = `hsl(${hue},88%,58%)`;
  const mins = Math.round((Date.now() - sessionStart) / 60000);

  return (
    <div className="right-panel">
      {/* Speed Gauge */}
      <div className="gauge-section">
        <div className="sec-title">Speed</div>
        <div className="gauge-wrap">
          <svg className="gauge-svg" viewBox="0 0 180 100">
            <path d="M15,95 A75,75 0 0,1 165,95" fill="none" stroke="#1f2937" strokeWidth="14" strokeLinecap="round" />
            <path d="M15,95 A75,75 0 0,1 165,95" fill="none" stroke={strokeColor}
              strokeWidth="14" strokeLinecap="round"
              strokeDasharray="235" strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset .4s ease, stroke .4s ease' }} />
          </svg>
          <div className="gauge-num" style={{ color: strokeColor }}>{Math.round(spd)}</div>
          <div className="gauge-kmh">km/h</div>
        </div>
      </div>

      {/* Session */}
      <div className="sec">
        <div className="sec-title">Session</div>
        <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace", lineHeight: 2, color: 'var(--muted)', whiteSpace: 'pre-line' }}>
          {`Time: ${mins} min\nDist: ${totalDistance.toFixed(3)} km\nMaxV: ${maxSpeed.toFixed(1)} km/h\nPts: ${trails[selectedDevice]?.length || 0}`}
        </div>
      </div>

      {/* Event Log */}
      <div className="sec" style={{ flex: 1 }}>
        <div className="sec-title">Event Log</div>
        <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", lineHeight: 1.9, color: 'var(--muted)', maxHeight: 180, overflowY: 'auto' }}>
          {eventLog.length === 0 && '—'}
          {eventLog.map((ev, i) => (
            <div key={i}>{ev.time} {ev.event === 'enter' ? '🟢' : '🔴'} {ev.geofence}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
