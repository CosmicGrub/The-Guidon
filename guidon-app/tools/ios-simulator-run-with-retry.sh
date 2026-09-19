#!/usr/bin/env bash
# Run the strict iOS Simulator verifier one requested device at a time, under a
# per-device deadline, with ONE evidence-preserving retry for the transient
# shared-runner failures this repo has actually observed.
#
# Why one device at a time: simctl occasionally wedges on GitHub's shared macOS
# runners. A single unbounded simctl/bootstatus call used to strand the entire
# four-device matrix until the job-level timeout. Per-device process-group
# deadlines turn that infrastructure stall into evidence we can retry once,
# while still requiring every device to genuinely launch, paint, and progress.
#
# HISTORY - read before touching the deadline. This bounded design was merged
# in PR #175 (71a99aa) with a 180 s deadline, and every run with it failed:
# all four devices "timed out after 180s", twice (Actions runs 35264261831,
# 35271164875, 35278471499). A HEALTHY device takes far longer than that on a
# shared runner - measured on green run 35420907914 (2026-09-19): iPhone SE
# 200 s, iPhone 16 261 s, iPhone 16 Pro Max 288 s, iPad (10th gen) 379 s
# (and 214-220 s each on run 35421907521 the same day), because
# ios-simulator-run.sh boots a cold runtime and then deliberately waits
# SETTLE=45 s. A "release: normalize" commit (24ff2fa) then quietly put
# the first, unbounded draft back, which made CI green again by dropping the
# protection instead of fixing the number - and nothing noticed, because this
# script had no test. It has one now: tools/test-ios-retry-wrapper.mjs drives
# it with a stub verifier on any OS. The default deadline is 600 s: about
# 1.6x the slowest healthy device, so only a genuine wedge trips it.
#
# Retryable once - and ONLY when every clause of the verifier's detail is one
# of these (the verifier joins clauses with "; "):
#   - process died after launch
#   - never progressed past the launch screen
#   - the strict verifier itself exceeded the per-device deadline
# Both observed flake shapes fit that rule ("never progressed past the launch
# screen" alone, and "process died after launch; never progressed past the
# launch screen"). Anything else is a hard failure, including a transient
# clause that arrives WITH a real one: "process died after launch; WKWebView
# rendered blank" is the blank-web-view defect this lane exists to catch, and
# the old substring match retried it. A crash report naming the app is also
# never retried: a runner SIGTERM leaves no .ips behind, a real crash (bad
# access, a missing privacy usage string) does.
# First-attempt evidence is preserved under artifacts/ios/attempt-1/.
#
# Inputs (environment), on top of what ios-simulator-run.sh reads:
#   IOS_DEVICE_TIMEOUT  seconds one device may take per attempt   (default 600)
#   IOS_TOTAL_BUDGET    seconds this whole script may spend          (default 2700)
#                       Every attempt's deadline is cut to what is left of it,
#                       a retry is only started when a full deadline still
#                       fits, and a device whose turn comes after it is spent
#                       is reported "not run" - so this script, not the 60 min
#                       job timeout, writes the verdict. Without it four wedged
#                       devices cost 4 x 600 s + two retries = the whole hour.
#   IOS_VERIFIER        verifier to run (default: ios-simulator-run.sh next to
#                       this file). Exists so the wrapper itself can be tested.
#   IOS_EVIDENCE_DIR    evidence directory (default: ../artifacts/ios). The
#                       verifier reads the same variable, so both agree.

set -uo pipefail

APP_PATH="${APP_PATH:?APP_PATH is required}"
DEVICES="${DEVICES:?DEVICES is required}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${IOS_VERIFIER:-$HERE/ios-simulator-run.sh}"
OUT="${IOS_EVIDENCE_DIR:-$(cd "$HERE/.." && pwd)/artifacts/ios}"
export IOS_EVIDENCE_DIR="$OUT"
SUMMARY="$OUT/summary.md"
DEVICE_TIMEOUT="${IOS_DEVICE_TIMEOUT:-600}"
TOTAL_BUDGET="${IOS_TOTAL_BUDGET:-2700}"
BUNDLE="${BUNDLE_ID:-app.guidon.trainer}"
STARTED="$(date +%s)"

# Both numbers go into shell arithmetic; "10m" or an empty override would turn
# the deadline into a syntax error halfway through the matrix.
case "$DEVICE_TIMEOUT" in ''|*[!0-9]*|0) echo "::error::IOS_DEVICE_TIMEOUT must be a whole number of seconds above 0 (got '$DEVICE_TIMEOUT')"; exit 2 ;; esac
case "$TOTAL_BUDGET" in ''|*[!0-9]*) echo "::error::IOS_TOTAL_BUDGET must be a whole number of seconds (got '$TOTAL_BUDGET')"; exit 2 ;; esac

mkdir -p "$OUT/attempt-1" "$OUT/summaries"

# macOS does not ship GNU timeout. Python is already a required dependency of
# this lane (the render checker uses it), so use it to supervise the whole
# process group. Killing the group matters: ios-simulator-run.sh starts log
# stream and simctl launch children that otherwise survive a killed parent.
# Where Python cannot signal a process group (Windows, where only the wrapper's
# own test runs) GNU timeout does the same job; with neither, refuse to run
# rather than run unbounded and call it bounded.
if python3 -c 'import os, sys; sys.exit(0 if hasattr(os, "killpg") else 1)' >/dev/null 2>&1; then
  TIMER="python"
elif timeout --version >/dev/null 2>&1; then
  TIMER="gnu"
