"""
GPS Tracker - Full Featured Backend
Features: REST API, WebSocket live updates, history, geofence alerts,
          stats (speed/distance), CSV export, device management
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import sqlite3
import asyncio
import json
import math
import csv
import io
import os
from datetime import datetime, timedelta

app = FastAPI(title="GPS Tracker API", version="2.0")

# Allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Database ──────────────────────────────────────────────────────────────────

# Always resolve the database path relative to THIS file, so the server works
# no matter which directory you run uvicorn from.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH  = os.path.join(BASE_DIR, "database", "tracker.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)  # create folder if missing

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS locations (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            latitude  REAL NOT NULL,
            longitude REAL NOT NULL,
            heading   REAL DEFAULT 0,
            speed     REAL DEFAULT 0,
            altitude  REAL DEFAULT 0,
            device_id TEXT DEFAULT 'default',
            accuracy  REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS geofences (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT NOT NULL,
            lat       REAL NOT NULL,
            lon       REAL NOT NULL,
            radius    REAL NOT NULL,
            active    INTEGER DEFAULT 1,
            created   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS geofence_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            geofence_id INTEGER,
            device_id   TEXT,
            event_type  TEXT,  -- 'enter' or 'exit'
            timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS devices (
            id         TEXT PRIMARY KEY,
            name       TEXT,
            color      TEXT DEFAULT '#ef4444',
            last_seen  DATETIME,
            active     INTEGER DEFAULT 1
        );
    """)
    conn.commit()
    conn.close()

init_db()

# ── WebSocket Manager ─────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in self.active:
                self.active.remove(ws)

manager = ConnectionManager()

# ── Helpers ───────────────────────────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    """Distance in meters between two GPS coords."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def check_geofences(lat, lon, device_id):
    """Check all active geofences and emit events."""
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM geofences WHERE active=1")
    fences = c.fetchall()
    events = []
    for f in fences:
        dist = haversine(lat, lon, f["lat"], f["lon"])
        inside = dist <= f["radius"]
        # Check last event
        c.execute("""
            SELECT event_type FROM geofence_events
            WHERE geofence_id=? AND device_id=?
            ORDER BY timestamp DESC LIMIT 1
        """, (f["id"], device_id))
        last = c.fetchone()
        last_type = last["event_type"] if last else None

        if inside and last_type != "enter":
            c.execute("INSERT INTO geofence_events(geofence_id,device_id,event_type) VALUES(?,?,?)",
                      (f["id"], device_id, "enter"))
            events.append({"geofence": f["name"], "event": "enter", "distance": round(dist)})
        elif not inside and last_type == "enter":
            c.execute("INSERT INTO geofence_events(geofence_id,device_id,event_type) VALUES(?,?,?)",
                      (f["id"], device_id, "exit"))
            events.append({"geofence": f["name"], "event": "exit", "distance": round(dist)})

    conn.commit()
    conn.close()
    return events

# ── Models ────────────────────────────────────────────────────────────────────

class LocationIn(BaseModel):
    latitude: float
    longitude: float
    heading: float = 0
    speed: float = 0
    altitude: float = 0
    device_id: str = "default"
    accuracy: float = 0

class GeofenceIn(BaseModel):
    name: str
    lat: float
    lon: float
    radius: float  # meters

class DeviceIn(BaseModel):
    id: str
    name: str
    color: str = "#ef4444"

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "GPS Tracker API v2 running", "db": DB_PATH}

# -- Location --

@app.post("/location")
async def post_location(loc: LocationIn):
    """Receive a GPS fix from a device."""
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO locations(latitude,longitude,heading,speed,altitude,device_id,accuracy)
        VALUES(?,?,?,?,?,?,?)
    """, (loc.latitude, loc.longitude, loc.heading,
          loc.speed, loc.altitude, loc.device_id, loc.accuracy))
    conn.commit()

    # Update device last seen
    c.execute("""
        INSERT INTO devices(id,name,last_seen) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET last_seen=CURRENT_TIMESTAMP, active=1
    """, (loc.device_id, loc.device_id))
    conn.commit()
    conn.close()

    # Geofence check
    geo_events = check_geofences(loc.latitude, loc.longitude, loc.device_id)

    # Broadcast to WebSocket clients
    await manager.broadcast({
        "type": "location",
        "data": loc.model_dump(),
        "geofence_events": geo_events
    })

    return {"status": "saved", "geofence_events": geo_events}

@app.get("/location")
def get_latest_location(device_id: str = "default"):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT latitude,longitude,heading,speed,altitude,timestamp,accuracy
        FROM locations WHERE device_id=?
        ORDER BY id DESC LIMIT 1
    """, (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "No data for device")
    return dict(row)

