#!/usr/bin/env bash
#
# GUIDON — boot real iOS Simulators, install the built app, launch it, and prove
# it actually RENDERED. Runs on a GitHub-hosted macOS runner; free with unlimited
# minutes while The-Guidon is a public repo.
#
# The failure this exists to catch is the classic Capacitor-on-iOS defect: the
# project compiles cleanly, the app launches, the process stays alive, and the
# WKWebView paints nothing. Everything short of looking at the pixels reports
# success.
#
# So this looks at the pixels — via tools/png-render-check.py, which judges on
# colour variety rather than PNG file size. The file-size heuristic ("under
# 25 KB means blank") was measured and rejected: a completely blank dark screen
# is 7 KB on an iPhone SE, 17 KB on a 16 Pro Max, 20.6 KB on an iPad 10th gen —
# but 28.5 KB on an iPad Pro 12.9", where it sails past a 25 KB threshold and
# reports success while the app renders nothing. The threshold tracks screen
# area, not correctness, so it breaks silently as the device matrix grows. It is
# also theme-dependent: GUIDON's palettes run from #ffffff to #000000. Colour
# variety is independent of both: blank scores 1-2, a real screen scores 853.
#
# Inputs (environment):
#   APP_PATH  absolute path to the built App.app            (required)
#   DEVICES   comma-separated Simulator device names        (required)
#   BUNDLE_ID app bundle identifier                         (default app.guidon.trainer)
#   SETTLE    seconds to wait for the corpus to parse+paint (default 30)
#
# Output: artifacts/ios/<device>/ screenshots + logs, and artifacts/ios/summary.md
# Exit:   0 every device rendered · 1 any device failed

set -uo pipefail

APP_PATH="${APP_PATH:?APP_PATH is required}"
DEVICES="${DEVICES:?DEVICES is required}"
# Prefer the id baked into the built app; a hard-coded default would report a
# pbxproj/capacitor.config divergence as a misleading "launch failed".
BUNDLE_ID="${BUNDLE_ID:-}"
if [ -z "$BUNDLE_ID" ] && [ -f "$APP_PATH/Info.plist" ]; then
  BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$APP_PATH/Info.plist" 2>/dev/null || true)"
fi
BUNDLE_ID="${BUNDLE_ID:-app.guidon.trainer}"
SETTLE="${SETTLE:-30}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/.." && pwd)/artifacts/ios"
CHECK="$HERE/png-render-check.py"

mkdir -p "$OUT"
SUMMARY="$OUT/summary.md"
: > "$SUMMARY"

overall=0
verified=0   # devices that actually completed a launch+render check
ROWS=()

say() { printf '%s\n' "$*"; }
group() { printf '::group::%s\n' "$*"; }
endgroup() { printf '::endgroup::\n'; }
err() { printf '::error::%s\n' "$*"; }
warn() { printf '::warning::%s\n' "$*"; }