else
  echo "::error::neither python3 (with os.killpg) nor GNU timeout is available - cannot enforce the per-device deadline"
  exit 2
fi

run_timed() {
  local seconds="$1"
  shift
  if [ "$TIMER" = "gnu" ]; then
    timeout --signal=TERM --kill-after=5 "$seconds" "$@"
    local rc=$?
    # 137 = the command ignored TERM and GNU timeout had to KILL it.
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
      echo "::warning::timed out after ${seconds}s: $*" >&2
      return 124
    fi
    return "$rc"
  fi
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
  local deadline="$2"
  local saved_devices="$DEVICES"
  local saved_step_summary="${GITHUB_STEP_SUMMARY-}"
  export DEVICES="$device"
  unset GITHUB_STEP_SUMMARY
  run_timed "$deadline" bash "$BASE"
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

# Transient only when EVERY "; "-separated clause is a known runner flake.
is_transient_detail() {
  local detail="$1" clause rest
  [ -n "$detail" ] || return 1
  rest="$detail"
  while [ -n "$rest" ]; do
    clause="${rest%%;*}"
    if [ "$clause" = "$rest" ]; then rest=""; else rest="${rest#*;}"; fi
    clause="$(printf '%s' "$clause" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$clause" in
      "process died after launch"|"never progressed past the launch screen") ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# A crash report that names the app means the app itself crashed. The verifier
# copies every recent .ips (other processes' too), so match on the bundle id.
app_crash_report() {
  local dir="$OUT/$1/crashes" f
  [ -d "$dir" ] || return 1
  for f in "$dir"/*.ips; do
    [ -f "$f" ] || continue
    if grep -q "\"bundleID\"[[:space:]]*:[[:space:]]*\"$BUNDLE\"" "$f" 2>/dev/null; then
      printf '%s' "$(basename "$f")"
      return 0
    fi
  done
  return 1
}

clean_simulators() {
  run_timed 20 xcrun simctl shutdown all >/dev/null 2>&1 || true
}

IFS=',' read -r -a DEVICE_LIST <<< "$DEVICES"
ROWS=()
RETRY_LOG=()
overall=0
verified=0
retried=0

# Do not let a stale summary from a previous invocation influence classification.
rm -f "$SUMMARY" "$OUT/summary-retry-record.md"

for raw in "${DEVICE_LIST[@]}"; do
  device="$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$device" ] || continue
  slug="$(slug_for "$device")"

  # What is left of the budget bounds this attempt too, not only retries.
  remaining=$(( TOTAL_BUDGET - ($(date +%s) - STARTED) ))
  if [ "$remaining" -le 0 ]; then
    overall=1
    echo "::error::$device: not run - the ${TOTAL_BUDGET}s budget was spent on the devices before it"
    ROWS+=("| $device | FAIL | not run: the job's time budget was spent before this device's turn |")
    continue
  fi
  deadline="$DEVICE_TIMEOUT"
  [ "$remaining" -lt "$deadline" ] && deadline="$remaining"

  echo "::group::Simulator verifier: $device (attempt 1, deadline ${deadline}s)"
  rm -f "$SUMMARY"
  run_device "$device" "$deadline"
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
    first_detail="simulator verifier timed out after ${deadline}s"
  elif [ "$first_result" = "FAIL" ] && is_transient_detail "$first_detail"; then
    retryable=1
  fi

  if [ "$retryable" -eq 1 ]; then
    crash="$(app_crash_report "$slug")" && {
      retryable=0
      first_detail="${first_detail}; the app left a crash report (${crash})"
    }
  fi

  if [ "$retryable" -ne 1 ]; then
    overall=1
    detail="${first_detail:-verifier failed before producing a usable device verdict}"
    echo "::error::$device: non-transient Simulator failure ($detail); not retrying"
    ROWS+=("| $device | FAIL | $detail |")
    continue
  fi

  elapsed=$(( $(date +%s) - STARTED ))
  if [ $((elapsed + DEVICE_TIMEOUT)) -gt "$TOTAL_BUDGET" ]; then
    overall=1
    echo "::error::$device: transient Simulator failure ($first_detail), but ${elapsed}s of the ${TOTAL_BUDGET}s budget is spent - no time for a retry"
    ROWS+=("| $device | FAIL | $first_detail; not retried, the job's time budget was spent |")
    continue
  fi

  retried=$((retried + 1))
  RETRY_LOG+=("- \`$device\` - $first_detail ($(date -u +%Y-%m-%dT%H:%M:%SZ))")
  echo "::warning::$device: transient Simulator failure ($first_detail); retrying once"

  if [ -d "$OUT/$slug" ]; then
    rm -rf "$OUT/attempt-1/$slug"
    mv "$OUT/$slug" "$OUT/attempt-1/$slug"
  fi
  clean_simulators

  # The budget check above guarantees a full deadline fits for the retry.
  echo "::group::Simulator verifier: $device (attempt 2, deadline ${DEVICE_TIMEOUT}s)"
  rm -f "$SUMMARY"
  run_device "$device" "$DEVICE_TIMEOUT"
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
  echo "Bundle: \`$BUNDLE\`"
  echo "Per-device deadline: ${DEVICE_TIMEOUT}s (whole run: ${TOTAL_BUDGET}s)"
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
  # One line per flake, so the retry RATE is visible run over run instead of
  # disappearing behind a green tick.
  if [ "${#RETRY_LOG[@]}" -gt 0 ]; then
    echo
    echo "Retried (first-attempt evidence is under \`attempt-1/\`):"
    for line in "${RETRY_LOG[@]}"; do echo "$line"; done
  fi
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