@app.get("/location/all")
def get_all_latest():
    """Latest fix for every device."""
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT l.* FROM locations l
        INNER JOIN (
            SELECT device_id, MAX(id) as mid FROM locations GROUP BY device_id
        ) m ON l.id = m.mid
    """)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

# -- History --

@app.get("/history")
def get_history(
    device_id: str = "default",
    hours: int = Query(24, ge=1, le=720),
    limit: int = Query(1000, ge=1, le=10000)
):
    conn = get_db()
    c = conn.cursor()
    since = datetime.utcnow() - timedelta(hours=hours)
    c.execute("""
        SELECT latitude,longitude,heading,speed,altitude,timestamp
        FROM locations
        WHERE device_id=? AND timestamp >= ?
        ORDER BY id ASC
        LIMIT ?
    """, (device_id, since.isoformat(), limit))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@app.get("/history/export")
def export_history(device_id: str = "default", hours: int = 24):
    """Download history as CSV."""
    conn = get_db()
    c = conn.cursor()
    since = datetime.utcnow() - timedelta(hours=hours)
    c.execute("""
        SELECT timestamp,latitude,longitude,heading,speed,altitude,accuracy
        FROM locations WHERE device_id=? AND timestamp >= ?
        ORDER BY id ASC
    """, (device_id, since.isoformat()))
    rows = c.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp","latitude","longitude","heading","speed_kmh","altitude_m","accuracy_m"])
    for r in rows:
        writer.writerow(list(r))
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=gps_{device_id}_{hours}h.csv"}
    )

# -- Stats --

@app.get("/stats")
def get_stats(device_id: str = "default", hours: int = 24):
    conn = get_db()
    c = conn.cursor()
    since = datetime.utcnow() - timedelta(hours=hours)
    c.execute("""
        SELECT latitude,longitude,speed,timestamp FROM locations
        WHERE device_id=? AND timestamp >= ?
        ORDER BY id ASC
    """, (device_id, since.isoformat()))
    rows = c.fetchall()
    conn.close()

    if not rows:
        return {"total_distance_km": 0, "max_speed_kmh": 0, "avg_speed_kmh": 0, "points": 0}

    total_dist = 0
    for i in range(1, len(rows)):
        total_dist += haversine(rows[i-1][0], rows[i-1][1], rows[i][0], rows[i][1])

    speeds = [r[2] for r in rows if r[2] > 0]
    return {
        "total_distance_km": round(total_dist / 1000, 2),
        "max_speed_kmh": round(max(speeds, default=0), 1),
        "avg_speed_kmh": round(sum(speeds)/len(speeds) if speeds else 0, 1),
        "points": len(rows),
        "duration_hours": hours
    }

# -- Geofences --

@app.get("/geofences")
def list_geofences():
    conn = get_db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM geofences").fetchall()]
    conn.close()
    return rows

@app.post("/geofences")
def create_geofence(gf: GeofenceIn):
    conn = get_db()
    conn.execute("INSERT INTO geofences(name,lat,lon,radius) VALUES(?,?,?,?)",
                 (gf.name, gf.lat, gf.lon, gf.radius))
    conn.commit()
    conn.close()
    return {"status": "created"}

@app.delete("/geofences/{gf_id}")
def delete_geofence(gf_id: int):
    conn = get_db()
    conn.execute("DELETE FROM geofences WHERE id=?", (gf_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}

@app.get("/geofences/events")
def geofence_events(hours: int = 24):
    conn = get_db()
    since = datetime.utcnow() - timedelta(hours=hours)
    rows = conn.execute("""
        SELECT ge.*, gf.name as geofence_name
        FROM geofence_events ge
        JOIN geofences gf ON ge.geofence_id = gf.id
        WHERE ge.timestamp >= ?
        ORDER BY ge.timestamp DESC
    """, (since.isoformat(),)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# -- Devices --

@app.get("/devices")
def list_devices():
    conn = get_db()
    rows = [dict(r) for r in conn.execute("SELECT * FROM devices ORDER BY last_seen DESC").fetchall()]
    conn.close()
    return rows

@app.put("/devices/{device_id}")
def update_device(device_id: str, dev: DeviceIn):
    conn = get_db()
    conn.execute("UPDATE devices SET name=?, color=? WHERE id=?",
                 (dev.name, dev.color, device_id))
    conn.commit()
    conn.close()
    return {"status": "updated"}

# -- WebSocket --

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=25)
                if data == "ping":
                    try:
                        await ws.send_text("pong")
                    except Exception:
                        break
            except asyncio.TimeoutError:
                # Send keepalive
                try:
                    await ws.send_text("ping")
                except Exception:
                    break
            except WebSocketDisconnect:
                break
            except Exception:
                break
    finally:
        manager.disconnect(ws)