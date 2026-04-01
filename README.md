# ESP-32 LoRa GPS Tracker

Real-time GPS tracking system using ESP-32 and LoRa communication
with a Python backend and React web dashboard.

## Hardware Photos

### GPS Receiver
![Receiver 3D](images/GPS-RX-3D.png)
![Receiver PCB](images/GPS-RX-PCB.png)
![Receiver Schematic](images/GPS-RX-SCH.png)
![Real Receiver](images/Real_Time_GPS-RX.jpeg)

### GPS Transmitter
![Transmitter 3D](images/GPS-TX-3D.png)
![Transmitter PCB](images/GPS-TX-PCB.png)
![Transmitter Schematic](images/GPS-TX-SCH.png)
![Real Transmitter](images/Real_Time_GPS-TX.jpeg)

## Project Structure
- `GPS_Tracker/` — Arduino firmware for the transmitter
- `GPS_Receiver/` — Arduino firmware for the receiver
- `serial_reader/` — Python script to read serial GPS data
- `backend/` — Python FastAPI server
- `frontend/` — React + Vite web dashboard
- `database/` — SQLite database init script
- `pcb/` — PCB and schematic design files (EasyEDA)
- `images/` — Hardware and PCB design photos

## Requirements
- ESP-32 board
- LoRa module (Ra-02 SX1278 433MHz)
- NEO-6M GPS module
- Python 3.x
- Node.js

## Backend Setup
    cd backend
    pip install -r requirements.txt
    python main.py

## Frontend Setup
    cd frontend
    npm install
    npm run dev