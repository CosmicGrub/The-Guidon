#!/usr/bin/env bash
# Run the strict iOS Simulator verifier one requested device at a time.
#
# Why one device at a time: simctl occasionally wedges on GitHub's shared macOS
# runners. A single unbounded simctl/bootstatus call used to strand the entire
# four-device matrix until the job-level timeout. Per-device process-group
# deadlines turn that infrastructure stall into evidence we can retry once,
# while still requiring every device to genuinely launch, paint, and progress.
#
# Retryable once:
#   - process died after launch
#   - never progressed past the launch screen
#   - the strict verifier itself exceeded the per-device deadline
# Everything else remains a hard failure. First-attempt evidence is preserved.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$HERE/ios-simulator-run.sh"
OUT="$(cd "$HERE/.." && pwd)/artifacts/ios"
SUMMARY="$OUT/summary.md"
DEVICE_TIMEOUT="${IOS_DEVICE_TIMEOUT:-180}"

mkdir -p "$OUT/attempt-1" "$OUT/summaries"

# macOS does not ship GNU timeout. Python is already a required dependency of
# this lane (the render checker uses it), so use it to supervise the whole
# process group. Killing the group matters: ios-simulator-run.sh starts log
# stream and simctl launch children that otherwise survive a killed parent.
run_timed() {
  local seconds="$1"
  shift
  python3 - "$seconds" "$@" <<'PY'
import os, signal, subprocess, sys
seconds = float(sys.argv[1])
cmd = sys.argv[2:]
p = subprocess.Popen(cmd, start_new_session=True)
try:
    rc = p.wait(timeout=seconds)
except subprocess.TimeoutExpired:
    try:
        os.killpg(p.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        p.wait()
    print(f"::warning::timed out after {seconds:g}s: {' '.join(cmd)}", file=sys.stderr)
    sys.exit(124)
sys.exit(rc)
PY
}

slug_for() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -e 's/^-//' -e 's/-$//'
}

# The base verifier writes a complete summary for the single device. Keep its
# GitHub step-summary output suppressed here; this wrapper emits one aggregate
# verdict after all devices have been checked.
run_device() {
  local device="$1"
  local saved_devices="$DEVICES"
  local saved_step_summary="${GITHUB_STEP_SUMMARY-}"
  export DEVICES="$device"
  unset GITHUB_STEP_SUMMARY
  run_timed "$DEVICE_TIMEOUT" bash "$BASE"
  local rc=$?
  export DEVICES="$saved_devices"
  if [ -n "$saved_step_summary" ]; then
    export GITHUB_STEP_SUMMARY="$saved_step_summary"
  else
    unset GITHUB_STEP_SUMMARY
  fi
  return "$rc"
}

# Output: RESULT<TAB>DETAIL. The base verifier is invoked with exactly one
# device, so the first PASS/FAIL/skipped row is the row we want.
parse_row() {
  if [ ! -s "$SUMMARY" ]; then
    printf '\t'
    return 0
  fi
  awk -F'|' '
    $3 ~ /^[[:space:]]*(PASS|FAIL|skipped)[[:space:]]*$/ {
      r=$3; d=$4
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", r)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", d)
      printf "%s\t%s", r, d
      exit
    }
  ' "$SUMMARY"
}

clean_simulators() {
  run_timed 20 xcrun simctl shutdown all >/dev/null 2>&1 || true
}

IFS=',' read -r -a DEVICE_LIST <<< "$DEVICES"
ROWS=()
overall=0
verified=0
retried=0

# Do not let a stale summary from a previous invocation influence classification.
rm -f "$SUMMARY" "$OUT/summary-retry-record.md"

