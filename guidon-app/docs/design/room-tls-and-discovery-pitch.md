# Room networking: the Android blocker, the fix, and the roadmap around it

Written 2026-09-06, following up directly on `docs/spike/P0-RUN-SHEET.md`
Section 1, which this closes out ahead of its 2026-09-08/09 schedule. This
is a design-and-pitch document, not a shipped spec: nothing in the "still
to build" sections below is implemented. What IS real and already
verified this session is called out explicitly, file by file, in Section 1.

**Standing rule, same as everywhere else in this project: nothing here is
committed or pushed without Chris saying so, each time.** The spike
artifacts this doc describes (`tools/room-tls.mjs`,
`src-tauri/spikes/room_tls_spike/`, `RoomTlsPlugin.kt`, the Kotlin Gradle
wiring, the `room-schema.js` additions) sit uncommitted in the working
tree, same as every other phase's work this project has landed this way.

## 0. The confirmed finding this whole document exists to answer

Real hardware (a Galaxy Z Fold5, the freshly-built `app-debug.apk` from
this branch, `tools/probe-android-ws.mjs` over adb-forwarded Chrome
DevTools Protocol) shows that joining a room from the Android app over
plain `ws://` is blocked by **two independent, stacked Android WebView/OS
security layers** — not one, and not something any `capacitor.config.json`
flip alone can fix:

1. **Mixed Content policy.** With this project's shipping default
   (`android.allowMixedContent: false`, enforced by
   `tools/lint-capacitor-config.mjs`), `new WebSocket("ws://...")` throws a
   synchronous `SecurityError` from the app's `https://localhost` origin.
2. **Android's OS-level cleartext-traffic policy.** Measured with
   `allowMixedContent: true` (as a deliberate, reverted-afterward
   experiment — the shipping config is back to `false`): still blocked,
   now with `net::ERR_CLEARTEXT_NOT_PERMITTED`. This policy is independent
   of the WebView's own mixed-content setting and has applied by default
   since API 28.

Neither Tauri (a native process, no WebView network-origin policy
applies) nor the Node reference server / plain web-PWA build (an `http://`
origin, no mixed-content rule) is affected. This is Android-specific, and
it is structural: no config flip closes it. A real transport change is
required.

`docs/spike/P0-RUN-SHEET.md` Section 1 already asked this exact question,
scheduled for 2026-09-08/09. This document answers it early, with real
evidence, and designs the fix.

## 1. The definitive fix: pinned self-signed WSS, terminated natively

**Why not just switch `room-web.js` to `wss://`?** Because a plain
`new WebSocket("wss://...")` against a self-signed certificate cannot
succeed from *any* JS context — not just Android's WebView, but Windows'
WebView2 (Tauri) and a desktop browser tab too. TLS validation happens in
the OS/network stack below JS, and there is no JS-reachable hook to
accept or pin an unknown certificate. `WebViewClient.onReceivedSslError`
is a native-side, per-navigation hook — it doesn't even fire for a
WebSocket's own TLS handshake. This rules out the "just flip the
scheme" version of this fix outright; it needs two symmetric native
halves instead.

**The trust model**: the room protocol already generates a per-room
identity (`fp`, an 8-character base32 fingerprint, and
`identity: "ecdsa-p256"`) that a human reads/compares today as the room's
"proof of place" alongside its NATO phonetic code. This design gives that
same trust-on-first-use model an actual TLS certificate to anchor to: the
host mints an ephemeral, self-signed ECDSA P-256 certificate per room
session, and a joiner pins its connection to that certificate's
SHA-256(SPKI) hash — the *same* value the short human-readable `fp` is
derived from. No certificate authority, no manual cert distribution, no
change to "no server, ever — LAN only, ad hoc."

This is the same pattern as SSH host-key fingerprints or Signal safety
numbers: TOFU, anchored to an out-of-band-verified short code. It is
**strictly stronger** than today's plaintext-with-an-unauthenticated-label
— but it is a deliberate trust-model choice, not a default, and Section 5
names it as one of the open decisions for Chris.

### 1.1 Two corrections found by tracing the actual code (not assumed)

