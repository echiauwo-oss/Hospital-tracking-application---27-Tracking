import json
import os
import threading
import time
import uuid
from copy import deepcopy

DATA_FILE = os.path.join(os.path.dirname(__file__), "hospital_tracker_data.json")

DEFAULT_STATE = {
    "folders": [
        {"id": "folder-infusion", "name": "Infusion Pumps"},
        {"id": "folder-wheelchairs", "name": "Wheelchairs"},
        {"id": "folder-monitors", "name": "Vital Monitors"},
        {"id": "folder-beds", "name": "Beds"}
    ],
    "items": {},
    "uhf_modules": [],
    "uhf_history": [],
    "pending_tag": None
}

state_lock = threading.Lock()
state = deepcopy(DEFAULT_STATE)

def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def load_state():
    global state
    if not os.path.exists(DATA_FILE):
        save_state()
        return

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            loaded = json.load(f)
            with state_lock:
                state = {
                    "folders": loaded.get("folders", DEFAULT_STATE["folders"]),
                    "items": loaded.get("items", {}),
                    "uhf_modules": loaded.get("uhf_modules", []),
                    "uhf_history": loaded.get("uhf_history", []),
                    "pending_tag": loaded.get("pending_tag", None)
                }
    except Exception as err:
        print(f"Failed to load state: {err}")

def save_state():
    with state_lock:
        snapshot = deepcopy(state)
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)
    except Exception as err:
        print(f"Failed to save state: {err}")

def get_snapshot():
    with state_lock:
        return deepcopy(state)

def register_new_item(uid, name, folder_id, notes=""):
    with state_lock:
        state["items"][uid] = {
            "uid": uid,
            "name": name,
            "folder_id": folder_id,
            "notes": notes,
            "created_at": now_iso(),
            "last_seen_location": "NFC Registration Desk",
            "last_seen_module": None,
            "last_seen_time": now_iso(),
            "last_seen_type": "nfc"
        }
        if state.get("pending_tag") == uid:
            state["pending_tag"] = None
    save_state()

def add_uhf_module(name, location, x=None, y=None):
    module_id = f"uhf-{uuid.uuid4().hex[:6]}"
    with state_lock:
        module_data = {
            "id": module_id,
            "name": name,
            "location": location,
            "x": x,
            "y": y,
            "registered_at": now_iso()
        }
        state["uhf_modules"].append(module_data)
    save_state()
    return module_data

def update_item_location_from_ping(item_uid, module_id, rssi=None):
    with state_lock:
        matched_module = next((m for m in state["uhf_modules"] if m["id"] == module_id), None)
        location_label = matched_module["location"] if matched_module else "Unknown UHF Node"

        if item_uid not in state["items"]:
            state["items"][item_uid] = {
                "uid": item_uid,
                "name": f"Unregistered ({item_uid})",
                "folder_id": "folder-infusion",
                "notes": "Auto-created from UHF scan",
                "created_at": now_iso(),
                "last_seen_location": location_label,
                "last_seen_module": module_id,
                "last_seen_time": now_iso(),
                "last_seen_type": "uhf"
            }
        else:
            state["items"][item_uid]["last_seen_location"] = location_label
            state["items"][item_uid]["last_seen_module"] = module_id
            state["items"][item_uid]["last_seen_time"] = now_iso()
            state["items"][item_uid]["last_seen_type"] = "uhf"

        event = {
            "item_uid": item_uid,
            "module_id": module_id,
            "location": location_label,
            "rssi": rssi,
            "timestamp": now_iso()
        }
        state["uhf_history"].insert(0, event)
        state["uhf_history"] = state["uhf_history"][:100]

    save_state()
    return event
