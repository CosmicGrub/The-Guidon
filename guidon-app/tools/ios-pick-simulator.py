#!/usr/bin/env python3
"""
Picks a concrete iOS Simulator UDID to build against, from `simctl list -j`.

Why a concrete device and not `-destination 'generic/platform=iOS Simulator'`:
a generic destination leaves the arch slice selection implicit, and on Apple
Silicon runners that is exactly where a "compiles fine, will not install"
mismatch hides. Building against the same device the app is later installed on
keeps the compiled slice and the install target the same thing.

Why this is a file rather than python embedded in ios.yml: code inside a YAML
block scalar cannot be run or tested locally, and Python's leading-whitespace
rules fight YAML's indentation rules. This has tests it can actually fail.

Reads simctl JSON on stdin. Prints one UDID, or nothing if there is no match.

Usage:
    xcrun simctl list devices available -j | ios-pick-simulator.py [--match iPhone]

Exit: 0 found (UDID on stdout) · 1 no match · 2 bad input
"""
import json
import re
import sys


def version_key(runtime_id, fallback=""):
    """Sort key for an iOS runtime.

    simctl runtime identifiers look like
    'com.apple.CoreSimulator.SimRuntime.iOS-18-2'. Comparing those as STRINGS
    ranks 'iOS-9-0' above 'iOS-18-0', which quietly selects an ancient runtime.
    Parse the numbers instead.
    """
    m = re.search(r"iOS-([0-9]+)(?:-([0-9]+))?(?:-([0-9]+))?", runtime_id or "")
    if not m:
        m = re.search(r"([0-9]+)\.([0-9]+)(?:\.([0-9]+))?", fallback or "")
    if not m:
        return (0, 0, 0)
    return tuple(int(g) if g else 0 for g in m.groups())


def pick(data, match="iPhone"):
    """Newest available runtime; among its devices, the first name containing
    `match`. Returns a UDID or None."""
    best = None  # (version_key, udid)
    for runtime_id, devices in (data.get("devices") or {}).items():
        if "iOS" not in runtime_id:
            continue
        vk = version_key(runtime_id)
        for d in devices or []:
            if not d.get("isAvailable", True):
                continue
            name = d.get("name") or ""
            if match and match.lower() not in name.lower():
                continue
            udid = d.get("udid")
            if not udid:
                continue
            # Prefer the newest runtime; ties broken by name for determinism, so
            # reruns of the same workflow pick the same device.
            key = (vk, name)
            if best is None or key > best[0]:
                best = (key, udid)
    return best[1] if best else None


def _selftest():
    """`verify the verifier` (GUIDON_PROJECT_MAP.md section 8, rule 1)."""
    data = {
        "devices": {
            "com.apple.CoreSimulator.SimRuntime.iOS-9-0": [
                {"name": "iPhone 6", "udid": "OLD", "isAvailable": True},
            ],
            "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
                {"name": "iPhone 16 Pro", "udid": "NEW", "isAvailable": True},
                {"name": "iPad Pro", "udid": "PAD", "isAvailable": True},
            ],
            "com.apple.CoreSimulator.SimRuntime.iOS-19-0": [
                {"name": "iPhone 17", "udid": "UNAVAILABLE", "isAvailable": False},
            ],
            "com.apple.CoreSimulator.SimRuntime.tvOS-18-0": [
                {"name": "Apple TV", "udid": "TV", "isAvailable": True},
            ],
        }
    }
    cases = [
        ("newest iOS beats lexically-larger old one", pick(data, "iPhone"), "NEW"),
        ("unavailable devices are skipped", pick(data, "iPhone 17"), None),
        ("non-iOS runtimes are ignored", pick(data, "Apple TV"), None),
        ("match filter selects iPad", pick(data, "iPad"), "PAD"),
        ("no match returns None", pick(data, "Pixel"), None),
        ("iOS-9-0 < iOS-18-2", version_key("x.iOS-9-0") < version_key("x.iOS-18-2"), True),
        ("empty input", pick({}, "iPhone"), None),
    ]
    failed = 0
    for label, got, want in cases:
        ok = got == want
        failed += 0 if ok else 1
        print("%s  %-42s got=%r want=%r" % ("PASS" if ok else "FAIL", label, got, want))
    print("selftest: %d/%d passed" % (len(cases) - failed, len(cases)))
    return 1 if failed else 0


def main():
    if "--selftest" in sys.argv[1:]:
        return _selftest()

    match = "iPhone"
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--match" and i + 1 < len(args):
            match = args[i + 1]
        elif a.startswith("--match="):
            match = a.split("=", 1)[1]

    try:
        data = json.load(sys.stdin)
    except Exception as exc:                       # noqa: BLE001
        print("could not parse simctl JSON: %s" % exc, file=sys.stderr)
        return 2

    udid = pick(data, match)
    if not udid:
        return 1
    print(udid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