# Resolve a Simulator device NAME to a UDID, creating the device if this Xcode
# image does not ship it. Runtime availability drifts between Xcode releases, so
# a fixed device list has to be able to heal itself rather than fail the run.
#
# EVERY diagnostic in here goes to stderr. This function's STDOUT is captured by
# `udid="$(resolve_udid ...)"`, so a stray `say` on the create path silently
# concatenates its own log line onto the UDID - measured at 126 characters of
# prose, after which every simctl call using it fails. The create path is
# exactly the missing-device path this function exists for, so the bug would
# only ever appear on the runs that need it most.
#
# Parsed from `-j` JSON rather than the human-readable listing, which Apple
# reformats between releases and which has broken grep-based scripts before.
resolve_udid() {
  local name="$1" udid runtime devicetype

  udid="$(xcrun simctl list devices available -j 2>/dev/null | python3 -c '
import json, sys
name = sys.argv[1]
data = json.load(sys.stdin)
for runtime, devices in data.get("devices", {}).items():
    if "iOS" not in runtime:
        continue
    for d in devices:
        if d.get("name") == name and d.get("isAvailable", True):
            print(d["udid"])
            sys.exit(0)
' "$name" 2>/dev/null)"

  if [ -n "$udid" ]; then
    printf '%s' "$udid"
    return 0
  fi

  # Absent — try to create it. That needs BOTH a matching devicetype and an
  # installed iOS runtime, and they fail for different reasons worth separating.
  devicetype="$(xcrun simctl list devicetypes -j 2>/dev/null | python3 -c '
import json, sys
name = sys.argv[1]
for d in json.load(sys.stdin).get("devicetypes", []):
    if d.get("name") == name:
        print(d["identifier"])
        sys.exit(0)
' "$name" 2>/dev/null)"

  if [ -z "$devicetype" ]; then
    warn "no Simulator devicetype named '${name}' in this Xcode image - skipping" >&2
    return 1
  fi

  runtime="$(xcrun simctl list runtimes -j 2>/dev/null | python3 -c '
import json, sys
best = None
for r in json.load(sys.stdin).get("runtimes", []):
    if not r.get("isAvailable"):
        continue
    if "iOS" not in r.get("name", ""):
        continue
    v = tuple(int(x) for x in r.get("version", "0").split(".") if x.isdigit())
    if best is None or v > best[0]:
        best = (v, r["identifier"])
print(best[1] if best else "")
' 2>/dev/null)"

  if [ -z "$runtime" ]; then
    warn "no available iOS runtime to create '${name}' on - skipping" >&2
    return 1
  fi

  udid="$(xcrun simctl create "$name" "$devicetype" "$runtime" 2>/dev/null)" || {
    warn "could not create Simulator '${name}' - skipping" >&2
    return 1
  }
  say "created Simulator '${name}' (${udid}) on ${runtime}" >&2
  printf '%s' "$udid"
}

IFS=',' read -r -a DEVICE_LIST <<< "$DEVICES"

