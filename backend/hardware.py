import os
import time

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    serial = None

BAUD_RATE = 115200

def find_serial_port():
    override = os.environ.get("ESP32_PORT")
    if override:
        return override

    if serial is None:
        return None

    ports = serial.tools.list_ports.comports()
    for port in ports:
        desc = (port.description or "").lower()
        dev = (port.device or "").lower()
        if any(term in desc or term in dev for term in ["usb", "uart", "cp210", "ch340"]):
            return port.device

    if ports:
        return ports[0].device
    return None

def serial_reader_loop(on_tag_received):
    """Monitors serial input from the ESP32 and runs a callback on every UID."""
    if serial is None:
        print("pyserial not installed; skipping hardware reader thread.")
        return

    while True:
        port = find_serial_port()
        if not port:
            time.sleep(3)
            continue

        try:
            print(f"Connecting to ESP32 on {port}...")
            with serial.Serial(port, BAUD_RATE, timeout=1) as ser:
                print(f"Connected to ESP32 on {port}")
                while True:
                    raw_line = ser.readline().decode("utf-8", errors="ignore").strip()
                    if not raw_line:
                        continue

                    # Expected serial format: "NFC_TAG: <UID>" or a direct hex UID
                    if "NFC_TAG:" in raw_line:
                        tag_uid = raw_line.split("NFC_TAG:")[1].strip()
                    else:
                        tag_uid = raw_line.strip()

                    if tag_uid:
                        on_tag_received(tag_uid)
        except Exception as err:
            print(f"Serial connection error: {err}")
            time.sleep(2)
