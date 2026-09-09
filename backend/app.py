import os
import threading
from flask import Flask, jsonify, request, send_from_directory
from flask_socketio import SocketIO

from store import (
    load_state, save_state, get_snapshot,
    register_new_item, add_uhf_module, update_item_location_from_ping,
    state, state_lock
)
from hardware import serial_reader_loop

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.config["SECRET_KEY"] = "dev-secret-key"
socketio = SocketIO(app, cors_allowed_origins="*")

def broadcast_state():
    socketio.emit("state_update", get_snapshot())

# Static files
@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(FRONTEND_DIR, filename)

# API routes
@app.route("/api/state", methods=["GET"])
def get_state():
    return jsonify(get_snapshot())

@app.route("/api/items", methods=["POST"])
def create_item():
    payload = request.get_json(force=True) or {}
    uid = payload.get("uid")
    name = payload.get("name")
    folder_id = payload.get("folder_id", "folder-infusion")
    notes = payload.get("notes", "")

    if not uid or not name:
        return jsonify({"error": "Missing uid or name"}), 400

    register_new_item(uid, name, folder_id, notes)
    broadcast_state()
    return jsonify({"success": True, "state": get_snapshot()})

@app.route("/api/uhf/modules", methods=["POST"])
def create_module():
    payload = request.get_json(force=True) or {}
    name = payload.get("name")
    location = payload.get("location")

    if not name or not location:
        return jsonify({"error": "Missing name or location"}), 400

    module = add_uhf_module(name, location, payload.get("x"), payload.get("y"))
    broadcast_state()
    return jsonify({"success": True, "module": module})

@app.route("/api/uhf/ping", methods=["POST"])
def uhf_ping():
    payload = request.get_json(force=True) or {}
    item_uid = payload.get("item_uid")
    module_id = payload.get("module_id")

    if not item_uid or not module_id:
        return jsonify({"error": "Missing item_uid or module_id"}), 400

    event = update_item_location_from_ping(item_uid, module_id, payload.get("rssi"))
    broadcast_state()
    socketio.emit("ping_received", event)
    return jsonify({"success": True, "event": event})

# Socket.IO events
@socketio.on("connect")
def handle_connect():
    broadcast_state()

@socketio.on("manual_nfc_scan")
def handle_manual_nfc(data):
    uid = (data or {}).get("uid")
    if uid:
        handle_scanned_tag(uid)

def handle_scanned_tag(uid):
    with state_lock:
        state["pending_tag"] = uid
    save_state()
    broadcast_state()
    socketio.emit("tag_scanned", {"uid": uid})

if __name__ == "__main__":
    load_state()

    worker = threading.Thread(
        target=serial_reader_loop,
        args=(handle_scanned_tag,),
        daemon=True
    )
    worker.start()

    socketio.run(app, host="0.0.0.0", port=5050, debug=True)
