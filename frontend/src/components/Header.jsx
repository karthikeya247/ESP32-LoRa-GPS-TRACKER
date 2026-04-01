import { useGPS } from '../context/GPSContext';

export default function Header() {
  const { wsConnected, activeView, setActiveView, lastUpdateTime, mobileMenuOpen, setMobileMenuOpen, navOpen, setNavOpen } = useGPS();

  return (
    <header>
      <button className="hamburger" onClick={() => setMobileMenuOpen(p => !p)}>☰</button>
      <div className="logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
        GPS TRACKER PRO
      </div>
      <div className={`dot-live${wsConnected ? '' : ' off'}`} />
      <div className={`ws-badge${wsConnected ? '' : ' off'}`}>
        {wsConnected ? 'LIVE' : 'RECONNECTING'}
      </div>
      <span className="h-time">{lastUpdateTime}</span>
      <div className={`header-nav${navOpen ? ' open' : ''}`}>
        {['map', 'history', 'geofences'].map(v => (
          <button key={v} className={`nav-btn${activeView === v ? ' active' : ''}`}
            onClick={() => { setActiveView(v); setNavOpen(false); }}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
    </header>
  );
}