for raw in "${DEVICE_LIST[@]}"; do
  device="$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$device" ] || continue
  slug="$(slug_for "$device")"

  echo "::group::Simulator verifier: $device (attempt 1)"
  rm -f "$SUMMARY"
  run_device "$device"
  first_rc=$?
  first_row="$(parse_row)"
  first_result="${first_row%%$'\t'*}"
  first_detail="${first_row#*$'\t'}"
  [ "$first_row" = "$first_result" ] && first_detail=""
  [ -s "$SUMMARY" ] && cp "$SUMMARY" "$OUT/summaries/${slug}-attempt-1.md"
  echo "::endgroup::"

  if [ "$first_rc" -eq 0 ] && [ "$first_result" = "PASS" ]; then
    verified=$((verified + 1))
    ROWS+=("| $device | PASS | ${first_detail:-launched and rendered} |")
    continue
  fi

  retryable=0
  if [ "$first_rc" -eq 124 ]; then
    retryable=1
    first_detail="simulator verifier timed out after ${DEVICE_TIMEOUT}s"
  else
    case "$first_detail" in
      *"process died after launch"*|*"never progressed past the launch screen"*) retryable=1 ;;
    esac
  fi

  if [ "$retryable" -ne 1 ]; then
    overall=1
    detail="${first_detail:-verifier failed before producing a usable device verdict}"
    echo "::error::$device: non-transient Simulator failure ($detail); not retrying"
    ROWS+=("| $device | FAIL | $detail |")
    continue
  fi

  retried=$((retried + 1))
  echo "::warning::$device: transient Simulator failure ($first_detail); retrying once"

  if [ -d "$OUT/$slug" ]; then
    rm -rf "$OUT/attempt-1/$slug"
    mv "$OUT/$slug" "$OUT/attempt-1/$slug"
  fi
  clean_simulators

  echo "::group::Simulator verifier: $device (attempt 2)"
  rm -f "$SUMMARY"
  run_device "$device"
  second_rc=$?
  second_row="$(parse_row)"
  second_result="${second_row%%$'\t'*}"
  second_detail="${second_row#*$'\t'}"
  [ "$second_row" = "$second_result" ] && second_detail=""
  [ -s "$SUMMARY" ] && cp "$SUMMARY" "$OUT/summaries/${slug}-attempt-2.md"
  echo "::endgroup::"

  if [ "$second_rc" -eq 0 ] && [ "$second_result" = "PASS" ]; then
    verified=$((verified + 1))
    ROWS+=("| $device | PASS | launched and rendered after one transient retry |")
  else
    overall=1
    if [ "$second_rc" -eq 124 ]; then
      second_detail="simulator verifier timed out again after ${DEVICE_TIMEOUT}s"
    fi
    second_detail="${second_detail:-retry failed before producing a usable device verdict}"
    echo "::error::$device: retry failed ($second_detail)"
    ROWS+=("| $device | FAIL | $second_detail |")
  fi
done

{
  echo "## iOS Simulator verification"
  echo
  echo "App: \`$APP_PATH\`"
  echo "Bundle: \`${BUNDLE_ID:-app.guidon.trainer}\`"
  echo "Per-device deadline: ${DEVICE_TIMEOUT}s"
  echo
  echo "| Device | Result | Detail |"
  echo "|---|---|---|"
  if [ "${#ROWS[@]}" -gt 0 ]; then
    for row in "${ROWS[@]}"; do echo "$row"; done
  else
    echo "| (none) | FAIL | no requested device was supplied |"
  fi
  echo
  echo "Verified devices: $verified"
  echo "Transient retries used: $retried"
  if [ "$overall" -eq 0 ] && [ "$verified" -gt 0 ] && [ "$verified" -eq "${#ROWS[@]}" ]; then
    echo
    echo "All requested devices launched, rendered, and progressed."
  else
    echo
    echo "**One or more requested devices were not verified.** The parity gate remains red."
  fi
} > "$SUMMARY"

cp "$SUMMARY" "$OUT/summary-retry-record.md"
cat "$SUMMARY"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"
fi

if [ "${#ROWS[@]}" -eq 0 ] || [ "$verified" -ne "${#ROWS[@]}" ]; then
  exit 1
fi
exit "$overall"
