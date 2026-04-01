"""
Run this once to initialize the SQLite database.
Usage: python database/init_db.py
"""
import sqlite3
import os

os.makedirs("database", exist_ok=True)
conn = sqlite3.connect("database/tracker.db")
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
        event_type  TEXT,
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
print("✅ Database initialized: database/tracker.db")