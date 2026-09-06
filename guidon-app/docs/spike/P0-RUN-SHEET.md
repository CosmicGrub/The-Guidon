# P0 network spike - run sheet (8-9 September 2026)

## Who drives this

Chris asked (2026-09-05) that for the PC<->Fold5 legs, Claude drives BOTH
devices directly and runs the cross-device study-group (room) flows end to
end, rather than reading Chris the steps to operate by hand. Mechanism:

- **Fold5:** `adb` (platform-tools 37.0.1, already installed - see
  [[guidon-android-toolchain]]) - `adb shell input tap/swipe/text` to drive
  the UI, `adb exec-out screencap` to see it, `adb logcat` for the app's
  console. Needs the device reachable first (USB, or wireless adb after one
  manual pairing) - that connection, and installing the debug APK once, are
  Chris's steps.
- **PC:** this environment's own Bash for the Node room server and builds,
  plus a CDP attach to the Tauri app's WebView2 (proven working in P2 - see
  [[guidon-collective-p2]]) or the Claude_Browser tools for a plain browser
  tab, to drive the desktop UI the same way.

So: steps **1, 3(a/b), and 8** below (the actual PC<->Fold5 study-group
room traffic - joining, seat sync, Rapid-Fire relay, the studyGroups-off
listener-close check) are Claude-driven once both devices are reachable.
Chris's remaining hands-on parts are physical/one-time or need a human
sense no automation has: device pairing and APK install (step 0), the
Termux-side commands on the Fold (step 0), the Samsung-camera QR scan
(step 5, needs an actual camera), and battery/thermal-by-hand (step 6).
Step 7 (the Windows Defender prompt) can go either way - Claude can drive
the Allow click via computer-use if granted, but the Cancel run needs
Chris to remove the firewall rule first regardless.

Seven measurements, in order, with the exact commands. Every result is
recorded as a `guidon-probe/1` JSON file under `docs/evidence/` (format:
`docs/evidence/README.md`); nothing there is committed without Chris
saying so, each time. Record what was OBSERVED. The "expected" lines are
the plan's guesses, written down so a surprise is visible as one.

Devices: the Galaxy Z Fold5 (the phone that owns the network in every
step - hotspot or the room server, or both), the Tab S9 FE (a joiner only:
**it probably cannot own a mobile hotspot** - check Settings > Connections
> Mobile Hotspot and Tethering once, record the answer in step 0, and plan
on the Fold or the laptop owning the network either way), and the Windows
laptop (this repo checked out, `npm run build` done).

Kill switch: Settings > Study groups (LAN rooms) must be ON on any GUIDON
build that joins; the guest page has no switch because it IS the join.

## 0. Before the day

On the laptop, from `guidon-app/`:

```
npm run build                       # emits web/, dist/guidon-standalone.html AND dist/guest.html
node tools/test-room-server.mjs     # the relay + guest page work on this laptop first
node tools/probe-android-ws.mjs --chromium --ip 192.0.2.1    # the probe tool runs end to end (dry run)
```

On the Fold, in Termux (the Termux from F-Droid, not the Play Store one):

```
pkg install nodejs                  # Node 20+ is fine; the server uses built-ins only
mkdir -p ~/guidon/tools ~/guidon/dist ~/guidon/src/app-modules
```

Copy from the laptop (adb push, or Termux `termux-setup-storage` + Files):

- `tools/room-server.mjs`            -> `~/guidon/tools/`
- `src/app-modules/room-schema.js`   -> `~/guidon/src/app-modules/`  (the server imports it - ONE schema module)
- `dist/guest.html`                  -> `~/guidon/dist/`

Then, on the Fold:

```
cd ~/guidon && node tools/room-server.mjs --evidence ~/guidon/fold-room-server.json
```

It prints the join link for every LAN address it has (with the hotspot
on, that is the hotspot gateway, usually 192.168.43.1 or similar). Record
in step 0 (`manual`): Termux version, Node version (`node -v`), the
addresses printed, and whether the Tab S9 FE offers a hotspot at all.

Install the debug APK on the Fold and the Tab (the one from
`npm run android:debug`); note the build sha it shows in Settings >
About (it is stamped by the build and travels in every hello).

## 1. ws:// from the APK's https origin to a NON-loopback IP

What: the APK's page (origin `https://localhost`, a secure context) opens
`ws://<LAN IP>:8787/ws?...`. Mixed-content rules may block a plain ws://
from an https origin; `allowMixedContent` in capacitor.config.json is the
knob. Run it BOTH ways.