**`fp` cannot be reused as-is.** `studygroup.js`'s `makeIdentity()`
generates the host's `fp` via `crypto.subtle.generateKey(..., false, [...])`
— **non-extractable**, deliberately, per that file's own header ("no
signal that identifies this device... is ever sent"). That key lives in
the WebView's JS sandbox; the TLS listener lives in a different process
(Rust for Tauri, Node for the reference host). A non-extractable private
key cannot cross that boundary — there is no key to hand to the TLS layer.
Grepping the whole reducer further: `fp` is never used to sign anything
today; it's a labeled random-looking string, not a proven identity.

The fix: **generate the identity keypair natively**, in whichever process
terminates TLS, deriving `fp` with the *exact same formula* the JS side
uses (`base32(SHA-256(raw EC point))[0:5]`), and have `host()` ask its
transport for `fp` instead of calling its own `makeIdentity()`. This is a
net improvement — the fp a human reads finally gets a real cryptographic
job (channel binding) it never had before. Peers are untouched; they
still generate their own throwaway JS identity for `hello.from`, which was
never the thing needing a TLS listener.

**Plain browser/PWA builds structurally cannot join a TLS-pinned room,
ever**, from page JS — this is universal, not Android-specific. That's a
permanent, documented limitation to name, not a bug to chase later.

### 1.2 What's already built and verified this session

Not just proposed — three real artifacts sit in the working tree, two of
them run end-to-end with both the positive and negative case actually
exercised:

