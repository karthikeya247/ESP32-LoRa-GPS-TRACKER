import { useGPS } from '../context/GPSContext';

export default function MobileSpeed() {
  const { positions, selectedDevice } = useGPS();
  const pos = positions[selectedDevice];
  if (!pos) return null;

  const spd = pos.speed ?? 0;
  const hdg = pos.heading ?? 0;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  const dir = dirs[Math.round(hdg / 45) % 8];

  return (
    <div className="mobile-speed">
      <div>
        <div className="speed-val">{Math.round(spd)}</div>
        <div className="speed-unit">km/h</div>
      </div>
      <div className="heading-val">{Math.round(hdg)}° {dir}</div>
    </div>
  );
}
