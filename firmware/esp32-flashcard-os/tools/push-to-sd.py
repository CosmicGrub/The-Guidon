#!/usr/bin/env python3
"""
Host side of the SD content loader. Talks to env:sdloader (see
src/sdloader_main.cpp for the protocol) to push ./sdcard/*'s content onto
the device's microSD card over the same USB-serial link used for flashing
- no separate SD card reader needed.

Usage (from firmware/esp32-flashcard-os/, after env:sdloader is flashed):
    python tools/push-to-sd.py COM12
    python tools/push-to-sd.py COM12 --files sdcard/cards.ndjson sdcard/categories.json
"""
import argparse
import sys
import time
from pathlib import Path

import serial


def read_line(ser, timeout_s=20):
    ser.timeout = timeout_s
    line = ser.readline().decode("utf-8", errors="replace").strip()
    return line


def push_file(ser, path: Path):
    name = "/" + path.name
    size = path.stat().st_size
    print(f"-> PUT {name} ({size} bytes)")
    ser.write(f"PUT {path.name} {size}\n".encode("ascii"))

    resp = read_line(ser)
    if resp.startswith("ERR"):
        sys.exit(f"device refused {name}: {resp}")
    if resp != "READY":
        sys.exit(f"unexpected response to PUT: {resp!r}")

    data = path.read_bytes()
    CHUNK = 512
    sent = 0
    t0 = time.time()
    while sent < len(data):
        chunk = data[sent:sent + CHUNK]
        ser.write(chunk)
        sent += len(chunk)
        if sent % (CHUNK * 40) == 0 or sent == len(data):
            pct = sent * 100 // len(data)
            print(f"   {sent}/{len(data)} bytes ({pct}%)", end="\r")
    print()

    # Read and print lines (not just wait silently for one) until DONE/ERR -
    # sdloader_main.cpp now prints its own "... N/M bytes written" progress
    # every 2s while it's still draining+writing, specifically so a slow
    # SD write (this protocol's real-device failure mode: host reports
    # 100% sent well before the device has actually consumed and written
    # all of it) is visible as "still working", not indistinguishable from
    # "silently stuck".
    resp = ""
    wait_deadline = time.time() + 120
    while time.time() < wait_deadline:
        resp = read_line(ser, timeout_s=5)
        if resp:
            print("   device:", resp)
        if resp.startswith("DONE") or resp.startswith("ERR"):
            break
    dt = time.time() - t0
    if not resp.startswith("DONE"):
        sys.exit(f"device did not confirm {name}: {resp!r}")
    written = int(resp.split()[1])
    if written != size:
        sys.exit(f"size mismatch for {name}: sent {size}, device wrote {written}")
    print(f"   OK - {written} bytes in {dt:.1f}s ({written/1024/max(dt,0.01):.0f} KB/s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", help="Serial port, e.g. COM12")
    ap.add_argument("--files", nargs="+", default=["sdcard/cards.ndjson", "sdcard/categories.json"])
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()

    paths = [Path(p) for p in args.files]
    missing = [p for p in paths if not p.exists()]
    if missing:
        sys.exit(f"missing file(s): {missing} - run tools/extract-cards.mjs first")

    ser = serial.Serial(args.port, args.baud, timeout=5)
    time.sleep(0.5)
    # DTR/RTS reset pulse, same as PlatformIO's own upload does - makes this
    # robust to being run right after a fresh flash without a manual reset.
    ser.setDTR(False); ser.setRTS(True); time.sleep(0.1); ser.setRTS(False)
    time.sleep(0.3)
    ser.reset_input_buffer()

    # Drain the boot banner until we see the loader's own readiness line.
    # Generous: sdloader now retries each of 6 candidate CS pins up to 5x
    # with a settle delay (real-device bring-up showed the correct pin
    # responding inconsistently across resets), and a FAT format over a
    # 4MHz SPI bus on a large card can itself take real time.
    deadline = time.time() + 60
    saw_ready = False
    sd_ok = False
    while time.time() < deadline:
        line = read_line(ser, timeout_s=2)
        if line:
            print("device:", line)
        if line.startswith("SD card OK"):
            saw_ready = True
            sd_ok = True
            break
        if line.startswith("ERR none of the candidate"):
            saw_ready = True
            sd_ok = False
            break
    if not saw_ready:
        sys.exit("never saw the loader's SD status line - is env:sdloader actually flashed and running?")
    if not sd_ok:
        sys.exit(
            "device found no SD card on any candidate CS pin (all failed identically at "
            "CMD0) - insert a FAT32-formatted microSD card into the device, power-cycle "
            "it, and re-run this script. This is a physical-presence issue, not a pin "
            "config bug (every plausible CS pin for this board family was already tried)."
        )

    for p in paths:
        push_file(ser, p)

    ser.write(b"EXIT\n")
    print("device:", read_line(ser, timeout_s=5))
    ser.close()
    print("All files pushed. Reflash env:flashcardos now.")


if __name__ == "__main__":
    main()