| File | Status |
|---|---|
| `tools/room-tls.mjs` | **New. Independently re-verified.** Mints a self-signed ECDSA P-256 X.509 certificate using only `node:crypto` — no new npm dependency, matching `room-server.mjs`'s own "Node built-ins ONLY" rule. `node tools/room-tls.mjs --selftest` passes: Node's own `X509Certificate` parser accepts the hand-built DER, the self-signature verifies, and a real `tls.createServer`/`tls.connect` round trip completes with a matching SPKI-hash pin check on the client side. |
| `src/app-modules/room-schema.js` | **Edited, additive, verified.** `wsUrl(hostPort, room, role, secure)` gained an optional 4th arg (`wss://` vs `ws://`, defaulting to today's behavior); added `isSecureOrigin(origin)`. Confirmed: old call sites unchanged, `PROTOCOL_VERSION` untouched, full test suite (151/151) and `cargo test` (73/73) still green after the edit. |
| `src-tauri/spikes/room_tls_spike/` | **New standalone crate. Independently rebuilt and rerun.** `rcgen` mints an ephemeral ECDSA P-256 self-signed cert; `rustls`/`tokio-rustls` serve and dial it with a custom pinning `ServerCertVerifier` — no CA, no hostname check. Case 1 (correct pin) succeeds; case 2 (wrong pin) is rejected with a clear rustls error — the property the whole design rests on, actually exercised, not asserted. |
| `android/app/src/main/java/app/guidon/trainer/RoomTlsPlugin.kt` | **New. Now genuinely compiles** (Gradle Kotlin support was missing entirely for the `:app` module — added `kotlin-android` + matching JVM-target-21 wiring to `android/build.gradle`, `android/variables.gradle`, `android/app/build.gradle`; `:app:compileDebugKotlin` and a full `assembleDebug` both verified green). **Still illustrative — not device-tested, not registered in `MainActivity`, and the RFC 6455 client has real gaps (close handshake, ping/pong, fragmentation) explicitly left as TODO.** |

**The one real bug this session's spike work caught by actually running
it, not by reading docs**: `rcgen::KeyPair::public_key_raw()` and
`x509-parser`'s extraction of the same key from a parsed certificate are
**not guaranteed to produce identical bytes** — the first version of the
Rust spike minted a pin one way and verified it another, and rejected its
own valid certificate. The fix, and the rule to carry into the real
`room.rs` port verbatim: **whatever function computes the fingerprint a
human reads and whatever function checks a peer's certificate against it
must be the same function, on both ends, always.**

### 1.3 File-by-file scope for the rest

No `PROTOCOL_VERSION` bump. TLS-vs-plaintext is a transport choice,
carried entirely by the join link's own URL scheme, decided before any
frame is ever exchanged — it doesn't touch `validate()` or frame shape.
That also means a version bump can't rescue the one case needing graceful
failure: a new Android app given an *old* host's plaintext-only join
link. The clean-failure mechanism has to live at the join-link/transport
layer (`room-web.js` recognizes "this link is `http`, this host has no
TLS listener" and shows a specific "update GUIDON on the host" message)
rather than attempting a doomed connection. Hosts serve **both** ports
during the transition, so no existing join link ever breaks.

Still to build, in build order:

1. **`tools/room-server.mjs`** — a second `tls.createServer` listener
   alongside the existing plaintext one, same `Rooms` map, same relay
   logic (never a second implementation of it), using
   `createSelfSignedIdentity()` from `room-tls.mjs`; expose `fp` via
   `/health`. *Low risk, 0.5–1 day.*
2. **`src-tauri/Cargo.toml`** — pin the exact versions the spike proved
   compatible together: `rcgen 0.14`, `rustls 0.23` (features
   `ring, std, tls12`), `tokio-rustls 0.26` (features `ring, tls12`),
   `rustls-pki-types 1`, `x509-parser 0.18`. **Correction, checked not
   assumed when this actually landed**: `x509-parser` is *not* free via
   `rcgen` — `cargo tree -i -p x509-parser` against the real package
   Cargo.lock shows it parented only under the direct dependency, never
   under `rcgen` (its default features never pull x509-parser in). Naming
   it directly is required, not a no-op; the spike's own build log gave a
   false positive because the spike *also* named it directly.
3. **`src-tauri/src/room.rs`** — generalize `serve_conn(stream: TcpStream, ...)`
   to `serve_conn<S: AsyncRead+AsyncWrite+Unpin+Send+'static>` via
   `tokio::io::split(stream)` (the only reason it's currently
   `TcpStream`-specific); add a second `accept_loop` wrapping accepted
   sockets in `TlsAcceptor::accept()` before handing them to the same
   generic `serve_conn`; `start_room()` mints an identity via a ported
   Rust module and binds a second port, adding `fp` + `secureUrl` to
   `RoomInfo` alongside the unchanged `url`. *2–3 days, including `cargo
   test` regression on the existing 73 Rust tests.*
4. **`src/room-tauri.js`** — surface the native `fp` from `room_start`'s
   response (today it's unused by the host path).
5. **`src/app-modules/studygroup.js`** — `host()` takes `fp` from the
   transport's native identity when offered, skipping its own
   `makeIdentity()` for that one role only. Peers unchanged.
6. **`src/room-web.js`** — `parse()` reads `isSecureOrigin()` from the
   pasted link; a secure target on a build with a native pinning
   capability attaches a transport backed by that plugin instead of a raw
   `WebSocket`; a secure target on a build with no such capability (plain
   browser/PWA) fails immediately with an honest, specific message rather
   than attempting a doomed connection or silently downgrading.
7. **`android/.../MainActivity.java`** — one line,
   `bridge.registerPlugin(RoomTlsPlugin.class)` in `onCreate()` (this
   plugin is app-local, not npm-packaged, so Capacitor's normal
   auto-discovery never sees it).
8. **`RoomTlsPlugin.kt` for real** — the acknowledged highest-risk,
   least-verified piece: real device build, the RFC 6455 client edge
   cases the scaffold left as TODO, real Fold5 verification via a
   `probe-android-ws.mjs`-style CDP inspection. *3–5 days.*
9. **`capacitor.config.json` / `AndroidManifest.xml` / a
   `network_security_config.xml`** — **no change required.**
   `allowMixedContent` and the OS cleartext policy only govern the
   WebView's own networking stack; `RoomTlsPlugin`'s raw `SSLSocket` never
   touches it, so `lint-capacitor-config.mjs`'s promise stays intact,
   untouched.

**Total effort estimate: roughly 8–12 working days**, dominated by stage 8
(native Android networking, the genuinely hard and currently-unverified
part) and the end-to-end hardware verification pass, which needs a real
PC+Fold5 session per this project's existing rhythm.

### 1.4 Residual risks, named explicitly

- **The core security-model question** (Section 5 restates this as an
  open decision): is a self-signed cert pinned to a human-read 8-char
  fingerprint an acceptable trust bar here?
- **The 8-char `fp` is a human-comparison aid, not the machine check.**
  The actual pinning comparison must be the full SHA-256(SPKI) hex, never
  the truncated base32 — every snippet in this doc already does the full
  comparison; flagging it so it isn't cut as a corner during
  implementation.
- **Ephemeral certs and re-hosting the same room code**: each
  `room_start` mints a fresh keypair, so a phone reconnecting after a host
  restart sees a *different* `fp` for the same room code — exactly the
  scenario pinning exists to catch. No design yet decides whether to
  re-show/re-compare the fp on every reconnect, or only on first join.
- **OkHttp vs. hand-rolled RFC 6455 on Android** — hand-rolled matches
  this codebase's dependency-minimalism pattern but is the single
  riskiest, least-verified piece of the whole design. OkHttp trades a real
  dependency for materially lower implementation risk. Worth Chris's call
  before stage 8 starts, not mid-build.
- **Not verified in this environment at all**: any real device behavior
  of `RoomTlsPlugin`, and the interaction between its raw `SSLSocket` and
  Android's Network Security Config defaults for non-HTTP sockets (should
  be a non-issue — cleartext policy governs plaintext, not TLS — but
  "should be" is not "measured").
- **What this does NOT fix**: frames are still never signed (the
  agnosticism audit's "networking caps have no real floor" finding). This
  design authenticates the *transport socket*, not each *frame's sender*
  — an intentional scope boundary, not an oversight, but worth naming so
  it isn't mistaken for the same problem.

## 2. The ad-hoc/offline-first discovery roadmap

**Grounding fact that reframes the whole ask: discovery and connectability
are separate bugs.** `room-web.js`'s own header already says the quiet
part out loud: *"LAN discovery — finding a host from a code alone with no
link — is a separate, larger, not-yet-built project."* This isn't a
hidden gap; it's a pre-declared TODO with an honest failure mode already
shipped. mDNS/BLE discovery only replaces typing an address — a
discovered `ws://host:port` handed to today's Android transport fails
with the *exact same* `SecurityError`/`ERR_CLEARTEXT_NOT_PERMITTED` as a
manually typed one. **Section 1 (WSS) is what unblocks Android joining at
all. This roadmap is what makes doing so effortless once it's unblocked.**
Shipping discovery alone, before Section 1 lands, would put a "rooms
found nearby" list in front of users that still can't connect — a
regression in their own hands, not a win. Land order matters for the
demo; whoever writes release notes must not claim discovery alone "fixes"
Android joining.

Also true today, load-bearing for scope: **only Tauri hosts.** Hosting
lives solely in `src-tauri/src/room.rs`; Android/iOS/PWA/web can only
join. There is no Android-side room server.

### Stage 1 — mDNS: Tauri host advertises, Android joiner browses
*Small-to-medium, single focused session, ships first.*

Tauri is the only host today, and Android is the device already proven
live against it (the PC+Fold5 hardware pairing, project history). Highest
value, smallest scope: the Tauri host advertises
`_guidon-room._tcp.local.` via a pure-Rust mDNS crate (`mdns-sd`) the
moment `room_start` succeeds; the Android app browses for it via
`NsdManager` and shows "Rooms found nearby" above the existing manual-code
field, degrading silently to that field everywhere else.

**Rust side** — new `src-tauri/src/room_discovery.rs`, one lifecycle
handle (`DiscoveryHandle`, acquired at `room_start`, released at
`room_stop` — same shape as the existing `KeepAwake` resource), advertised
via `ServiceInfo` with `fp` and the protocol version in the TXT record.
**Best-effort only**: mDNS/multicast can be blocked on locked-down
networks, and a failure here must never fail `room_start` — surfaced as a
non-fatal `discoveryOk: bool` on `RoomInfo`, parallel to the existing
`reachable`.

**Android side** — no new Capacitor plugin needed; the project already
has a working, lighter-weight precedent for exactly this shape
(`MainActivity.java`'s `NativeSecurityBridge`, whose own comment says "a
full Capacitor plugin registration is more machinery than this needs").
New `NsdDiscoveryBridge.java` (`addJavascriptInterface`, mirroring
`room-tauri.js`'s own native→JS eval-callback idiom), one new permission
(`NEARBY_WIFI_DEVICES`, declared `neverForLocation` — **deliberately not**
any `BLUETOOTH*` permission and **not** `ACCESS_FINE_LOCATION`, both of
which stay in `lint-capacitor-config.mjs`'s `FORBIDDEN` list), the exact
explained lint edit that file's own header comment already calls for, a
new Android-only `src/room-nsd.js` (fork-gated like `room-tauri.js`), and
one UI touch point in `studygroup.js`'s Join panel — a "Rooms found
nearby" list feeding the *existing, already-tested* `joinAt()` verbatim.
No changes to `join()`, `attach()`, `host()`, or the wire protocol.

### Stage 1.5 — QR render on the host screen
*Trivial. Can ship any time after Section 1, independent of everything
else here.*

Already recommended once before (project's own connection-reliability
research: "keep the phonetic code, build the promised QR render"). The
host already computes `joinUrl()`; rendering that as a QR code is a
`<canvas>` and a string — zero new permissions.

**Important asymmetry**: rendering a QR is free; *scanning* one is not —
camera access is in the lint's `FORBIDDEN` list today, and adding it
reopens a real question against this app's whole privacy pitch. **Ship
QR-render now; leave QR-scan explicitly out of scope**, its own
future line item with its own justification.

### Stage 2 — BLE as a discovery-only beacon (never a data path)
*Medium-large. A real native plugin on both Android and iOS, plus a
second permission negotiation. Deferred, not rejected.*

Scoped precisely: the host advertises a tiny BLE beacon (room code only,
~8 bytes) so a joiner with Wi-Fi off can discover "a room is nearby" and
get nudged to connect to the hotspot — but actual room traffic still
rides the Wi-Fi-LAN transport. **This is deliberately not "Bluetooth as
the room's data transport."** BLE's tiny GATT MTU is a poor fit for the
protocol's existing frame sizes, and Bluetooth Classic RFCOMM — which
could carry more — is increasingly access-restricted on Android and **not
exposed to third-party apps on iOS at all**, so it can never be a
cross-platform transport for this app. Needs `BLUETOOTH_ADVERTISE`/`SCAN`
(API 31+, `neverForLocation`) or a pre-12 `ACCESS_FINE_LOCATION`
fallback — both currently forbidden by the lint, both needing the same
deliberate-edit treatment. iOS Core Bluetooth's background-advertising
restrictions need their own spike before committing to a UX promise here.

### Stage 3 — Wi-Fi Direct as the connectivity layer itself
*Large, multi-week, and blocked on a prerequisite genuinely out of scope
here: Android hosting a room at all.*

`WifiP2pManager` gives true ad-hoc Android-to-Android connectivity with no
existing AP needed. But that's strictly better than today's "who is the
hotspot?" manual flow *only if there's an Android host to connect to* —
there isn't. Building Wi-Fi Direct before an Android host exists solves
the wrong half of the problem first. Scope this as blocked on "Android
hosts a room" — its own large, separate future roadmap entry (own
WebSocket server, own manifest posture, own protocol-parity tests) — not
folded into this phase.

### Explicitly out of scope for this phase
Android/iOS hosting; QR scanning; BLE beacon-only and BLE-as-transport;
true Wi-Fi Direct; Tauri-side mDNS browsing (cheap later, no current use
case); iOS discovery (blocked on iOS's own room UX being settled first).

### Coupling points with the WSS design (Section 1)
1. Land order matters for the demo, not correctness, but the release
   notes must say Stage 1 alone does not close the confirmed Android
   blocker.
2. **The mDNS TXT record is a natural carrier for `fp`.**
   `room_discovery::advertise()`'s TXT record already includes `fp` as a
   forward-looking hook — if the WSS design does fingerprint-pinning
   (Section 1 concludes it does), a joiner has `fp` in hand from mDNS
   *before* ever opening a socket, no extra round trip. Coordinate on this
   rather than inventing two pinning-delivery mechanisms.

## 3. Security floor and verification work

Tied directly to the WSS design in Section 1.

**`tools/lint-capacitor-config.mjs`** — no check changes; one header
comment addition. `wss://` is TLS, exactly like `https://` — it is **not**
mixed content, so a WSS-based room transport needs `allowMixedContent` to
*stay* `false`, not flip it. The knob's rationale gets *strictly
stronger*, not just unchanged: the one candidate feature that might have
needed cleartext (LAN room-joining) disappears once rooms move to
`wss://` — there is no remaining legitimate reason this project would ever
need `allowMixedContent: true`. **Cross-report risk, flagged for whoever
schedules Stage 2 (BLE)**: BLE discovery needs `BLUETOOTH_SCAN`/
`CONNECT`/`ADVERTISE` and potentially, on pre-12 devices,
`ACCESS_FINE_LOCATION` as a fallback — the one permission this lint most
deliberately forbids. Stage 1 (NSD/`NEARBY_WIFI_DEVICES`) avoids this
entirely; treat it as a hard constraint if Stage 2 is ever scheduled, not
a permission to request casually.

**The networking-capabilities floor** — from informational to real,
*without* violating `caps.js`'s own "no probe opens a socket" contract.
`webSocket`'s probe (`typeof WebSocket !== "undefined"`) is `true` on
Android today and always will be — the API exists, it's just unusable
from that origin. Flipping `required: true` on the existing flag would be
a rule violation on its face and wouldn't even measure the real problem.
**Design: two lanes, not one flag.**
1. Leave `G.caps.webSocket`/`rtcDataChannel` exactly as they are — cheap,
   synchronous, non-destructive, `required: false`; tighten `degrade` text
   to say explicitly "existence only."
2. Add a second, deliberately-destructive measurement lane, parallel to
   `G.caps`: new `tools/test-network-floor.mjs`, collecting
   `artifacts/net-floor/<fork>-<device>.json` (schema `guidon-netfloor/1`)
   — a *real* hello→welcome round trip per fork (Playwright/loopback for
   web/pwa, WebView2-CDP for Tauri, extended `probe-android-ws.mjs` for
   Android — the one fork with no synthetic substitute). A fork-aware
   expectation table, not a global boolean:
   ```js
   const NET_FLOOR_EXPECT = { web: true, pwa: true, tauri: true, standalone: "n/a",
                               android: "blocked-until-wss", ios: "unknown" };
   ```
   New gate (`tools/lint-network-floor.mjs`) fails if a `true`-fork isn't
   `ok`, **and** fails loudly if `android` is still `"blocked-until-wss"`
   after a "fix shipped" marker says otherwise, so the table can't
   silently drift once Section 1 lands. Same `MAX_AGE_DAYS`-style
   staleness discipline as `caps-matrix.mjs` — gate on staleness/absence,
   never fabricate a CI-only Android measurement.

**The Rust `validate()` differential fuzz test** — blocked today on
`src-tauri` being a binary-only crate. Mechanical fix: add
`src-tauri/src/lib.rs` (`pub mod room; pub mod room_schema_gen;`), a
`[lib]` section in `Cargo.toml`, change `main.rs`'s `mod` lines to
`use guidon::{room, room_schema_gen};` (every call site unchanged, since
the path segment stays `room::` either way). New `[[bin]]`
`src-tauri/src/bin/fuzz_validate.rs` — line-buffered stdin/stdout JSON
verdicts, calling the *real* `guidon::room::validate()` (never a second
copy that can drift, unlike `room_schema_gen.rs`). New
`tools/fuzz-room-validate.mjs` — a pure `(seed, index)` generator
(regenerable single-case repro via `--replay`), two strategies mixed
(pure-random JSON for coarse paths, mutated-valid-frame boundary
mutations for `MAX_*`/regex logic both implementations must agree on
bit-for-bit), spawning the Rust binary once and comparing verdicts with
two severities: mismatched `ok` (fatal — a real protocol-security bug)
vs. matched-reject-mismatched-`reason` (cosmetic, pinned per this
project's existing expected-defect-pin convention). `npm run
fuzz:room-validate`, opt-in, fixed default seed for CI determinism.

**Explicitly NOT covered by the fuzzer above, and needed before calling
any of this "definitively fixed"**: `validate()` operates on decoded
application frames — it has nothing to do with TLS. Section 1's fix needs
its **own** adversarial suite (wrong cert, expired cert, hostname
mismatch, downgrade attempt) against the native Kotlin/Rust trust-manager
code — a different language this JS/Rust differential test structurally
cannot reach.

**Documentation debt**: the "no server, ever" promise (held equal to
`PRIVACY.md` by test, per project history) needs explicit wording once
Section 1 ships — "...including when secured with a self-signed,
device-generated certificate" — so a `wss://` listener is never later
misread as "cloud." The equality test must be re-run against the updated
prose, not just the code, once the transport lands.

**`docs/spike/P0-RUN-SHEET.md` Section 1** — closed out above (this
session, additive `Result:` block, `Expected:` left untouched per the run
sheet's own rule of recording what was observed beside what was
expected). The two real evidence captures
(`docs/evidence/2026-09-06-s1-android-ws-mixed-{false,true}.json`) are
sitting in the session scratchpad, ready to save under
`docs/evidence/`'s naming convention — **per that directory's own stated
rule, not written there without Chris's go-ahead, even though the
measurement itself is already done.**

## 4. Recommended sequencing

Given a solo maintainer shipping incrementally, and that discovery can't
deliver value until connectivity works:

1. **`room-server.mjs` dual-listener + `room-tls.mjs` wiring** (§1.3.1).
   Lowest risk, already-verified crypto; unblocks testing the whole design
   against the Node reference host before touching Rust or Android.
   *0.5–1 day.*
2. **`room.rs` generic `serve_conn` + TLS accept loop + native
   identity/`fp` plumbing** (§1.3.2–3), immediately followed by the
   **`lint-capacitor-config.mjs` header comment** (§3, cheap and correctly
   scoped once the transport shape is real) and the **`src-tauri/src/lib.rs`
   split** (§3's fuzzer prerequisite — purely mechanical, low-risk to
   bundle with related Rust churn already in flight). *2–3 days.*
3. **Rust fuzz binary + `fuzz-room-validate.mjs`** (§3) — run this
   *against* `room.rs` before trusting the TLS port's non-crypto changes
   (the generic `serve_conn` refactor touches code adjacent to
   `validate()`'s call sites), so a refactor regression is caught by an
   independent oracle, not just the existing 73 `cargo test`s. *Half day,
   high leverage for confidence in step 2.*
4. **`RoomTlsPlugin.kt` for real** (§1.3.8) — the highest-risk, least
   verified piece; start only once steps 1–3 give a stable, tested native
   TLS endpoint to build the client against. Get Chris's OkHttp-vs.-
   hand-rolled call (§5) *before* starting, since it changes this stage's
   shape. *3–5 days including real Fold5 verification.*
5. **`room-web.js` capability routing + honest-refusal messaging**
   (§1.3.6) — needs the Kotlin plugin's real interface from step 4, so it
   lands after, not before. *1–2 days.*
6. **End-to-end live-hardware verification** — the actual bug closing,
   PC↔Fold5 over `wss://`. *1 day, needs the tablet/Fold5 session.*
7. **Network-floor lane** (§3) — build this *after* step 6 gives a real
   `android: ok` measurement to encode as the new expectation, rather than
   guessing the shape before the fix exists.
8. **mDNS Stage 1 + QR-render Stage 1.5** (§2) — deliberately last for
   Stage 1 (additive, zero wire/security risk, but shipping it before
   step 6 surfaces a "found nearby, still can't connect" regression in
   the user's own hands). QR-render alone can move earlier — any time
   after step 1 — since it has no dependency on the transport work at
   all.
9. **TLS-adversarial fuzz suite** and **PRIVACY.md wording pass** — close
   these out alongside step 6; both need the shipped transport's real
   shape to write against, not the design.

*P0-RUN-SHEET closeout (the two evidence JSON files) can happen any
time — it only needs Chris's go-ahead, independent of all of the above.*

## 5. Open decisions for Chris

- **Security bar**: is a self-signed cert pinned to an 8-character
  fingerprint, human-compared in the same room, an acceptable trust model
  here? (Claude's view: yes — see §1's TOFU/SSH-host-key/Signal-
  safety-number framing — but naming it as a deliberate choice, not
  inheriting it silently.)
- **Reconnect-to-same-code UX**: each `room_start` mints a fresh keypair,
  so a phone rejoining after a host restart sees a *different* `fp` for
  the same room code. Re-show/re-compare on every reconnect, or only on
  first join?
- **OkHttp vs. hand-rolled RFC 6455 on Android** — dependency-minimalism
  consistency vs. materially lower implementation risk. Decide before
  stage 8 (§1.3) starts, not mid-build.
- **How much ad-hoc/BLE work is worth doing now vs. later** — §2's own
  recommendation is Stage 1 (mDNS) + Stage 1.5 (QR-render) now, Stage 2
  (BLE) and Stage 3 (Wi-Fi Direct) deferred. A staging call, not an
  engineering constraint.
- **The "no server, ever" promise's exact wording** (§3) — a product-facing
  decision, not a pure implementation detail, once a self-signed `wss://`
  listener ships.
- **Whether `ACCESS_FINE_LOCATION` is a permanent hard "never"** in
  `lint-capacitor-config.mjs` — today's answer is yes, and Stage 1
  avoids needing it, but Stage 2 (BLE) or a pre-Android-12 compatibility
  floor would eventually force the question. Worth settling as a standing
  policy rather than re-litigating per-PR.

---

## Claude's own opinions (pursue / consider / reject)

**Pursue**
- The pinned self-signed WSS design in §1, in the build order given — it's
  the only design that actually closes the confirmed blocker, its
  hardest crypto/TLS pieces are already spiked and verified on both Node
  and Rust, and it strengthens (never weakens) the existing security
  floor.
- Stage 1 (mDNS) + Stage 1.5 (QR-render) from §2, in that priority — small,
  additive, zero wire-protocol risk, and QR-render in particular has been
  recommended before and costs almost nothing.
- The two-lane networking-capabilities-floor design in §3 — it's the
  correct fix for a real, previously-flagged gap ("the socket exists" was
  never the same fact as "the socket is usable from this fork"), and it
  respects `caps.js`'s own non-destructive contract instead of quietly
  breaking it.
- Building the Rust differential fuzzer (§3) *before* trusting the
  `serve_conn` generalization in step 2 of §4's sequencing — cheap
  insurance against a refactor regression that the existing 73 `cargo
  test`s might not catch.

**Consider, not yet**
- BLE beacon-only discovery (Stage 2, §2) — real value (works with Wi-Fi
  off), but the permission cost and iOS background-advertising unknowns
  deserve their own spike before scheduling.
- OkHttp for the Android WebSocket client — real schedule/risk win, at the
  cost of this project's stated dependency-minimalism preference. Chris's
  call, not a default.

**Reject, explicitly**
- **Bluetooth as the room's actual data transport**, in any form. iOS
  never exposes Bluetooth Classic to third-party apps, so it can never be
  the cross-platform answer this app needs, and BLE's MTU is a poor fit
  for a protocol already sized for 8+ seats. Beacon-only, handing off to
  the existing transport, is the entire Bluetooth story worth pursuing.
- **QR scanning bundled into the discovery phase.** Not a bad idea on its
  own, but it quietly reopens the `CAMERA` permission question against
  this app's whole privacy pitch and deserves its own standalone
  justification, not a ride-along.
- **Wi-Fi Direct before an Android host exists.** Solves the wrong half
  of the problem first.
- **Describing mDNS discovery as a fix for the confirmed Android joining
  blocker**, anywhere — release notes included. It isn't one; see §2.
- **A plain in-WebView `wss://` client** as an alternative to the native
  plugin. It cannot work, structurally, in any browser or WebView — this
  isn't a matter of trying harder on the JS side.
