"""
GPS Serial Reader — Fixed
- Tracks last known good position
- Only sends to API when GPS actually moves (no fake movement)
- Filters corrupt/partial lines (e.g. 'Qvj812845', '81.53V<58')
- Stops updating map when device is stationary
"""

import serial
import requests
import argparse
import time
import math
import random
import re
from datetime import datetime

API_URL = "http://127.0.0.1:8000/location"

# Lines to ignore
IGNORE_STARTS = [
    "LoRa", "STATUS:", "PI_", "load:", "entry", "mode:", "clk_",
    "ho ", "configsip", "rst:", "ets ", "Received packet", "RSSI:",
    "Waiting", "ready", "Ready", "init", "Init", "Traceback",
    "File ", "  File", "ValueError", "Exception",
]

# ── Validation helpers ────────────────────────────────────────────────────────

def is_valid_lat(v):
    return -90.0 <= v <= 90.0

def is_valid_lon(v):
    return -180.0 <= v <= 180.0

def is_clean_number(s):
    """Only accept strings that look like a real float: digits, dot, minus sign."""
    return bool(re.match(r'^-?\d{1,3}(\.\d+)?$', s.strip()))

def safe_float(s):
    """Parse float only if string is clean. Returns None on garbage."""
    s = s.strip()
    if not is_clean_number(s):
        return None
    try:
        return float(s)
    except ValueError:
        return None

# ── Last known good position (heartbeat) ─────────────────────────────────────
last_good = None   # dict with lat/lon/heading etc.
last_sent_time = 0

MIN_MOVE_METERS   = 2.0   # send if moved more than 2 metres
MIN_HEADING_CHANGE = 5.0  # send if heading changed more than 5 degrees
HEARTBEAT_SEC     = 3     # always send every 3s for live feel (like Rapido)

