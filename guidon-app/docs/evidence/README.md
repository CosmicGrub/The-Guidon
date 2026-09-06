# docs/evidence - spike measurements (guidon-probe/1)

Measured facts from the P0 network spike (8-9 September 2026) and any
later probe live here as JSON, one file per measurement. **Nothing in
this directory is committed without Chris saying so, each time** - the
files are evidence for a decision, not part of the app.

## The format: `guidon-probe/1`

Every file is one JSON object with at least:

```json
{
  "schema": "guidon-probe/1",
  "kind": "android-ws | room-server | manual | ...",
  "at": "2026-09-08T14:03:11.000Z",
  "label": "what this run was (free text, e.g. allowMixedContent=false)"
}
```

Kinds and the tools that write them:

| kind          | written by                                   | what it holds |
|---------------|----------------------------------------------|---------------|
| `android-ws`  | `node tools/probe-android-ws.mjs --out ...`  | one WebSocket attempt from the APK's page (or a laptop dry run): `target` (ip/port/url), `page` (origin, UA, isSecureContext, fork, app, sha), `result` (`open` / `closed` + code + reason / `throw` / `timeout`, ms), `console` (every line the page logged during the attempt) |
| `room-server` | `node tools/room-server.mjs --evidence ...`  | the server's bind, the guest page it served, and every connection: remote address, UA, path, room, role, fingerprint (per-session, random), openedAt, firstFrameMs, frame counts, close code |
| `manual`      | you, by hand (copy the template below)       | a measurement no tool can take: camera scan, battery/thermal, the Defender prompt - fields `steps[]` with `observed` text and numbers |

Rules:

- file names: `<date>-<step>-<kind>-<label>.json`, e.g.
  `2026-09-08-s1-android-ws-mixed-false.json`;
- record what was observed, never what was expected; the expected outcome
  lives in `docs/spike/P0-RUN-SHEET.md` beside each step;
- a fingerprint or seat name in a `room-server` file is a per-session random
  value from a device Chris owns; still, strip anything you would not paste
  in a public issue before sharing a file outside this laptop;
- nothing here feeds the build or any suite. `tools/test-room-server.mjs`
  writes and deletes its own temporary evidence file to prove the format.

## Manual template

```json
{
  "schema": "guidon-probe/1",
  "kind": "manual",
  "at": "2026-09-08T00:00:00.000Z",
  "label": "step 6 battery/thermal 40 min hotspot + screen on",
  "device": "Galaxy Z Fold5",
  "steps": [
    { "t": "0 min",  "battery": 100, "thermal": "cool",  "observed": "..." },
    { "t": "40 min", "battery": 0,   "thermal": "",      "observed": "..." }
  ]
}
```
