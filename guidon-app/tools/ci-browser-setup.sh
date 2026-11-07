#!/usr/bin/env bash
# CI helper: the apt-backed setup the Playwright test jobs need, made patient and bounded.
#
#   bash tools/ci-browser-setup.sh fonts     JetBrains Mono (the app's first-choice --font-mono; see ci.yml)
#   bash tools/ci-browser-setup.sh browser   Chromium's system libraries, then Chromium itself
#
# WHY THIS EXISTS. On 2026-11-02 one test chunk of one pull request sat in
# `playwright install --with-deps chromium` for 13 minutes: the runner's package
# mirror was serving 19 MB at about 24 kB/s, the job's 15-minute budget ran out,
# and the whole run went red although nothing in the code was wrong. A slow
# mirror is not a test failure. So:
#   * apt gives up on a stalled connection after 20 s, retries a failed one, and
#     waits for the dpkg lock instead of dying on it (a killed attempt can leave
#     an apt-get finishing in the background);
#   * every attempt is bounded (4 minutes) and there are three of them, so a
#     second try can land on a faster connection instead of waiting out the first;
#   * the fonts are a rendering nicety (see ci.yml), so they stay soft-fail but
#     can no longer eat the budget either.
# What this does NOT do: it cannot make a mirror fast. Three slow attempts of
# 4 minutes still use 12 of the job's 15 minutes and the job fails, now with a
# clear "re-run the job" message instead of a bare cancellation. apt resumes a
# partly downloaded package, so each attempt starts where the last one stopped.
# Untested against a genuinely slow mirror (none is available on demand); the
# normal path is exercised by every CI run.
set -uo pipefail

mode="${1:-}"

patient_apt() {
  printf '%s\n' \
    'Acquire::Retries "5";' \
    'Acquire::http::Timeout "20";' \
    'Acquire::https::Timeout "20";' \
    'DPkg::Lock::Timeout "180";' \
    | sudo tee /etc/apt/apt.conf.d/80-guidon-ci >/dev/null
}

case "$mode" in
  fonts)
    patient_apt
    if sudo timeout --kill-after=15 240 apt-get update -qq \
       && sudo timeout --kill-after=15 240 apt-get install -y -qq fonts-jetbrains-mono; then
      echo "fonts-jetbrains-mono installed"
    else
      echo "::warning::fonts-jetbrains-mono unavailable on this runner image (or the mirror was too slow) - mono-font-width CI/local mismatches may persist"
    fi
    ;;
  browser)
    patient_apt
    ok=0
    for attempt in 1 2 3; do
      if timeout --kill-after=15 240 npx playwright install-deps chromium; then ok=1; break; fi
      echo "::warning::browser system libraries: attempt ${attempt} of 3 failed or took over 4 minutes (a slow package mirror?); trying again"
      sleep 5
    done
    if [ "$ok" != 1 ]; then
      echo "::error::could not install the browser's system libraries after 3 attempts (the package mirror looks slow or down - re-run the job)"
      exit 1
    fi
    npx playwright install chromium
    ;;
  *)
    echo "usage: bash tools/ci-browser-setup.sh fonts|browser" >&2
    exit 2
    ;;
esac
