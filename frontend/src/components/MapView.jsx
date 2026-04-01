import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useGPS } from '../context/GPSContext';

function makeIcon(color, hdg) {
  const px = 16 + 11 * Math.sin(hdg * Math.PI / 180);
  const py = 16 - 11 * Math.cos(hdg * Math.PI / 180);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="12" fill="${color}" opacity=".2"/>
    <circle cx="16" cy="16" r="7"  fill="${color}"/>
    <circle cx="16" cy="16" r="3"  fill="white"/>
    <line x1="16" y1="16" x2="${px}" y2="${py}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [32, 32], iconAnchor: [16, 16] });
}

function AnimatedMarkers() {
  const map = useMap();
  const { positions, getColor } = useGPS();
  const markersRef = useRef({});
  const prevPosRef = useRef({});
  const animRef = useRef({});

  useEffect(() => {
    Object.entries(positions).forEach(([id, pos]) => {
      const { lat, lon, heading, color } = pos;

      if (!markersRef.current[id]) {
        markersRef.current[id] = L.marker([lat, lon], { icon: makeIcon(color, heading) })
          .addTo(map).bindPopup(`<b style="font-family:Rajdhani,sans-serif">${id}</b>`);
        prevPosRef.current[id] = { lat, lon };
        return;
      }

      markersRef.current[id].setIcon(makeIcon(color, heading));
      const prev = prevPosRef.current[id] || { lat, lon };
      const dLat = lat - prev.lat, dLon = lon - prev.lon;
      if (Math.abs(dLat) + Math.abs(dLon) < 0.000005) {
        prevPosRef.current[id] = { lat, lon };
        return;
      }

      if (animRef.current[id]) cancelAnimationFrame(animRef.current[id]);
      const duration = 800, startTime = performance.now();
      const startLat = prev.lat, startLon = prev.lon;

      function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        markersRef.current[id].setLatLng([startLat + dLat * ease, startLon + dLon * ease]);
        if (t < 1) animRef.current[id] = requestAnimationFrame(step);
      }
      animRef.current[id] = requestAnimationFrame(step);
      prevPosRef.current[id] = { lat, lon };
    });
  }, [positions, map, getColor]);

  return null;
}

function TrailLines() {
  const map = useMap();
  const { trails, trailVisible, getColor } = useGPS();
  const linesRef = useRef({});

  useEffect(() => {
    Object.entries(trails).forEach(([id, points]) => {
      if (!linesRef.current[id]) {
        linesRef.current[id] = L.polyline(points, {
          color: getColor(id), weight: 4, opacity: 0.75, lineJoin: 'round'
        }).addTo(map);
      } else {
        linesRef.current[id].setLatLngs(points);
      }
    });
  }, [trails, map, getColor]);

  useEffect(() => {
    Object.values(linesRef.current).forEach(l => {
      if (trailVisible) { if (!map.hasLayer(l)) map.addLayer(l); }
      else { if (map.hasLayer(l)) map.removeLayer(l); }
    });
  }, [trailVisible, map]);

  return null;
}

function GeofenceCircles() {
  const map = useMap();
  const { geofences } = useGPS();
  const circlesRef = useRef([]);

  useEffect(() => {
    circlesRef.current.forEach(c => map.removeLayer(c));
    circlesRef.current = geofences.map(f => {
      return L.circle([f.lat, f.lon], {
        radius: f.radius, color: '#22d3ee', fillColor: '#22d3ee',
        fillOpacity: 0.07, weight: 1.5, dashArray: '5 5',
      }).addTo(map).bindPopup(`<b>${f.name}</b> r=${f.radius}m`);
    });
  }, [geofences, map]);

  return null;
}

function FollowMode() {
  const map = useMap();
  const { followMode, selectedDevice, positions } = useGPS();

  useEffect(() => {
    if (followMode && selectedDevice && positions[selectedDevice]) {
      const p = positions[selectedDevice];
      map.panTo([p.lat, p.lon], { animate: true, duration: 0.9, easeLinearity: 0.1 });
    }
  }, [positions, followMode, selectedDevice, map]);

  return null;
}

function MapClickHandler() {
  const map = useMap();
  const { gfDrawMode, setGfDrawMode, addToast, setActiveView } = useGPS();
  const gfDrawRef = useRef(gfDrawMode);
  const onClickRef = useRef(null);

  useEffect(() => { gfDrawRef.current = gfDrawMode; }, [gfDrawMode]);

  useEffect(() => {
    map.getContainer().style.cursor = gfDrawMode ? 'crosshair' : '';
  }, [gfDrawMode, map]);

  useEffect(() => {
    if (onClickRef.current) map.off('click', onClickRef.current);
    const handler = (e) => {
      if (!gfDrawRef.current) return;
      window.__gfClickLat = e.latlng.lat;
      window.__gfClickLon = e.latlng.lng;
      setActiveView('geofences');
      setGfDrawMode(false);
      addToast('Coords set — fill name & radius', 'success');
    };
    onClickRef.current = handler;
    map.on('click', handler);
    return () => map.off('click', handler);
  }, [map, setActiveView, setGfDrawMode, addToast]);

  return null;
}

function MapRefSetter() {
  const map = useMap();
  const { mapRef } = useGPS();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);

  useEffect(() => {
    setTimeout(() => map.invalidateSize(true), 100);
    setTimeout(() => map.invalidateSize(true), 500);
  }, [map]);

  return null;
}

export default function MapView() {
  const { activeView, followMode, trailVisible, gfDrawMode, toggleFollow, toggleTrail, clearTrails, toggleGfDraw, selectedDevice, positions, mapRef } = useGPS();

  const centerMap = () => {
    if (mapRef.current && selectedDevice && positions[selectedDevice]) {
      const p = positions[selectedDevice];
      mapRef.current.setView([p.lat, p.lon], 16);
    }
  };

  return (
    <>
      <MapContainer center={[16.8130, 81.5303]} zoom={17} zoomControl={true} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }} id="map">
        <TileLayer url="https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}" subdomains={['0', '1', '2', '3']} maxZoom={21} attribution="© Google Maps" />
        <AnimatedMarkers />
        <TrailLines />
        <GeofenceCircles />
        <FollowMode />
        <MapClickHandler />
        <MapRefSetter />
      </MapContainer>

      {activeView === 'map' && (
        <div className="map-bar">
          <button className={`map-btn${followMode ? ' active' : ''}`} onClick={toggleFollow}>Follow</button>
          <button className={`map-btn${trailVisible ? ' active' : ''}`} onClick={toggleTrail}>Trail</button>
          <button className="map-btn" onClick={clearTrails}>Clear</button>
          <button className="map-btn" onClick={centerMap}>Center</button>
          <button className={`map-btn${gfDrawMode ? ' active' : ''}`} onClick={toggleGfDraw}>+ Fence</button>
        </div>
      )}
    </>
  );
}
