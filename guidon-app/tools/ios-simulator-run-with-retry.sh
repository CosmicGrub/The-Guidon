#!/usr/bin/env bash
# Wrap the strict iOS Simulator verifier with one evidence-preserving retry for
# the two transient shared-runner signatures the repo has already observed:
#   - process died after launch
#   - never progressed past the launch screen
#
# Everything else remains a hard failure. The retry runs only the failed devices
# after a clean shutdown/reboot/reinstall performed by ios-simulator-run.sh.
# Attempt-1 evidence is moved aside before retry so a green second attempt never
# erases the fact that the runner flaked.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$HERE/ios-simulator-run.sh"
OUT="$(cd "$HERE/.." && pwd)/artifacts/ios"
SUMMARY="$OUT/summary.md"

run_base() {
  bash "$BASE"
}

set +e
run_base
first_rc=$?
set -e

if [ "$first_rc" -eq 0 ]; then
  exit 0
fi

if [ ! -s "$SUMMARY" ]; then
  echo "::error::iOS verifier failed before producing a summary; not retrying"
  exit "$first_rc"
fi

cp "$SUMMARY" "$OUT/summary-attempt-1.md"

failed_csv=""
retryable=1
while IFS='|' read -r _ device result detail _; do
  device="$(printf '%s' "$device" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  result="$(printf '%s' "$result" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  detail="$(printf '%s' "$detail" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ "$result" = "FAIL" ] || continue

  case "$detail" in
    *"process died after launch"*|*"never progressed past the launch screen"*)
      failed_csv="${failed_csv:+${failed_csv},}${device}"
      ;;
    *)
      echo "::error::${device}: non-transient Simulator failure (${detail}); not retrying"
      retryable=0
      ;;
  esac
done < "$SUMMARY"

if [ "$retryable" -ne 1 ] || [ -z "$failed_csv" ]; then
  exit "$first_rc"
fi

mkdir -p "$OUT/attempt-1"
old_ifs="$IFS"
IFS=','
for device in $failed_csv; do
  slug="$(printf '%s' "$device" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -e 's/^-//' -e 's/-$//')"
  if [ -d "$OUT/$slug" ]; then
    rm -rf "$OUT/attempt-1/$slug"
    mv "$OUT/$slug" "$OUT/attempt-1/$slug"
  fi
done
IFS="$old_ifs"

echo "::warning::Transient iOS Simulator failure detected; retrying once after a clean simulator cycle: $failed_csv"

set +e
DEVICES="$failed_csv" run_base
retry_rc=$?
set -e

if [ -s "$SUMMARY" ]; then
  cp "$SUMMARY" "$OUT/summary-attempt-2.md"
fi

{
  echo "## iOS Simulator retry record"
  echo
  echo "The first pass failed only with a known transient Simulator signature."
  echo "A single clean retry was run for: \`$failed_csv\`."
  echo
  echo "### Attempt 1"
  echo
  cat "$OUT/summary-attempt-1.md"
  echo
  echo "### Attempt 2"
  echo
  if [ -s "$OUT/summary-attempt-2.md" ]; then
    cat "$OUT/summary-attempt-2.md"
  else
    echo "Retry produced no summary."
  fi
} > "$OUT/summary-retry-record.md"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat "$OUT/summary-retry-record.md" >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$retry_rc" -eq 0 ]; then
  echo "iOS Simulator retry passed; first-attempt evidence is preserved under artifacts/ios/attempt-1/."
  exit 0
fi

echo "::error::iOS Simulator retry failed; parity gate remains red"
exit "$retry_rc"
