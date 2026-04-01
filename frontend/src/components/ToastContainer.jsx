import { useGPS } from '../context/GPSContext';

export default function ToastContainer() {
  const { toasts } = useGPS();
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast t-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}