Setup: Fold hotspot ON, room server running on the Fold (step 0) OR on
the laptop joined to the Fold's hotspot (`node tools/room-server.mjs
--evidence docs/evidence/2026-09-08-s1-room-server.json` - default bind
0.0.0.0, see step 7 for the Defender prompt). The target IP is the server
device's hotspot/LAN address - never 127.0.0.1.

On the laptop, with the APK open on the Tab (or the Fold) and adb attached:

```
adb shell "cat /proc/net/unix | grep webview_devtools_remote"     # find the WebView's socket name
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
node tools/probe-android-ws.mjs --ip <server IP> --port 8787 --label "allowMixedContent=false" --out docs/evidence/2026-09-08-s1-android-ws-mixed-false.json
```

Then set `"allowMixedContent": true` in `capacitor.config.json` (the
lint `tools/lint-capacitor-config.mjs` will tell you what it thinks of
that - this is a measurement, not a shipping change), rebuild, reinstall,
and run the probe again with `--label "allowMixedContent=true"` and
`...-mixed-true.json`. Revert the config afterwards.

Expected: `false` -> `closed` with code 1006 and a console line naming
mixed content; `true` -> `open`. If `false` already opens, the rooms
design gets simpler; if `true` still fails, the native socket (Kotlin
side) is the only road from the APK and the guest page carries the room
on Android until then.

Record: the two JSON files, plus the exact capacitor.config.json diff in
the `label`.

**Result (2026-09-06, ahead of schedule — real Fold5 hardware via
tools/probe-android-ws.mjs over adb-forwarded CDP):**

- `allowMixedContent=false`: matches Expected — `throw`, `SecurityError`,
  from the app's `https://localhost` origin. Evidence:
  `docs/evidence/2026-09-06-s1-android-ws-mixed-false.json`.
- `allowMixedContent=true`: **diverges from Expected.** The prediction was
  `open`; the measured result is still blocked, but one layer lower —
  `closed`/`net::ERR_CLEARTEXT_NOT_PERMITTED` from Android's OS-level
  cleartext-traffic policy (default since API 28, independent of the
  WebView's own mixed-content setting). Evidence:
  `docs/evidence/2026-09-06-s1-android-ws-mixed-true.json`.

Conclusion: no Android-side config flip (this file's own knob) closes
step 1 alone — a real transport change (a native socket or a wss://
endpoint) is required. This closes step 1 of the Q2 spike gate; steps
2–8 remain open for 09-08/09.

## 2. ws://127.0.0.1 from the same origin

Same probe, target 127.0.0.1 - the tool refuses loopback on purpose
(`loopback answers the wrong question`), so do this one by hand from the
APK page over CDP or in chrome://inspect's console:

```
new WebSocket("ws://127.0.0.1:8787/ws?room=ALPHA-BRAVO-42&role=peer")
```

with the room server running ON THE SAME PHONE (Termux). Record the result
as `manual` (`2026-09-08-s2-manual-loopback.json`).

Expected: opens (loopback is potentially trustworthy) - which is exactly
why it proves nothing about step 1. This step exists to make that
difference a recorded fact.

## 3. Client-to-client reachability, three directions

With the Fold as the hotspot, the room server on the Fold:

- a) Tab (browser, guest page) -> Fold: open `http://<fold IP>:8787/j/ALPHA-BRAVO-42`
  in Samsung Internet AND Chrome on the Tab; type a seat name; Join. The
  Fold's server log (and evidence file) shows the connection with the UA.
- b) Laptop (browser) -> Fold: the same URL in Edge/Chrome on the laptop.
- c) Tab -> Laptop: room server on the laptop (joined to the Fold's
  hotspot), guest page from the Tab. This is the one a hotspot's AP
  isolation ("client isolation") breaks - Samsung hotspots usually do not
  isolate, but measure it.

Also try the mirror of (c): laptop -> Tab is not possible (no server on
the Tab); note that.

Expected: a, b open; c opens unless the hotspot isolates clients.

Record: the Fold's `--evidence` file (copy it out as
`2026-09-08-s3-room-server-fold.json`) and the laptop's
(`...-s3-room-server-laptop.json`); a `manual` file listing which browser
on which device reached which server, and the time to the first frame the
evidence shows (`firstFrameMs`).

## 4. RTCDataChannel Fold <-> Tab with hand-pasted SDP

In the guest page or any page on each device, open the console and run
the standard two-tab RTCDataChannel recipe (offer on the Fold, paste into
the Tab, answer back), with NO STUN server (`iceServers: []`). Record:
does the channel open; time from paste to open; whether the candidates
carry `.local` mDNS names or plain IPs (Chrome hides host IPs behind
`.local` unless the page has camera/mic permission; the guest page never
asks, so expect `.local`).

Expected: opens on Chrome-based browsers on the same hotspot, candidates
are `.local`; Playwright WebKit on the laptop has NO RTCPeerConnection at
all (measured 2026-09-04) - iOS Safari does, but that is a September-15
question, not this spike's.