for raw in "${DEVICE_LIST[@]}"; do
  # Trim surrounding whitespace so "a, b" works as well as "a,b".
  name="$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$name" ] || continue

  slug="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -e 's/^-//' -e 's/-$//')"
  dir="$OUT/$slug"
  mkdir -p "$dir"

  group "Simulator: $name"

  udid="$(resolve_udid "$name")" || {
    ROWS+=("| $name | skipped | device unavailable in this Xcode image |")
    endgroup
    continue
  }
  say "udid=$udid"

  # A clean slate per device: a still-booted sim can hold a stale install and
  # make a broken build look fine.
  xcrun simctl shutdown all >/dev/null 2>&1 || true
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true

  # bootstatus blocks until the device is actually usable. Polling with sleep is
  # a race; this is the supported wait.
  if ! xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1; then
    err "$name: device never finished booting"
    ROWS+=("| $name | FAIL | never finished booting |")
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    endgroup
    continue
  fi

  # Pin the status bar so screenshots diff cleanly across runs. Must come AFTER
  # boot - on a shutdown device this silently does nothing.
  xcrun simctl status_bar "$udid" override \
    --time "09:41" --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3 \
    >/dev/null 2>&1 || true

  if ! xcrun simctl install "$udid" "$APP_PATH" >"$dir/install.log" 2>&1; then
    err "$name: install failed"
    sed -n '1,40p' "$dir/install.log" || true
    ROWS+=("| $name | FAIL | install failed |")
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    endgroup
    continue
  fi

  # Stream this app's system log in the background, so a crash or a WKWebView
  # error arrives with evidence attached instead of needing a rerun to diagnose.
  xcrun simctl spawn "$udid" log stream --style compact \
    --predicate 'processImagePath CONTAINS "App"' > "$dir/system.log" 2>/dev/null &
  logpid=$!

  # Capability probe (collective P2): --console-pty keeps simctl attached and
  # streams the app's stdout - Capacitor iOS forwards console.log through its
  # Console plugin - so the app's one `GUIDON_CAPS <json>` line (printed on
  # load when web/ was built with GUIDON_CAPS_PROBE=1, see tools/build.mjs)
  # lands in console.log. Attached means blocking, so it runs in the
  # background; "launched" is judged by that process still being attached
  # 2 s later plus the launchctl check below, not by simctl's return string.
  : > "$dir/console.log"
  xcrun simctl launch --console-pty "$udid" "$BUNDLE_ID" > "$dir/console.log" 2>&1 &
  launchpid=$!
  sleep 2
  if ! kill -0 "$launchpid" 2>/dev/null; then
    launch_out="$(head -c 400 "$dir/console.log" 2>/dev/null)"
    err "$name: launch failed - $launch_out"
    kill "$logpid" 2>/dev/null || true
    ROWS+=("| $name | FAIL | launch failed |")
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    endgroup
    continue
  fi
  say "launch: attached (pid $launchpid), console streaming to $dir/console.log"

  # First frame, immediately: this is the launch screen. It is the reference the
  # late frame is compared against, because a colour check alone cannot tell a
  # BRANDED launch screen from a rendered app - measured, a GUIDON-branded launch
  # screen scores 427 distinct colours and passes as "rendered" while the web
  # view never loaded.
  early="$dir/launch-early.png"
  xcrun simctl io "$udid" screenshot "$early" >/dev/null 2>&1 || true

  # web/index.html was ~4.3 MB with a 1,014-card seed when SETTLE=12 was
  # picked; the collective/desktop work landed since then grew it to
  # ~12.8 MB (measured 2026-09-05/06 - room core, capability registry,
  # onboarding/callsign work, all single-source and inline), and this
  # pipeline's first real CI run (2026-09-06) failed exactly the way a too-
  # short settle would: 2 of 4 Simulators (iPhone 16, iPhone 16 Pro Max)
  # never progressed past the launch screen (0.00% change between the early
  # and late screenshot - see the "progress" check below) while the other
  # two (iPhone SE 3rd gen, iPad 10th gen) rendered fine. console.log for
  # the failing pair shows a real "JS Eval error" logged by Capacitor's
  # bridge during initial script evaluation, ahead of GUIDON_CAPS still
  # printing moments later - consistent with a WKWebView still working
  # through a much larger inline script than this budget assumed, on a
  # shared GitHub-hosted macOS runner, not a deterministic per-device
  # difference (Simulators do not throttle CPU by device model). Not fully
  # confirmed without an interactive WebKit inspector on the runner itself,
  # so this is the best-supported fix from the evidence available - watch
  # the next real run.
  sleep "$SETTLE"

  # Is the process still alive? launchctl must run INSIDE the simulator via
  # `simctl spawn` - a bare `launchctl list` inspects the macOS runner instead,
  # where the bundle id never appears, so it would "prove" nothing while looking
  # like a real check.
  alive=1
  lc="$(xcrun simctl spawn "$udid" launchctl list 2>/dev/null | grep "UIKitApplication:${BUNDLE_ID}" | head -1)"
  if [ -z "$lc" ]; then
    alive=0
  else
    # A "-" in the PID column means registered but not running.
    pidcol="$(printf '%s' "$lc" | awk '{print $1}')"
    [ "$pidcol" = "-" ] && alive=0
  fi

  shot="$dir/launch.png"
  xcrun simctl io "$udid" screenshot "$shot" >/dev/null 2>&1 || true

  kill "$logpid" 2>/dev/null || true
  kill "$launchpid" 2>/dev/null || true

  # Capability probe -> artifacts/ios/<device>/caps.json with isVirtual:true:
  # tools/caps-matrix.mjs records and labels a Simulator column, and never
  # counts it as device evidence (X16). No line is a warning, not a failure
  # - rendering is this script's verdict - and means web/ was built without
  # GUIDON_CAPS_PROBE=1, or the app never reached the probe. Same record
  # shape tools/caps-probe.mjs writes for the other collectors.
  capsline="$(grep -a -m1 'GUIDON_CAPS {' "$dir/console.log" 2>/dev/null | sed -e 's/^.*GUIDON_CAPS //' || true)"
  if [ -n "$capsline" ]; then
    if printf '%s' "$capsline" | python3 -c '
