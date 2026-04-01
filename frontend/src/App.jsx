import { GPSProvider } from './context/GPSContext'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import RightPanel from './components/RightPanel'
import HistoryView from './components/HistoryView'
import GeofenceView from './components/GeofenceView'
import ToastContainer from './components/ToastContainer'
import MobileSpeed from './components/MobileSpeed'
import { useGPS } from './context/GPSContext'

function AppContent() {
  const { mobileMenuOpen, setMobileMenuOpen } = useGPS();

  return (
    <>
      <Header />
      <div className="body-wrap">
        {mobileMenuOpen && <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)} />}
        <Sidebar />
        <main className="main-area">
          <MapView />
          <HistoryView />
          <GeofenceView />
        </main>
        <RightPanel />
      </div>
      <MobileSpeed />
      <ToastContainer />
    </>
  );
}

export default function App() {
  return (
    <GPSProvider>
      <AppContent />
    </GPSProvider>
  );
}
