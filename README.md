# Real-Time Hospital Equipment & Asset Tracker

An end-to-end IoT asset tracking prototype integrating microcontroller hardware polling, real-time backend state synchronization, and an interactive spatial simulation dashboard as a replacement for missing hardware at time of presentation.

## 1. Problem Context & Objectives
In hospital ward environments, misplaced high-value mobile equipment (such as infusion pumps, vital sign monitors, and specialized beds) causes critical delays in patient care and thousands of hours in lost nursing productivity. 

This project demonstrates working 

**hybrid tracking architecture**:

* **NFC Physical Registration Desk:** High-confidence physical enrollment and check-in via hardware scanning.
* **UHF Trilateration Simulation:** Spatial floorplan module mapping equipment tags to simulated radio frequency gateway zones.
* **Low-Latency Ward Telemetry:** Real-time state replication across connected clinical terminals via WebSockets.

---

## 2. System Architecture

```text
[ Hardware Layer ]
  ESP32-C3 Super Mini + PN532 NFC Module
         │
         │  (USB Serial @ 115200 baud)
         ▼
[ Ingestion & Event Bus ]
  backend/hardware.py (Serial worker thread)
         │
         │  (Thread callback)
         ▼
[ Core State Engine ]
  backend/server.py (Flask + Flask-SocketIO)
         │
         ├── Persistence Layer (backend/store.py ➔ hospital_tracker_data.json)
         │
         └── WebSocket Event Broadcast (socketio.emit('state_update'))
                    │
                    ▼
[ Presentation Layer ]
  frontend/ (Single-page dashboard: app.js, style.css, index.html)
    ├── NFC Device Registration Modal
    ├── Ward Inventory Explorer
    └── UHF Floorplan Simulation Grid
