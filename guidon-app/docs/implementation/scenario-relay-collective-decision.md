# Scenario Relay + Collective Decision — implementation slice

Status: implementation branch opened 2026-09-16.

This slice executes the locked sequencing in `docs/design/casualty-care-and-cohesion.md` rather than duplicating already-shipped Phase 0 work.

## Ground truth re-audit

- The three Integrated Operational Thinking scenarios are already shipped (`sc-iot-comms-blackout`, `sc-iot-motorpool-belt`, `sc-iot-range-safety`) and pinned by `tools/test-iot-scenarios.mjs` / `tools/test-consistency.mjs`.
- The counseling-process and 8-Step Training Model doctrine additions are already shipped and pinned by `tools/test-doctrine-counsel-training-accuracy.mjs`.

## Build sequence

1. Study Rooms multi-category selection — smallest cross-subject cohesion win. Preserve backwards compatibility with the existing single `category` wire value while allowing a host-side category set to compose the question pool; do not change the room protocol unless a protocol change is proven necessary.
2. Scenario Relay probe — add turn rotation at the scenario render seam without changing scenario content/schema. Reuse existing pass-the-device/handoff conventions where practical.
3. Collective Decision — add optional `discuss:true` node behavior only after the relay probe is regression-clean. A flagged node gets a visible discussion interval and one team answer; unflagged nodes retain current behavior exactly.
4. Regression coverage — existing solo scenarios must remain behaviorally unchanged; add targeted tests for category composition, relay rotation, and discuss-node behavior.

## Guardrails

- Offline-first and zero-server remain unchanged.
- No duplicate scenario collection or parallel engine.
- No live-AI dependency.
- Existing scenario schema remains valid; all additions are optional/backwards-compatible.
- Cross-platform Study Rooms protocol remains pinned unless deliberately versioned across web/Android/Tauri/guest together.