import json, sys, datetime
slug = sys.argv[1]
payload = json.load(sys.stdin)
rec = {
  "schema": 1,
  "collector": "tools/ios-simulator-run.sh",
  "collectedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "engine": "ios",
  "device": slug,
  "fork": payload.get("fork"),
  "sha": payload.get("sha"),
  "loopback": False,
  "isVirtual": True,
  "engineOnly": False,
  "note": "iOS Simulator via simctl launch --console-pty - simulator, never device evidence",
  "probe": payload,
}
json.dump(rec, sys.stdout, indent=2)
sys.stdout.write("\n")
' "$slug" > "$dir/caps.json"; then
      say "caps: wrote $dir/caps.json (Simulator, isVirtual:true)"
    else
      warn "$name: GUIDON_CAPS line found but did not parse as JSON - caps.json not written"
      rm -f "$dir/caps.json"
    fi
  else
    warn "$name: no GUIDON_CAPS line in console.log - web/ built without GUIDON_CAPS_PROBE=1, or the probe never ran"
  fi

  # Collect any crash report before tearing the device down.
  if [ -d "$HOME/Library/Logs/DiagnosticReports" ]; then
    crashes="$(find "$HOME/Library/Logs/DiagnosticReports" -name '*.ips' -newermt '-10 minutes' 2>/dev/null | head -5)"
    if [ -n "$crashes" ]; then
      mkdir -p "$dir/crashes"
      while IFS= read -r c; do
        [ -n "$c" ] && cp "$c" "$dir/crashes/" 2>/dev/null || true
      done <<< "$crashes"
    fi
  fi

  status="PASS"
  detail=""

  if [ "$alive" -eq 0 ]; then
    status="FAIL"
    detail="process died after launch"
    err "$name: $detail"
  fi

  if [ ! -s "$shot" ]; then
    status="FAIL"
    detail="${detail:+$detail; }no screenshot captured"
    err "$name: no screenshot captured"
  else
    # Two independent proofs, because the two failure shapes are different:
    #   1. colour variety  -> the web view painted something, not a flat fill
    #   2. frame change    -> the app moved PAST the launch screen
    # Either alone is defeatable; together they are not.
    render="$(python3 "$CHECK" "$shot" 2>&1)"
    rc=$?
    say "render: $render"
    if [ "$rc" -eq 2 ]; then
      status="FAIL"
      detail="${detail:+$detail; }screenshot could not be decoded"
      err "$name: screenshot could not be decoded"
    elif [ "$rc" -ne 0 ]; then
      status="FAIL"
      detail="${detail:+$detail; }WKWebView rendered blank"
      err "$name: app launched but the WKWebView rendered blank"
    fi

    if [ -s "$early" ]; then
      progress="$(python3 "$CHECK" --compare "$early" "$shot" 2>&1)"
      prc=$?
      say "progress: $progress"
      if [ "$prc" -eq 1 ]; then
        status="FAIL"
        detail="${detail:+$detail; }never progressed past the launch screen"
        err "$name: the screen never changed after launch - stuck on the launch screen"
      fi
    else
      warn "$name: no early frame captured, launch-screen check skipped"
    fi
  fi

  verified=$((verified + 1))
  [ "$status" = "PASS" ] || overall=1
  ROWS+=("| $name | $status | ${detail:-launched and rendered} |")

  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  endgroup
done

{
  echo "## iOS Simulator verification"
  echo
  echo "App: \`$APP_PATH\`"
  echo "Bundle: \`$BUNDLE_ID\`"
  echo
  echo "| Device | Result | Detail |"
  echo "|---|---|---|"
  # macOS ships bash 3.2, where "${ARR[@]}" on an EMPTY array is an unbound
  # variable error under `set -u` - so a run where every device was skipped
  # would abort here instead of reporting that it skipped everything.
  if [ "${#ROWS[@]}" -gt 0 ]; then
    for r in "${ROWS[@]}"; do echo "$r"; done
  else
    echo "| (none) | skipped | no requested device was available |"
  fi
  echo
  if [ "$verified" -eq 0 ]; then
    echo "**No device was verified.** Every requested device was unavailable in this Xcode"
    echo "image, so nothing was proven. Treated as a failure: a run that checks nothing"
    echo "must not report green."
  elif [ "$overall" -eq 0 ]; then
    echo "All $verified device(s) launched and rendered."
  else
    echo "**One or more devices failed.** Screenshots and system logs are in the \`ios-simulator-evidence\` artifact."
  fi
} > "$SUMMARY"

cat "$SUMMARY"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"

# A run that verified nothing is a failed run. macos-latest rolls Xcode versions
# on its own, so a renamed device silently shrinks the matrix - without this the
# matrix could shrink to zero and every run would still report green.
if [ "$verified" -eq 0 ]; then
  err "no device was verified - the matrix resolved to nothing"
  exit 1
fi

exit "$overall"