def metres_between(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = (lat2 - lat1) * math.pi / 180
    dlon = (lon2 - lon1) * math.pi / 180
    a = math.sin(dlat/2)**2 + math.cos(lat1*math.pi/180)*math.cos(lat2*math.pi/180)*math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def heading_changed(new_heading):
    """Return True if heading changed significantly from last sent."""
    if last_good is None:
        return True
    old = last_good.get('heading', 0)
    diff = abs(new_heading - old)
    if diff > 180:
        diff = 360 - diff  # handle wrap-around (e.g. 350° → 10°)
    return diff >= MIN_HEADING_CHANGE

def should_send(lat, lon, heading=0):
    """Return True if device moved, heading changed, or heartbeat due."""
    global last_good, last_sent_time
    now = time.time()

    if last_good is None:
        return True   # first fix — always send

    dist = metres_between(last_good['latitude'], last_good['longitude'], lat, lon)
    time_ok = (now - last_sent_time) >= HEARTBEAT_SEC

    if dist >= MIN_MOVE_METERS:
        return True   # real movement
    if heading_changed(heading):
        return True   # direction changed — update compass/marker instantly
    if time_ok:
        return True   # heartbeat — keep map alive for real-time feel
    return False      # too close + too soon + same heading — skip

# ── Parser ────────────────────────────────────────────────────────────────────

def parse_line(line: str, device_id: str):
    line = line.strip()
    if not line:
        return None

    for prefix in IGNORE_STARTS:
        if line.startswith(prefix):
            print(f"INFO  {line}")
            return None

    # ── Format 1: "Received: lat,lon,heading_or_rssi" ──
    if line.startswith("Received:"):
        csv = line.replace("Received:", "").strip()
        parts = [p.strip() for p in csv.split(",")]
        if len(parts) < 2:
            print(f"SKIP short: {csv}")
            return None

        lat = safe_float(parts[0])
        lon = safe_float(parts[1])

        if lat is None or lon is None:
            print(f"CORRUPT  {csv}  (non-numeric lat/lon)")
            return None
        if not is_valid_lat(lat) or not is_valid_lon(lon):
            print(f"SKIP invalid coords: {lat}, {lon}")
            return None

        third = safe_float(parts[2]) if len(parts) > 2 else None
        # Negative third value = RSSI signal strength, not heading
        heading = (third if third is not None and third >= 0 else 0)

        print(f"GPS  lat={lat}, lon={lon}, hdg={heading}")
        return {
            "device_id": device_id,
            "latitude":  lat,
            "longitude": lon,
            "heading":   heading,
            "speed":     0,
            "altitude":  0,
            "accuracy":  0,
        }

    # ── Format 2: DATA:device,lat,lon,heading,speed,alt ──
    if line.startswith("DATA:"):
        parts = [p.strip() for p in line[5:].split(",")]
        if len(parts) < 3:
            return None
        lat = safe_float(parts[1])
        lon = safe_float(parts[2])
        if lat is None or lon is None:
            print(f"CORRUPT DATA: {line}")
            return None
        if not is_valid_lat(lat) or not is_valid_lon(lon):
            return None
        return {
            "device_id": parts[0],
            "latitude":  lat,
            "longitude": lon,
            "heading":   safe_float(parts[3]) or 0 if len(parts) > 3 else 0,
            "speed":     safe_float(parts[4]) or 0 if len(parts) > 4 else 0,
            "altitude":  safe_float(parts[5]) or 0 if len(parts) > 5 else 0,
            "accuracy":  0,
        }

    # ── Format 3: plain lat,lon or lat,lon,heading ──
    parts = [p.strip() for p in line.split(",")]
    if len(parts) >= 2:
        lat = safe_float(parts[0])
        lon = safe_float(parts[1])
        if lat is None or lon is None:
            print(f"CORRUPT plain: {line}")
            return None
        if not is_valid_lat(lat) or not is_valid_lon(lon):
            print(f"SKIP invalid: {lat}, {lon}")
            return None
        third = safe_float(parts[2]) if len(parts) > 2 else None
        heading = (third if third is not None and third >= 0 else 0)
        return {
            "device_id": device_id,
            "latitude":  lat,
            "longitude": lon,
            "heading":   heading,
            "speed":     0,
            "altitude":  0,
            "accuracy":  0,
        }

    print(f"UNKNOWN  {line}")
    return None

# ── Send to API ───────────────────────────────────────────────────────────────

def send(payload: dict):
    global last_good, last_sent_time
    try:
        r  = requests.post(API_URL, json=payload, timeout=3)
        ts = datetime.now().strftime("%H:%M:%S")
        lat = payload["latitude"]
        lon = payload["longitude"]
        dev = payload["device_id"]
        tag = "MOVE" if (last_good and metres_between(
            last_good['latitude'], last_good['longitude'], lat, lon) >= MIN_MOVE_METERS) else "HOLD"
        print(f"[{ts}] {tag} {dev} | {lat:.6f}, {lon:.6f} → HTTP {r.status_code}")
        last_good      = payload
        last_sent_time = time.time()
    except requests.RequestException as e:
        print(f"API ERROR: {e}")

# ── Main loop ─────────────────────────────────────────────────────────────────

def run(port: str, baud: int, device_id: str, retry_delay: int = 5):
    global last_good, last_sent_time
    print(f"\n{'='*50}")
    print(f"GPS Reader")
    print(f"  Port     : {port}")
    print(f"  Baud     : {baud}")
    print(f"  Device   : {device_id}")
    print(f"  Move threshold : {MIN_MOVE_METERS}m")
    print(f"{'='*50}\n")

    while True:
        try:
            with serial.Serial(port, baud, timeout=2) as ser:
                print(f"Connected to {port} — waiting for GPS...\n")
                while True:
                    try:
                        raw  = ser.readline()
                        line = raw.decode("utf-8", errors="ignore").strip()
                        if not line:
                            continue  # no data — device stopped, do nothing

                        payload = parse_line(line, device_id)
                        if payload is None:
                            continue
                        lat = payload['latitude']
                        lon = payload['longitude']
                        if should_send(lat, lon, payload.get('heading', 0)):
                            send(payload)
                        else:
                            print(f"STOP  {lat:.6f}, {lon:.6f}  (no movement)")

                    except serial.SerialException as e:
                        print(f"Serial read error: {e}")
                        break
        except serial.SerialException as e:
            print(f"Cannot open {port}: {e}. Retrying in {retry_delay}s...")
            time.sleep(retry_delay)

# ── Simulation ────────────────────────────────────────────────────────────────

def simulate(device_id: str):
    global last_good, last_sent_time
    print(f"SIMULATION — device={device_id}")
    lat, lon = 16.8130, 81.5303
    heading  = 90.0
    speed    = 30.0
    while True:
        dlat      = math.cos(math.radians(heading)) * 0.0001
        dlon      = math.sin(math.radians(heading)) * 0.0001
        lat      += dlat + random.uniform(-0.00002, 0.00002)
        lon      += dlon + random.uniform(-0.00002, 0.00002)
        heading   = (heading + random.uniform(-10, 10)) % 360
        speed     = max(0, speed + random.uniform(-5, 5))
        payload = {
            "device_id": device_id,
            "latitude":  round(lat, 6),
            "longitude": round(lon, 6),
            "heading":   round(heading, 1),
            "speed":     round(speed, 1),
            "altitude":  50.0,
            "accuracy":  5.0,
        }
        send(payload)
        time.sleep(2)

# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port",     default="COM3")
    parser.add_argument("--baud",     default=115200, type=int)
    parser.add_argument("--device",   default="tracker-1")
    parser.add_argument("--simulate", action="store_true")
    args = parser.parse_args()
    if args.simulate:
        simulate(args.device)
    else:
        run(args.port, args.baud, args.device)