Record: `manual` (`2026-09-08-s4-manual-rtc.json`) with the SDP
candidate lines pasted in (they carry no secret).

## 5. Samsung camera scans a QR of the join URL and of a guidon:// link

Make two QR codes on the laptop (any offline generator; the app's own QR
encoder is P6): one for `http://<fold IP>:8787/j/ALPHA-BRAVO-42`, one for
`guidon://join/ALPHA-BRAVO-42`. Point the Tab's Samsung Camera at each.

Expected: the http URL offers to open in the default browser (record which
browser, and whether the guest page loads); the guidon:// link does
nothing or shows "no app can open this" until an intent filter exists
(Android side, later) - record the exact wording.

Record: `manual` (`2026-09-08-s5-manual-qr.json`).

## 6. Battery and thermal over 40 minutes, hotspot + screen on

Fold: hotspot on, room server running, guest page open on the Tab and
sending a ping every few seconds (leave a joined room open; the app's
heartbeat is 5 s). Screen stays on (Settings > Display > Screen timeout).
Note battery % and the phone's warmth (hand; Samsung's Device Care
shows a thermal state) at 0, 10, 20, 30, 40 minutes.

Expected: 8-15 % over 40 minutes with the screen on; noticeably warm but
not throttling.

Record: `manual` (`2026-09-08-s6-manual-battery.json`) with the five rows.

## 7. Laptop binding a LAN port: the Defender prompt, Allow and Cancel

On the laptop, joined to the Fold's hotspot:

```
node tools/room-server.mjs --port 8787 --evidence docs/evidence/2026-09-08-s7-room-server-allow.json
```

The first bind on 0.0.0.0 raises the Windows Defender Firewall prompt.
Run it TWICE: once clicking Allow (private networks), once - after
removing the rule in Windows Security > Firewall > Allow an app - clicking
Cancel. Each time, open the join link from the Tab.

Expected: Allow -> the Tab reaches the page; Cancel -> the Tab times out
(the server still runs, the evidence file shows no connection) and the
host screen's 40-60 s ladder tier is the right advice ("host from a phone
instead").

Record: the two evidence files plus a `manual` note of the exact prompt
text and which profile (private/public) the hotspot was classed as.

## Reading the results on 09-09

The decision the spike feeds (Q2, the spike gate, postponed to 2026-09-08/
09): which transport carries the first shipped room. Step 1 decides
whether the APK can be a plain-WebSocket client at all — answered
2026-09-06: it cannot, under either `allowMixedContent` setting; see
Section 1's Result block; step 3(c) decides
whether a laptop can ever host for phones on a phone hotspot; step 4 says
whether RTCDataChannel is a P7 option or a dead end on Android; steps 5-7
shape the host-screen ladder copy (X9) - every tier's sentence should
match what was seen.

## 8. Laptop as host: the Rust room server (added 2026-09-05 after the Rust phase)

The desktop app now hosts rooms itself. Run this after the Node-host steps so the two hosts
can be compared on the same hotspot.

1. Build the from-tree debug app once: `npm run build && npx tauri build --debug --no-bundle`
   (exe: `src-tauri/target/debug/guidon.exe`). Do NOT use the installed 1.5.1 app.
2. Put the laptop on the Fold's hotspot. In the app: Settings -> Study groups ON, then
   `#/group` -> Host. The host screen shows the join URL, the phonetic code and the
   `reachable` verdict from the LAN self-probe.
3. RECORD every non-loopback IPv4 the laptop has (`ipconfig`) next to the address the app
   advertised. On 2026-09-05 the app advertised 10.5.0.2, the default-route source, which on
   this laptop is a VPN-looking adapter, not Wi-Fi (192.168.1.x) - if the advertised address is
   not the hotspot subnet, that is finding #1 of this scenario. The self-probe only proves
   the laptop can reach itself; the phone's result is the real firewall verdict.
4. From the Tab and the Fold: open the join URL in the browser (guest page) and, if the APK
   joiner mechanism from section 1-2 works, in the app. Record: reachable on the phone yes/no,
   the Defender prompt (Allow / Cancel / never shown), and whether "host from a phone instead"
   appeared on the laptop.
5. Play one Rapid-Fire relay round; then leave one phone idle 45 s without answering pings
   and confirm the laptop drops it (close code 4003 in `room_stats`, seat offline then dropped).
6. Settings -> Study groups OFF while the room is open: the listener must close within 5 s
   (`netstat -an | findstr :<port>` shows nothing). Record.
7. Save the evidence: the host screen's Copy JSON (guidon-probe/1) into docs/evidence/ as
   `laptop-tauri-host-<date>.json`; nothing is committed without Chris.
