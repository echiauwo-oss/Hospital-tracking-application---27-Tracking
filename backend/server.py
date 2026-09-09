# ============================================================
#  server.py
#  Hospital Tracker — Backend
#  Flask + Socket.IO + Serial reader for NFC + simulated UHF
# ============================================================

import json
import os
import threading
import time
from copy import deepcopy
from typing import Dict, Optional

from flask import Flask, jsonify, request, send_from_directory
from flask_socketio import SocketIO

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    serial = None

# ============================================================
#  SECTION: APP / SOCKET CONFIG
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
DATA_FILE = os.path.join(BASE_DIR, "hospital_tracker_data.json")
PORT = int(os.environ.get("APP_PORT", "5050"))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.config["SECRET_KEY"] = "hospital-tracker-demo"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ============================================================
#  SECTION: DEFAULT DATA MODEL
# ============================================================
DEFAULT_STATE = {
    "folders": [
        {"id": "folder-infusion", "name": "Infusion Pumps"},
        {"id": "folder-wheelchairs", "name": "Wheelchairs"},
        {"id": "folder-monitors", "name": "Vital Monitors"},
        {"id": "folder-beds", "name": "Beds"},
    ],
    "items": {},
    "uhf_modules": [],
    "uhf_history": [],
    "pending_tag": None,
}

state_lock = threading.Lock()
state = deepcopy(DEFAULT_STATE)

# ============================================================
#  SECTION: PERSISTENCE HELPERS
# ============================================================
def load_state() -> None:
    global state
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            with state_lock:
                state = loaded
        except Exception as exc:
            print(f"[WARN] Failed to load data file: {exc}")


def save_state() -> None:
    with state_lock:
        snapshot = deepcopy(state)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)


def get_snapshot() -> Dict:
    with state_lock:
        return deepcopy(state)


# ============================================================
#  SECTION: BUSINESS LOGIC — ITEMS / FOLDERS
# ============================================================
def emit_state() -> None:
    socketio.emit("state_update", get_snapshot())


def create_folder(name: str) -> Dict:
    folder_id = f"folder-{int(time.time() * 1000)}"
    folder = {"id": folder_id, "name": name.strip()}
    with state_lock:
        state["folders"].append(folder)
    save_state()
    emit_state()
    return folder


def register_new_item(uid: str, name: str, folder_id: str) -> Dict:
    item = {
        "uid": uid,
        "name": name.strip(),
        "folder_id": folder_id,
        "status": "IN",
        "last_confirmed_location": "Unknown",
        "last_seen_module": None,
        "pending_module": None,
        "pending_count": 0,
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
    }
    with state_lock:
        state["items"][uid] = item
        state["pending_tag"] = None
    save_state()
    emit_state()
    return item


def handle_nfc_uid(uid: str) -> None:
    with state_lock:
        item = state["items"].get(uid)
        if item:
            item["status"] = "OUT" if item["status"] == "IN" else "IN"
            item["updated_at"] = int(time.time())
        else:
            state["pending_tag"] = {
                "uid": uid,
                "detected_at": int(time.time()),
            }
    save_state()
    emit_state()
    socketio.emit("nfc_tag_detected", {"uid": uid})


# ============================================================
#  SECTION: BUSINESS LOGIC — UHF MODULES / PINGS
# ============================================================
def add_uhf_module(name: str, x: float, y: float) -> Dict:
    module = {
        "id": f"uhf-{int(time.time() * 1000)}",
        "name": name.strip() or "UHF Module",
        "x": float(x),
        "y": float(y),
    }
    with state_lock:
        state["uhf_modules"].append(module)
    save_state()
    emit_state()
    return module


def update_item_location_from_ping(uid: str, strongest_module_id: Optional[str]) -> None:
    if strongest_module_id is None:
        return

    with state_lock:
        item = state["items"].get(uid)
        if not item:
            return

        module = next((m for m in state["uhf_modules"] if m["id"] == strongest_module_id), None)
        if not module:
            return

        ping_entry = {
            "timestamp": int(time.time()),
            "uid": uid,
            "item_name": item["name"],
            "module_id": module["id"],
            "module_name": module["name"],
        }
        state["uhf_history"].append(ping_entry)
        state["uhf_history"] = state["uhf_history"][-300:]

        if item.get("pending_module") == strongest_module_id:
            item["pending_count"] = item.get("pending_count", 0) + 1
        else:
            item["pending_module"] = strongest_module_id
            item["pending_count"] = 1

        if item["pending_count"] >= 2:
            item["last_confirmed_location"] = module["name"]
            item["last_seen_module"] = strongest_module_id

        item["updated_at"] = int(time.time())

    save_state()
    emit_state()


# ============================================================
#  SECTION: SERIAL READER
# ============================================================
def auto_detect_port() -> Optional[str]:
    if serial is None:
        return None

    ports = list(serial.tools.list_ports.comports())
    preferred_terms = ["usbmodem", "usbserial", "wchusbserial", "cp210", "ch340", "uart"]

    for port in ports:
        device_text = f"{port.device} {port.description}".lower()
        if any(term in device_text for term in preferred_terms):
            return port.device
    return None


def serial_reader_loop() -> None:
    if serial is None:
        print("[WARN] pyserial not installed. NFC serial reader disabled.")
        return

    baud = int(os.environ.get("ESP32_BAUD", "115200"))

    while True:
        port = os.environ.get("ESP32_PORT") or auto_detect_port()
        if not port:
            print("[INFO] No ESP32 serial port found yet. Retrying in 3 seconds...")
            time.sleep(3)
            continue

        print(f"[INFO] Opening serial port {port} @ {baud}")
        try:
            with serial.Serial(port, baudrate=baud, timeout=1) as ser:
                print("[READY] Serial NFC listener connected.")
                while True:
                    raw = ser.readline().decode(errors="ignore").strip()
                    if not raw:
                        continue
                    print(f"[SERIAL] {raw}")
                    if raw.startswith("UID:"):
                        uid = raw.split("UID:", 1)[1].strip()
                        if uid:
                            handle_nfc_uid(uid)
        except Exception as exc:
            print(f"[WARN] Serial connection lost: {exc}")
            time.sleep(3)


# ============================================================
#  SECTION: ROUTES — STATIC FRONTEND
# ============================================================
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/state", methods=["GET"])
def api_state():
    return jsonify(get_snapshot())


# ============================================================
#  SECTION: ROUTES — FOLDERS / ITEMS
# ============================================================
@app.route("/api/folders", methods=["POST"])
def api_create_folder():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Folder name is required"}), 400
    folder = create_folder(name)
    return jsonify(folder), 201


@app.route("/api/items/register", methods=["POST"])
def api_register_item():
    data = request.get_json(force=True)
    uid = (data.get("uid") or "").strip()
    name = (data.get("name") or "").strip()
    folder_id = (data.get("folder_id") or "").strip()

    if not uid or not name or not folder_id:
        return jsonify({"error": "uid, name, and folder_id are required"}), 400

    item = register_new_item(uid, name, folder_id)
    return jsonify(item), 201


@app.route("/api/items/<uid>", methods=["PATCH"])
def api_update_item(uid: str):
    data = request.get_json(force=True)
    with state_lock:
        item = state["items"].get(uid)
        if not item:
            return jsonify({"error": "Item not found"}), 404

        if "name" in data and str(data["name"]).strip():
            item["name"] = str(data["name"]).strip()
        if "folder_id" in data and str(data["folder_id"]).strip():
            item["folder_id"] = str(data["folder_id"]).strip()
        if "status" in data and data["status"] in ["IN", "OUT"]:
            item["status"] = data["status"]
        item["updated_at"] = int(time.time())

    save_state()
    emit_state()
    return jsonify({"success": True})


# ============================================================
#  SECTION: ROUTES — UHF SIMULATION
# ============================================================
@app.route("/api/uhf/modules", methods=["POST"])
def api_add_uhf_module():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    x = data.get("x")
    y = data.get("y")

    if x is None or y is None:
        return jsonify({"error": "x and y are required"}), 400

    module = add_uhf_module(name, x, y)
    return jsonify(module), 201


@app.route("/api/uhf/modules/<module_id>", methods=["DELETE"])
def api_delete_uhf_module(module_id: str):
    with state_lock:
        original_len = len(state["uhf_modules"])
        state["uhf_modules"] = [m for m in state["uhf_modules"] if m["id"] != module_id]
        if len(state["uhf_modules"]) == original_len:
            return jsonify({"error": "Module not found"}), 404
    save_state()
    emit_state()
    return jsonify({"success": True})


@app.route("/api/uhf/ping", methods=["POST"])
def api_uhf_ping():
    data = request.get_json(force=True)
    uid = (data.get("uid") or "").strip()
    strongest_module_id = data.get("strongest_module_id")

    if not uid:
        return jsonify({"error": "uid is required"}), 400

    update_item_location_from_ping(uid, strongest_module_id)
    return jsonify({"success": True})


# ============================================================
#  SECTION: STARTUP
# ============================================================
if __name__ == "__main__":
    load_state()
    threading.Thread(target=serial_reader_loop, daemon=True).start()
    print(f"[INFO] Starting Hospital Tracker backend on http://localhost:{PORT}")
    socketio.run(app, host="0.0.0.0", port=PORT, debug=False)
