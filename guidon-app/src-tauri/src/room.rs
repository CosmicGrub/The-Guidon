//! R-ROOM (collective P4): the GUIDON desktop shell's LAN study-room host.
//!
//! Locked design (desktop roadmap Q1-Q13, the pairings review, 2026-09-04):
//! native host + LAN WebSocket + host-served guest page (Q3), Tauri hosts
//! first (Q4), the host admits each joiner by hand (no admit-all, ruled).
//! The HOST role is THIS listener; the page (src/app-modules/studygroup.js
//! behind src/room-tauri.js) is the room's brain and never opens a socket.
//!
//! What runs here, on tauri's own tokio runtime, only after the page asked:
//!
//! * `room_start(port, code)` binds `0.0.0.0:<port or ephemeral>` (never
//!   loopback-only: a loopback probe answers the wrong question for a LAN
//!   room), serves `GET /` and `/j/<code>` with `../../dist/guest.html`
//!   embedded at compile time (build.rs fails when it is missing), `GET
//!   /health` as JSON, and upgrades `/ws?room=<code>&role=peer` to a
//!   WebSocket. It then probes its own advertised `ip:port` from a second
//!   socket (X10) and reports `reachable`; the page turns `false` into
//!   "host from a phone instead" (a per-user NSIS install cannot open the
//!   Windows firewall). While a room is open the process holds
//!   `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED |
//!   ES_DISPLAY_REQUIRED)` on a dedicated thread (X13) and clears it on stop.
//! * The WebSocket layer is a minimal RFC 6455 server written to mirror
//!   tools/room-server.mjs (the Node reference host) frame for frame:
//!   handshake, masked client frames only (unmasked -> 1002), text incl.
//!   fragmentation, ping/pong, close echo, 16/64-bit lengths, 1 MB payload
//!   cap (1009), binary refused (1003), server-side liveness (a socket
//!   silent for PING_MS gets a ping; MISS_LIMIT unanswered -> 4003 "no-pong").
//!   No tokio-tungstenite: SHA-1 and base64 for the handshake are the two
//!   small functions below, tested against the RFC vectors.
//! * Relay rules are the Node server's, with the page as the one host:
//!   every inbound message is the relay envelope `{to, f}`; the frame must
//!   pass `validate()` against the GENERATED schema constants
//!   (room_schema_gen.rs, emitted from src/app-modules/room-schema.js -
//!   never a typed copy) except a v-mismatch hello, which reaches the page
//!   so the page alone answers with the locked reject sentence; a socket
//!   is bound to the `from` of its first frame, a later `from` is a spoof;
//!   a new socket claiming a bound fingerprint replaces the old one (4001);
//!   a `role=host` socket is refused (4002 - the page IS the host); a peer
//!   whose URL names another room gets nothing (dropped no-host); the 9th
//!   bound peer is refused (4004 "room full", SEAT_CAP = the hotspot cap);
//!   the ORIGINAL text of an accepted peer frame reaches the page byte for
//!   byte; a page frame goes to the named fingerprint or, with "*", to
//!   every bound peer. Everything dropped is counted by reason.
//! * Delivery to the page is `WebviewWindow::eval` into
//!   `window.__GUIDON_ROOM_RX__({type:"room:frame"|"room:peer", ...})`, not
//!   a Tauri event: listening to one is the plugin command
//!   `plugin:event|listen`, and tauri 2.11.5 consults the ACL for every
//!   plugin command (src/webview/mod.rs, `plugin_command.is_some() ||
//!   has_app_acl_manifest || !is_local`) - with no capability file (rule 8)
//!   that is a reject. `room:peer` open/close carries the peer address so
//!   the page records every accepted socket in `G.netLedger`.
//! * Every command refuses unless the page passes `fork: "tauri"` and the
//!   invoking webview is the `main` window; `room_start`, `room_send` and
//!   `room_stats` also need `studyGroups: true` (the live Settings value -
//!   the page is the source of truth). `room_stop` deliberately does NOT:
//!   the page's settings:change handler calls leave() the moment Study
//!   groups goes OFF, so its stop request arrives carrying the new value
//!   `false` - gating it on the setting left the listener bound and
//!   keep-awake held for the life of the process (measured on the verify
//!   pass, 2026-09-05: /health still answered after the setting went off).
//!   Stopping only ever reduces exposure, so the setting cannot gate it.
//!
//! `GUIDON_ROOM_TEST=1` (tools/test-room-tauri.mjs sets it) only adds
//! `GUIDON room: ...` lines on stderr and honours `GUIDON_ROOM_PING_MS`
//! and `GUIDON_ROOM_LAN_IP` (the address advertised AND dialled by the X10
//! probe, so a suite can make the probe fail on purpose - 192.0.2.1 never
//! answers - and prove the "host from a phone instead" path on the host
//! screen); it unlocks nothing.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use crate::room_schema_gen as schema;

/// The guest page, byte for byte (P3's build artifact; build.rs guards it).
pub const GUEST_HTML: &[u8] = include_bytes!("../../dist/guest.html");
pub const TEST_ENV: &str = "GUIDON_ROOM_TEST";
pub const PING_MS_ENV: &str = "GUIDON_ROOM_PING_MS";
pub const LAN_IP_ENV: &str = "GUIDON_ROOM_LAN_IP";
pub const DEFAULT_PING_MS: u64 = 15_000;
pub const MISS_LIMIT: u32 = 3;
/// A wire message is < 4.2 KB; anything near 1 MB is hostile (Node: MAX_PAYLOAD).
pub const MAX_PAYLOAD: usize = 1 << 20;
pub const MAX_HEAD: usize = 16 * 1024;
pub const HEAD_TIMEOUT: Duration = Duration::from_secs(10);
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
/// Node's 1 s destroy timer after a server-initiated close.
pub const CLOSE_GRACE_MS: u64 = 1000;
pub const STOP_GRACE_MS: u64 = 300;
pub const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
pub const WINDOW_LABEL: &str = "main";
pub const RX_FN: &str = "__GUIDON_ROOM_RX__";

fn is_test() -> bool {
    std::env::var_os(TEST_ENV).map(|v| !v.is_empty()).unwrap_or(false)
}
fn say(msg: impl AsRef<str>) {
    if is_test() {
        eprintln!("GUIDON room: {}", msg.as_ref());
    }
}
fn ping_ms() -> u64 {
    if is_test() {
        if let Some(v) = std::env::var(PING_MS_ENV).ok().and_then(|s| s.parse::<u64>().ok()) {
            return v.max(50);
        }
    }
    DEFAULT_PING_MS
}

/* ------------------------------------------------------------------ gate */

/// Defense in depth, all three at once: the page's live Settings value, the
/// page's fork name and the window the invoke came from.
pub fn guard(study_groups: bool, fork: &str, label: &str) -> Result<(), String> {
    if !study_groups {
        return Err("Study groups are off in Settings - the room host refuses.".into());
    }
    if fork != "tauri" {
        return Err(format!("the room host serves the tauri fork only (page reports fork {fork:?})"));
    }
    if label != WINDOW_LABEL {
        return Err(format!("the room host answers the {WINDOW_LABEL:?} window only (invoked from {label:?})"));
    }
    Ok(())
}

/// The stop gate: fork and window only. The page turns Settings -> Study
/// groups OFF first and asks to stop second (studygroup.js settings:change
/// -> leave() -> transportHostStop()), so the setting it carries is already
/// `false`; refusing then kept the port bound and keep-awake held (measured).
pub fn guard_stop(fork: &str, label: &str) -> Result<(), String> {
    guard(true, fork, label)
}

/* --------------------------------------------------------------- hashing */

/// SHA-1 (RFC 3174), for the RFC 6455 Sec-WebSocket-Accept only.
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in w.iter_mut().enumerate().take(16) {
            *word = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

/// Standard base64 with padding (RFC 4648), encode only.
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

pub fn accept_key(key: &str) -> String {
    let mut v = key.as_bytes().to_vec();
    v.extend_from_slice(WS_GUID.as_bytes());
    base64(&sha1(&v))
}

/* ---------------------------------------------------------- schema checks */

pub fn is_fingerprint(s: &str) -> bool {
    s.len() == 8 && s.bytes().all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b))
}

pub fn is_room_code(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return false;
    }
    let word = |w: &str| !w.is_empty() && w.bytes().all(|b| b.is_ascii_uppercase()) && schema::NATO.contains(&w);
    word(parts[0]) && word(parts[1]) && parts[2].len() == 2 && parts[2].bytes().all(|b| b.is_ascii_digit())
}

fn is_obj(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}
/// JS isInt: a finite number with no fraction inside [min, max].
fn is_int(v: &Value, min: f64, max: f64) -> bool {
    match v.as_f64() {
        Some(f) => f.is_finite() && f.floor() == f && f >= min && f <= max,
        None => false,
    }
}
/// JS isStr: a string whose .length (UTF-16 units) is at most max.
fn is_str(v: &Value, max: usize) -> bool {
    v.as_str().map(|s| s.encode_utf16().count() <= max).unwrap_or(false)
}
fn str_len(v: &Value) -> usize {
    v.as_str().map(|s| s.encode_utf16().count()).unwrap_or(0)
}
fn only_keys(obj: &Map<String, Value>, allowed: &[&str]) -> Option<String> {
    obj.keys().find(|k| !allowed.contains(&k.as_str())).cloned()
}
fn keys_of(table: &'static [(&'static str, &'static [&'static str])], t: &str) -> Option<&'static [&'static str]> {
    table.iter().find(|(name, _)| *name == t).map(|(_, keys)| *keys)
}
/// True when a key named `key` exists anywhere in the value tree (rule 8: no grade, ever).
pub fn has_key_deep(v: &Value, key: &str, depth: u32) -> bool {
    if depth > 12 {
        return false;
    }
    match v {
        Value::Array(a) => a.iter().any(|x| has_key_deep(x, key, depth + 1)),
        Value::Object(m) => m.iter().any(|(k, x)| k == key || has_key_deep(x, key, depth + 1)),
        _ => false,
    }
}

fn validate_seat(s: &Value) -> Option<String> {
    let m = match is_obj(s) {
        Some(m) => m,
        None => return Some("seat".into()),
    };
    if let Some(k) = only_keys(m, schema::SEAT_KEYS) {
        return Some(format!("seat-key:{k}"));
    }
    if !m.get("seatNo").map(|v| is_int(v, 1.0, 9999.0)).unwrap_or(false) {
        return Some("seat-no".into());
    }
    if !m.get("name").map(|v| is_str(v, schema::MAX_NAME)).unwrap_or(false) {
        return Some("seat-name".into());
    }
    if !m.get("fp").and_then(Value::as_str).map(is_fingerprint).unwrap_or(false) {
        return Some("seat-fp".into());
    }
    if !m.get("score").map(|v| is_int(v, 0.0, 1e9)).unwrap_or(false) {
        return Some("seat-score".into());
    }
    if !m.get("online").map(Value::is_boolean).unwrap_or(false) {
        return Some("seat-online".into());
    }
    if m.contains_key("ready") && !m["ready"].is_boolean() {
        return Some("seat-ready".into());
    }
    if m.contains_key("done") && !m["done"].is_boolean() {
        return Some("seat-done".into());
    }
    None
}

fn present(m: &Map<String, Value>, k: &str) -> bool {
    m.get(k).map(|v| !v.is_null()).unwrap_or(false)
}

pub fn validate_snapshot(s: &Value) -> Option<String> {
    let m = match is_obj(s) {
        Some(m) => m,
        None => return Some("snapshot".into()),
    };
    if let Some(k) = only_keys(m, schema::SNAPSHOT_KEYS) {
        return Some(format!("snapshot-key:{k}"));
    }
    if !m.get("phase").and_then(Value::as_str).map(|p| schema::PHASES.contains(&p)).unwrap_or(false) {
        return Some("snapshot-phase".into());
    }
    if !m.get("mode").and_then(Value::as_str).map(|p| schema::MODES.contains(&p)).unwrap_or(false) {
        return Some("snapshot-mode".into());
    }
    if !m.get("seq").map(|v| is_int(v, 0.0, 1e12)).unwrap_or(false) {
        return Some("snapshot-seq".into());
    }
    if !m.get("room").and_then(Value::as_str).map(is_room_code).unwrap_or(false) {
        return Some("snapshot-room".into());
    }
    if !m.get("hostSeat").map(|v| is_int(v, 1.0, 9999.0)).unwrap_or(false) {
        return Some("snapshot-host".into());
    }
    if present(m, "cardId") && !is_str(&m["cardId"], schema::MAX_ID) {
        return Some("snapshot-card".into());
    }
    if present(m, "cardText") {
        let tx = match is_obj(&m["cardText"]) {
            Some(t) => t,
            None => return Some("snapshot-text".into()),
        };
        // Agnosticism audit, 6 Sep 2026 (F8): "kind" is optional (absent
        // means "text", the only kind that has ever existed) - a future
        // richer card kind gets added to schema::CARD_TEXT_KINDS one at a
        // time, alongside the receiver logic that understands it, never
        // accepted on faith.
        if let Some(k) = only_keys(tx, &["q", "a", "category", "kind"]) {
            return Some(format!("snapshot-text-key:{k}"));
        }
        if tx.get("kind").is_some_and(|v| !v.as_str().is_some_and(|k| schema::CARD_TEXT_KINDS.contains(&k))) {
            return Some("snapshot-text-kind".into());
        }
        if !tx.get("q").map(|v| is_str(v, schema::MAX_TEXT)).unwrap_or(false) || !tx.get("a").map(|v| is_str(v, schema::MAX_TEXT)).unwrap_or(false) {
            return Some("snapshot-text-size".into());
        }
        if tx.contains_key("category") && !is_str(&tx["category"], 80) {
            return Some("snapshot-text-cat".into());
        }
    }
    if present(m, "turnSeat") && !is_int(&m["turnSeat"], 1.0, 9999.0) {
        return Some("snapshot-turn".into());
    }
    if present(m, "lock") {
        let lk = match is_obj(&m["lock"]) {
            Some(l) => l,
            None => return Some("snapshot-lock".into()),
        };
        if let Some(k) = only_keys(lk, &["kind", "scored", "advance"]) {
            return Some(format!("snapshot-lock-key:{k}"));
        }
        if !lk.get("kind").map(|v| is_str(v, 20)).unwrap_or(false) {
            return Some("snapshot-lock-kind".into());
        }
        if let Some(sc) = lk.get("scored") {
            match sc.as_array() {
                Some(a) if a.len() <= schema::MAX_SEATS && a.iter().all(|x| is_int(x, 1.0, 9999.0)) => {}
                _ => return Some("snapshot-lock-scored".into()),
            }
        }
        if lk.contains_key("advance") && !lk["advance"].is_boolean() {
            return Some("snapshot-lock-advance".into());
        }
    }
    if present(m, "deadline") && !is_int(&m["deadline"], 0.0, 1e14) {
        return Some("snapshot-deadline".into());
    }
    if present(m, "round") {
        let r = match is_obj(&m["round"]) {
            Some(r) => r,
            None => return Some("snapshot-round".into()),
        };
        if let Some(k) = only_keys(r, &["idx", "total"]) {
            return Some(format!("snapshot-round-key:{k}"));
        }
        if !r.get("idx").map(|v| is_int(v, 0.0, 9999.0)).unwrap_or(false) || !r.get("total").map(|v| is_int(v, 0.0, 9999.0)).unwrap_or(false) {
            return Some("snapshot-round-n".into());
        }
    }
    if present(m, "deck") {
        let d = match is_obj(&m["deck"]) {
            Some(d) => d,
            None => return Some("snapshot-deck".into()),
        };
        if let Some(k) = only_keys(d, &["category", "timerSec"]) {
            return Some(format!("snapshot-deck-key:{k}"));
        }
        if present(d, "category") && !is_str(&d["category"], 80) {
            return Some("snapshot-deck-cat".into());
        }
        if present(d, "timerSec") && !is_int(&d["timerSec"], 1.0, 3600.0) {
            return Some("snapshot-deck-timer".into());
        }
    }
    match m.get("seats").and_then(Value::as_array) {
        Some(a) if a.len() <= schema::MAX_SEATS => {
            for s in a {
                if let Some(e) = validate_seat(s) {
                    return Some(e);
                }
            }
        }
        _ => return Some("snapshot-seats".into()),
    }
    if m.contains_key("bankSig") && !is_str(&m["bankSig"], 48) {
        return Some("snapshot-sig".into());
    }
    None
}

fn validate_body(t: &str, b: &Value) -> Option<String> {
    let m = match is_obj(b) {
        Some(m) => m,
        None => return Some("body".into()),
    };
    let allowed = keys_of(schema::BODY_KEYS, t)?;
    if let Some(k) = only_keys(m, allowed) {
        return Some(format!("body-key:{k}"));
    }
    if let Some(req) = keys_of(schema::REQUIRED_BODY_KEYS, t) {
        for r in req {
            if !m.contains_key(*r) {
                return Some(format!("body-missing:{r}"));
            }
        }
    }
    match t {
        "hello" => {
            if !m.get("name").map(|v| is_str(v, schema::MAX_NAME)).unwrap_or(false) || str_len(&m["name"]) == 0 {
                return Some("name".into());
            }
            if !m.get("bankSig").map(|v| is_str(v, 48)).unwrap_or(false) {
                return Some("bankSig".into());
            }
            if m.contains_key("resume") && !is_str(&m["resume"], schema::MAX_TOKEN) {
                return Some("resume".into());
            }
            if m.contains_key("rank") && !is_str(&m["rank"], 8) {
                return Some("rank".into());
            }
            if m.contains_key("build") && !is_str(&m["build"], schema::MAX_BUILD) {
                return Some("build".into());
            }
            if m.contains_key("app") && !is_str(&m["app"], schema::MAX_APP) {
                return Some("app".into());
            }
            None
        }
        "admit" => {
            if !m.get("pending").map(Value::is_boolean).unwrap_or(false) {
                return Some("pending".into());
            }
            if m.contains_key("atBoundary") && !m["atBoundary"].is_boolean() {
                return Some("atBoundary".into());
            }
            None
        }
        "welcome" => {
            if !m.get("seatNo").map(|v| is_int(v, 1.0, 9999.0)).unwrap_or(false) {
                return Some("seatNo".into());
            }
            if !m.get("token").map(|v| is_str(v, schema::MAX_TOKEN)).unwrap_or(false) || str_len(&m["token"]) == 0 {
                return Some("token".into());
            }
            if m.contains_key("hold") && !is_int(&m["hold"], 1.0, 3600.0) {
                return Some("hold".into());
            }
            validate_snapshot(&m["snapshot"])
        }
        "snapshot" => validate_snapshot(&m["snapshot"]),
        "intent" => {
            let kind = m.get("kind").and_then(Value::as_str).unwrap_or("");
            if !schema::INTENT_KINDS.contains(&kind) {
                return Some("kind".into());
            }
            if m.contains_key("value") && !is_int(&m["value"], 0.0, schema::MAX_SCORE as f64) {
                return Some("value".into());
            }
            if kind == "score" && !m.contains_key("value") {
                return Some("body-missing:value".into());
            }
            if m.contains_key("cardId") && !is_str(&m["cardId"], schema::MAX_ID) {
                return Some("cardId".into());
            }
            None
        }
        "reject" => {
            if m.get("reason").map(|v| is_str(v, schema::MAX_REASON)).unwrap_or(false) {
                None
            } else {
                Some("reason".into())
            }
        }
        "kick" => {
            if !m.get("seatNo").map(|v| is_int(v, 1.0, 9999.0)).unwrap_or(false) {
                return Some("seatNo".into());
            }
            if m.contains_key("reason") && !is_str(&m["reason"], schema::MAX_REASON) {
                return Some("reason".into());
            }
            None
        }
        "ping" | "pong" => {
            if m.get("n").map(|v| is_int(v, 0.0, 1e12)).unwrap_or(false) {
                None
            } else {
                Some("n".into())
            }
        }
        "bye" => None,
        "end" => {
            if m.contains_key("reason") && !is_str(&m["reason"], schema::MAX_REASON) {
                return Some("reason".into());
            }
            None
        }
        _ => Some("type".into()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    pub ok: bool,
    pub reason: String,
}
fn no(reason: impl Into<String>) -> Verdict {
    Verdict { ok: false, reason: reason.into() }
}

/// The JS validate(frame), rule for rule, over the generated constants.
/// reason "version" is the one the page answers with a reject frame.
pub fn validate(frame: &Value) -> Verdict {
    let m = match is_obj(frame) {
        Some(m) => m,
        None => return no("frame"),
    };
    for k in schema::ENVELOPE_KEYS {
        if !m.contains_key(*k) {
            return no(format!("missing:{k}"));
        }
    }
    if let Some(k) = only_keys(m, schema::ENVELOPE_KEYS) {
        return no(format!("extra:{k}"));
    }
    if m["v"].as_f64() != Some(schema::PROTOCOL_VERSION as f64) {
        return no("version");
    }
    let t = match m["t"].as_str() {
        Some(t) if schema::TYPES.contains(&t) => t,
        _ => return no("type"),
    };
    if !m["room"].as_str().map(is_room_code).unwrap_or(false) {
        return no("room");
    }
    if !is_int(&m["seq"], 0.0, 1e12) {
        return no("seq");
    }
    if !m["from"].as_str().map(is_fingerprint).unwrap_or(false) {
        return no("from");
    }
    if has_key_deep(frame, "grade", 0) {
        return no("grade");
    }
    if let Some(b) = validate_body(t, &m["body"]) {
        return no(b);
    }
    match serde_json::to_string(frame) {
        Ok(s) if s.len() < schema::MAX_FRAME_BYTES => Verdict { ok: true, reason: String::new() },
        Ok(_) => no("size"),
        Err(_) => no("json"),
    }
}

/// The relay envelope a SOCKET carries: `{"to": <fp | "*" | null>, "f": <frame>}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Wire {
    pub to: Option<String>,
    pub frame: Value,
}
pub fn wire_decode(text: &str) -> Option<Wire> {
    if text.len() > schema::MAX_WIRE_BYTES {
        return None;
    }
    let v: Value = serde_json::from_str(text).ok()?;
    let m = v.as_object()?;
    if !m.contains_key("f") || only_keys(m, &["to", "f"]).is_some() {
        return None;
    }
    let to = match m.get("to") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "*" || is_fingerprint(s) => Some(s.clone()),
        _ => return None,
    };
    Some(Wire { to, frame: m["f"].clone() })
}
pub fn wire_encode(frame: &Value, to: Option<&str>) -> String {
    json!({ "to": to, "f": frame }).to_string()
}

/* ------------------------------------------------------------- RFC 6455 */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawFrame {
    pub op: u8,
    pub fin: bool,
    pub rsv: u8,
    pub payload: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proto {
    pub code: u16,
    pub reason: &'static str,
}

/// Consumes every complete client frame from `buf` (the Node parse()).
/// A protocol error is returned as the close the server must send.
pub fn parse_frames(buf: &mut Vec<u8>) -> Result<Vec<RawFrame>, Proto> {
    let mut out = Vec::new();
    loop {
        if buf.len() < 2 {
            break;
        }
        let b0 = buf[0];
        let b1 = buf[1];
        let fin = b0 & 0x80 != 0;
        let rsv = b0 & 0x70;
        let op = b0 & 0x0f;
        let masked = b1 & 0x80 != 0;
        let mut len = (b1 & 0x7f) as usize;
        let mut off = 2usize;
        if len == 126 {
            if buf.len() < 4 {
                break;
            }
            len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
            off = 4;
        } else if len == 127 {
            if buf.len() < 10 {
                break;
            }
            let big = u64::from_be_bytes([buf[2], buf[3], buf[4], buf[5], buf[6], buf[7], buf[8], buf[9]]);
            if big > MAX_PAYLOAD as u64 {
                buf.clear();
                return Err(Proto { code: 1009, reason: "too big" });
            }
            len = big as usize;
            off = 10;
        }
        if !masked {
            buf.clear();
            return Err(Proto { code: 1002, reason: "unmasked" });
        }
        if len > MAX_PAYLOAD {
            buf.clear();
            return Err(Proto { code: 1009, reason: "too big" });
        }
        if buf.len() < off + 4 + len {
            break;
        }
        let mask = [buf[off], buf[off + 1], buf[off + 2], buf[off + 3]];
        let mut payload = buf[off + 4..off + 4 + len].to_vec();
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= mask[i & 3];
        }
        buf.drain(..off + 4 + len);
        out.push(RawFrame { op, fin, rsv, payload });
    }
    Ok(out)
}

pub fn encode_frame(op: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 10);
    out.push(0x80 | op);
    if payload.len() < 126 {
        out.push(payload.len() as u8);
    } else if payload.len() < 65536 {
        out.push(126);
        out.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    } else {
        out.push(127);
        out.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    }
    out.extend_from_slice(payload);
    out
}
pub fn close_payload(code: u16, reason: &str) -> Vec<u8> {
    let mut b = code.to_be_bytes().to_vec();
    let r = reason.as_bytes();
    b.extend_from_slice(&r[..r.len().min(120)]);
    b
}

/* ---------------------------------------------------------------- relay */

/// What the writer task puts on a socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Out {
    Text(String),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    /// Send a close frame; end the TCP after `grace_ms` (0: at once).
    Close { code: u16, reason: String, grace_ms: u64 },
    /// The peer answered our close: end the TCP now.
    End,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub connections: u64,
    pub frames_in: u64,
    pub frames_out: u64,
    pub dropped: u64,
    pub dropped_by: HashMap<String, u64>,
    pub closed: u64,
    pub heartbeat_closed: u64,
}

pub struct Conn {
    pub id: u64,
    pub remote: String,
    pub url_room: String,
    pub role_host: bool,
    pub fp: Option<String>,
    pub close_sent: bool,
    pub close_code: Option<u16>,
    pub frag: Option<Vec<u8>>,
    pub last_in: Instant,
    pub missed: u32,
    pub frames_in: u64,
    pub frames_out: u64,
    pub dropped: u64,
    tx: mpsc::UnboundedSender<Out>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inbound {
    Dropped(&'static str),
    /// The ORIGINAL text of a validated peer frame, for the page.
    ToHost { text: String, from: String, remote: String },
}

/// The relay table: every socket, the fingerprint it is bound to, the
/// counters. Pure over channels - the tests drive it with in-memory pairs.
pub struct Relay {
    pub code: String,
    pub cap: usize,
    pub conns: HashMap<u64, Conn>,
    pub stats: Stats,
    next_id: u64,
}

impl Relay {
    pub fn new(code: &str, cap: usize) -> Self {
        Relay { code: code.to_string(), cap, conns: HashMap::new(), stats: Stats::default(), next_id: 1 }
    }
    /// Registers a handshaken socket. A role=host socket is refused at once
    /// (4002): the page is the room's only host.
    pub fn add(&mut self, remote: &str, url_room: &str, role_host: bool, tx: mpsc::UnboundedSender<Out>) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.stats.connections += 1;
        self.conns.insert(
            id,
            Conn { id, remote: remote.to_string(), url_room: url_room.to_string(), role_host, fp: None, close_sent: false, close_code: None, frag: None, last_in: Instant::now(), missed: 0, frames_in: 0, frames_out: 0, dropped: 0, tx },
        );
        if role_host {
            self.close(id, 4002, "room already has a host", CLOSE_GRACE_MS);
        }
        id
    }
    pub fn send(&mut self, id: u64, out: Out) -> bool {
        match self.conns.get_mut(&id) {
            Some(c) => {
                let text = matches!(out, Out::Text(_));
                let ok = c.tx.send(out).is_ok();
                if ok && text {
                    c.frames_out += 1;
                    self.stats.frames_out += 1;
                }
                ok
            }
            None => false,
        }
    }
    /// The Node closeConn(): the first close code wins; the frame goes out once.
    pub fn close(&mut self, id: u64, code: u16, reason: &str, grace_ms: u64) {
        let already = match self.conns.get_mut(&id) {
            Some(c) => {
                if c.close_sent {
                    true
                } else {
                    c.close_sent = true;
                    c.close_code.get_or_insert(code);
                    false
                }
            }
            None => return,
        };
        if !already {
            self.send(id, Out::Close { code, reason: reason.to_string(), grace_ms });
        }
    }
    pub fn remove(&mut self, id: u64) -> Option<Conn> {
        let c = self.conns.remove(&id)?;
        self.stats.closed += 1;
        Some(c)
    }
    pub fn touch(&mut self, id: u64) {
        if let Some(c) = self.conns.get_mut(&id) {
            c.last_in = Instant::now();
            c.missed = 0;
        }
    }
    fn drop_frame(&mut self, id: u64, reason: &'static str) -> Inbound {
        self.stats.dropped += 1;
        *self.stats.dropped_by.entry(reason.to_string()).or_insert(0) += 1;
        if let Some(c) = self.conns.get_mut(&id) {
            c.dropped += 1;
        }
        Inbound::Dropped(reason)
    }
    /// Bound peer sockets in the live room (the seat cap counts these).
    pub fn bound_peers(&self) -> usize {
        self.conns.values().filter(|c| c.fp.is_some() && !c.role_host && c.url_room == self.code && !c.close_sent).count()
    }
    fn find_bound(&self, url_room: &str, fp: &str, not: u64) -> Option<u64> {
        self.conns.values().find(|c| c.id != not && !c.role_host && c.url_room == url_room && c.fp.as_deref() == Some(fp) && !c.close_sent).map(|c| c.id)
    }
    /// One raw client frame (the Node onFrame()): control frames are handled
    /// here; a complete text message comes back for on_text().
    pub fn on_raw(&mut self, id: u64, f: RawFrame) -> Option<String> {
        if f.rsv != 0 {
            self.close(id, 1002, "rsv", CLOSE_GRACE_MS);
            return None;
        }
        if f.op >= 0x8 {
            if !f.fin || f.payload.len() > 125 {
                self.close(id, 1002, "control", CLOSE_GRACE_MS);
                return None;
            }
            match f.op {
                0x8 => {
                    let code = if f.payload.len() >= 2 { u16::from_be_bytes([f.payload[0], f.payload[1]]) } else { 1005 };
                    let mut echo = None;
                    if let Some(c) = self.conns.get_mut(&id) {
                        c.close_code = Some(code);
                        if !c.close_sent {
                            c.close_sent = true;
                            echo = Some(if f.payload.len() >= 2 { (code, String::new()) } else { (1000, String::new()) });
                        }
                    }
                    match echo {
                        Some((code, reason)) => self.send(id, Out::Close { code, reason, grace_ms: 0 }),
                        None => self.send(id, Out::End),
                    };
                }
                0x9 => {
                    self.send(id, Out::Pong(f.payload));
                }
                _ => {
                    if let Some(c) = self.conns.get_mut(&id) {
                        c.missed = 0;
                    }
                }
            }
            return None;
        }
        match f.op {
            0x2 => {
                self.close(id, 1003, "binary", CLOSE_GRACE_MS);
                None
            }
            0x1 => {
                if f.fin {
                    return Some(String::from_utf8_lossy(&f.payload).into_owned());
                }
                if let Some(c) = self.conns.get_mut(&id) {
                    c.frag = Some(f.payload);
                }
                None
            }
            0x0 => {
                let has_frag = self.conns.get(&id).map(|c| c.frag.is_some()).unwrap_or(false);
                if !has_frag {
                    self.close(id, 1002, "continuation", CLOSE_GRACE_MS);
                    return None;
                }
                let (too_big, whole) = {
                    let c = self.conns.get_mut(&id)?;
                    let frag = c.frag.as_mut()?;
                    frag.extend_from_slice(&f.payload);
                    if frag.len() > MAX_PAYLOAD {
                        (true, None)
                    } else if f.fin {
                        (false, c.frag.take())
                    } else {
                        (false, None)
                    }
                };
                if too_big {
                    self.close(id, 1009, "too big", CLOSE_GRACE_MS);
                    return None;
                }
                whole.map(|w| String::from_utf8_lossy(&w).into_owned())
            }
            _ => {
                self.close(id, 1002, "opcode", CLOSE_GRACE_MS);
                None
            }
        }
    }
    /// One complete text message from a socket (the Node onText()).
    pub fn on_text(&mut self, id: u64, text: &str) -> Inbound {
        self.stats.frames_in += 1;
        let (url_room, role_host, remote, closing, bound) = match self.conns.get_mut(&id) {
            Some(c) => {
                c.frames_in += 1;
                (c.url_room.clone(), c.role_host, c.remote.clone(), c.close_sent, c.fp.clone())
            }
            None => return Inbound::Dropped("gone"),
        };
        if closing {
            return self.drop_frame(id, "closing");
        }
        if text.len() > schema::MAX_WIRE_BYTES {
            return self.drop_frame(id, "oversize");
        }
        let d = match wire_decode(text) {
            Some(d) if d.frame.is_object() => d,
            _ => return self.drop_frame(id, "unparseable"),
        };
        let from = match d.frame.get("from").and_then(Value::as_str) {
            Some(f) if is_fingerprint(f) => f.to_string(),
            _ => return self.drop_frame(id, "from"),
        };
        let v = validate(&d.frame);
        let t = d.frame.get("t").and_then(Value::as_str).unwrap_or("");
        if !v.ok && !(v.reason == "version" && t == "hello") {
            return self.drop_frame(id, "invalid");
        }
        if d.frame.get("room").and_then(Value::as_str) != Some(url_room.as_str()) {
            return self.drop_frame(id, "room");
        }
        match bound {
            None => {
                if let Some(prev) = self.find_bound(&url_room, &from, id) {
                    self.close(prev, 4001, "replaced", CLOSE_GRACE_MS);
                } else if !role_host && url_room == self.code && self.bound_peers() >= self.cap {
                    self.close(id, 4004, "room full", CLOSE_GRACE_MS);
                    return self.drop_frame(id, "full");
                }
                if let Some(c) = self.conns.get_mut(&id) {
                    c.fp = Some(from.clone());
                }
            }
            Some(ref b) if b != &from => return self.drop_frame(id, "spoof"),
            _ => {}
        }
        if role_host {
            return self.drop_frame(id, "not-host");
        }
        if url_room != self.code {
            return self.drop_frame(id, "no-host");
        }
        Inbound::ToHost { text: text.to_string(), from, remote }
    }
    /// A page frame to one fingerprint or "*" (every bound peer in the room).
    /// Returns the delivered count, or the drop reason (counted).
    pub fn host_send(&mut self, to: Option<&str>, frame: &Value) -> Result<usize, &'static str> {
        let v = validate(frame);
        if !v.ok {
            self.stats.dropped += 1;
            *self.stats.dropped_by.entry("host-invalid".into()).or_insert(0) += 1;
            return Err("invalid");
        }
        let targets: Vec<u64> = match to {
            Some("*") => self.conns.values().filter(|c| c.fp.is_some() && !c.role_host && c.url_room == self.code && !c.close_sent).map(|c| c.id).collect(),
            Some(fp) => match self.find_bound(&self.code.clone(), fp, 0) {
                Some(id) => vec![id],
                None => Vec::new(),
            },
            None => Vec::new(),
        };
        if targets.is_empty() {
            self.stats.dropped += 1;
            *self.stats.dropped_by.entry("unknown-to".into()).or_insert(0) += 1;
            return Err("unknown-to");
        }
        let text = wire_encode(frame, to);
        let mut n = 0;
        for id in targets {
            if self.send(id, Out::Text(text.clone())) {
                n += 1;
            }
        }
        Ok(n)
    }
    /// Socket liveness (the Node heartbeat()): a socket silent for
    /// `ping_ms` gets a ping; `miss_limit` unanswered in a row -> 4003.
    /// Returns the ids closed this tick.
    pub fn heartbeat(&mut self, now: Instant, ping_ms: u64, miss_limit: u32) -> Vec<u64> {
        let mut closed = Vec::new();
        let ids: Vec<u64> = self.conns.keys().copied().collect();
        for id in ids {
            let (silent, missed) = match self.conns.get(&id) {
                Some(c) if !c.close_sent => (now.duration_since(c.last_in).as_millis() as u64 >= ping_ms, c.missed),
                _ => continue,
            };
            if !silent {
                continue;
            }
            if missed >= miss_limit {
                self.stats.heartbeat_closed += 1;
                self.close(id, 4003, "no-pong", CLOSE_GRACE_MS);
                closed.push(id);
                continue;
            }
            if let Some(c) = self.conns.get_mut(&id) {
                c.missed += 1;
            }
            self.send(id, Out::Ping(b"hb".to_vec()));
        }
        closed
    }
    pub fn close_all(&mut self, code: u16, reason: &str, grace_ms: u64) {
        let ids: Vec<u64> = self.conns.keys().copied().collect();
        for id in ids {
            self.close(id, code, reason, grace_ms);
        }
    }
    pub fn peers_json(&self) -> Vec<Value> {
        let mut v: Vec<&Conn> = self.conns.values().collect();
        v.sort_by_key(|c| c.id);
        v.iter()
            .map(|c| json!({ "id": c.id, "remote": c.remote, "room": c.url_room, "role": if c.role_host { "host" } else { "peer" }, "fp": c.fp, "closing": c.close_sent, "framesIn": c.frames_in, "framesOut": c.frames_out, "dropped": c.dropped, "missed": c.missed }))
            .collect()
    }
}

/* ----------------------------------------------------------------- HTTP */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub headers: HashMap<String, String>,
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parses the request head (everything before the blank line).
pub fn parse_head(text: &str) -> Option<Head> {
    let mut lines = text.split("\r\n");
    let req = lines.next()?;
    let mut parts = req.split(' ');
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let _version = parts.next()?;
    let (path, qs) = match target.find('?') {
        Some(i) => (target[..i].to_string(), &target[i + 1..]),
        None => (target.clone(), ""),
    };
    let mut query = HashMap::new();
    for kv in qs.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = match kv.find('=') {
            Some(i) => (&kv[..i], &kv[i + 1..]),
            None => (kv, ""),
        };
        query.entry(pct_decode(k)).or_insert_with(|| pct_decode(v));
    }
    let mut headers = HashMap::new();
    for l in lines {
        if l.is_empty() {
            break;
        }
        if let Some(i) = l.find(':') {
            headers.insert(l[..i].trim().to_ascii_lowercase(), l[i + 1..].trim().to_string());
        }
    }
    Some(Head { method, path, query, headers })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Guest { head_only: bool },
    Health,
    /// A plain (non-upgrade) request for the socket path.
    UpgradeRequired,
    NotFound,
    /// A refused upgrade: status, text, extra header line(s).
    Refuse { status: u16, text: &'static str, extra: &'static str },
    Upgrade { key: String, room: String, role_host: bool },
}

/// The Node server's two handlers (request + upgrade) as one decision.
pub fn route(h: &Head) -> Route {
    let is_upgrade = h.headers.contains_key("upgrade");
    let join = schema::ENDPOINT_JOIN.trim_end_matches('/');
    if is_upgrade {
        if h.path != schema::ENDPOINT_WS {
            return Route::Refuse { status: 404, text: "Not Found", extra: "" };
        }
        let up = h.headers.get("upgrade").map(|s| s.to_ascii_lowercase()).unwrap_or_default();
        let conn = h.headers.get("connection").map(|s| s.to_ascii_lowercase()).unwrap_or_default();
        if !up.contains("websocket") || !conn.contains("upgrade") {
            return Route::Refuse { status: 400, text: "Bad Request", extra: "" };
        }
        if h.headers.get("sec-websocket-version").map(String::as_str) != Some("13") {
            return Route::Refuse { status: 426, text: "Upgrade Required", extra: "Sec-WebSocket-Version: 13\r\n" };
        }
        let key = match h.headers.get("sec-websocket-key") {
            Some(k) if !k.is_empty() => k.clone(),
            _ => return Route::Refuse { status: 400, text: "Bad Request", extra: "" },
        };
        let room = h.query.get("room").map(|s| s.to_ascii_uppercase()).unwrap_or_default();
        if !is_room_code(&room) {
            return Route::Refuse { status: 400, text: "Bad Request", extra: "" };
        }
        let role_host = h.query.get("role").map(String::as_str) == Some("host");
        return Route::Upgrade { key, room, role_host };
    }
    let is_guest = h.path == schema::ENDPOINT_GUEST || h.path == "/guest.html" || h.path == join || h.path.starts_with(schema::ENDPOINT_JOIN);
    if (h.method == "GET" || h.method == "HEAD") && is_guest {
        return Route::Guest { head_only: h.method == "HEAD" };
    }
    if h.method == "GET" && h.path == "/health" {
        return Route::Health;
    }
    if h.path == schema::ENDPOINT_WS {
        return Route::UpgradeRequired;
    }
    Route::NotFound
}

pub fn http_response(status: u16, text: &str, ctype: &str, extra: &str, body: &[u8], head_only: bool) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status} {text}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\n{extra}\r\n", body.len()).into_bytes();
    if !head_only {
        out.extend_from_slice(body);
    }
    out
}

/* ------------------------------------------------------------- the host */

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomInfo {
    pub room: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub reachable: bool,
    /// Every non-loopback IPv4 address this machine holds right now, with
    /// its OS-reported adapter name; `ip`/`url` above carry whichever one
    /// `choose_advertised()` picked. The host screen (room-tauri.js) shows
    /// the rest so a laptop with a VPN adapter up can be corrected by eye.
    pub addresses: Vec<AddressInfo>,
}

/// One advertisable IPv4 address: the adapter's name and the address.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddressInfo {
    pub name: String,
    pub ip: String,
}

type Deliver = Box<dyn Fn(Value) + Send + Sync>;

pub struct Ctx {
    pub code: String,
    pub port: u16,
    pub started: Instant,
    pub ping_ms: u64,
    pub relay: Mutex<Relay>,
    deliver: Deliver,
}

impl Ctx {
    pub fn new(code: &str, port: u16, ping_ms: u64, deliver: Deliver) -> Self {
        Ctx { code: code.to_string(), port, started: Instant::now(), ping_ms, relay: Mutex::new(Relay::new(code, schema::SEAT_CAP)), deliver }
    }
    fn deliver(&self, v: Value) {
        (self.deliver)(v);
    }
    fn with_relay<T>(&self, f: impl FnOnce(&mut Relay) -> T) -> T {
        let mut g = self.relay.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut g)
    }
    pub fn health_json(&self) -> Value {
        self.with_relay(|r| {
            json!({
                "ok": true, "rooms": 1, "room": self.code, "connections": r.conns.len(), "protocol": schema::PROTOCOL_VERSION,
                "uptimeSec": self.started.elapsed().as_secs(), "bind": { "host": "0.0.0.0", "port": self.port },
                "guestBytes": GUEST_HTML.len(), "heartbeat": { "pingMs": self.ping_ms, "missLimit": MISS_LIMIT }, "stats": r.stats,
            })
        })
    }
    fn detach(&self, id: u64) {
        let gone = self.with_relay(|r| r.remove(id));
        if let Some(c) = gone {
            say(format!("close #{} {} {} from {} code {:?}", c.id, if c.role_host { "host" } else { "peer" }, c.url_room, c.remote, c.close_code));
            self.deliver(json!({ "type": "room:peer", "event": "close", "id": c.id, "peer": c.remote, "room": c.url_room, "role": if c.role_host { "host" } else { "peer" }, "fp": c.fp, "code": c.close_code }));
        }
    }
}

/// The page-side sink: `window.__GUIDON_ROOM_RX__(<json>)` on the main window.
pub fn page_deliverer<R: Runtime>(app: AppHandle<R>) -> Deliver {
    Box::new(move |v: Value| {
        if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
            let js = format!("try{{if(window.{RX_FN})window.{RX_FN}({v});}}catch(e){{}}");
            let _ = w.eval(js);
        }
    })
}

async fn read_head(rd: &mut tokio::net::tcp::OwnedReadHalf) -> Option<(Head, Vec<u8>)> {
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut chunk = [0u8; 2048];
    loop {
        let n = match tokio::time::timeout(HEAD_TIMEOUT, rd.read(&mut chunk)).await {
            Ok(Ok(0)) | Err(_) => return None,
            Ok(Err(_)) => return None,
            Ok(Ok(n)) => n,
        };
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..i + 4]).into_owned();
            let rest = buf[i + 4..].to_vec();
            return parse_head(&head).map(|h| (h, rest));
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
    }
}

async fn write_all(wr: &mut tokio::net::tcp::OwnedWriteHalf, bytes: &[u8]) -> bool {
    wr.write_all(bytes).await.is_ok() && wr.flush().await.is_ok()
}

async fn serve_conn(stream: TcpStream, addr: SocketAddr, ctx: Arc<Ctx>) {
    let _ = stream.set_nodelay(true);
    let (mut rd, mut wr) = stream.into_split();
    let (head, rest) = match read_head(&mut rd).await {
        Some(x) => x,
        None => return,
    };
    let remote = addr.to_string();
    let (key, room, role_host) = match route(&head) {
        Route::Guest { head_only } => {
            write_all(&mut wr, &http_response(200, "OK", "text/html; charset=utf-8", "X-Guidon-Fork: guest\r\n", GUEST_HTML, head_only)).await;
            let _ = wr.shutdown().await;
            return;
        }
        Route::Health => {
            let body = ctx.health_json().to_string();
            write_all(&mut wr, &http_response(200, "OK", "application/json; charset=utf-8", "", body.as_bytes(), false)).await;
            let _ = wr.shutdown().await;
            return;
        }
        Route::UpgradeRequired => {
            write_all(&mut wr, &http_response(426, "Upgrade Required", "text/plain", "Sec-WebSocket-Version: 13\r\n", b"upgrade required\n", false)).await;
            let _ = wr.shutdown().await;
            return;
        }
        Route::NotFound => {
            write_all(&mut wr, &http_response(404, "Not Found", "text/plain; charset=utf-8", "", b"404\n", false)).await;
            let _ = wr.shutdown().await;
            return;
        }
        Route::Refuse { status, text, extra } => {
            let msg = format!("HTTP/1.1 {status} {text}\r\nConnection: close\r\nContent-Type: text/plain\r\n{extra}\r\n{text}\n");
            write_all(&mut wr, msg.as_bytes()).await;
            let _ = wr.shutdown().await;
            return;
        }
        Route::Upgrade { key, room, role_host } => (key, room, role_host),
    };
    let accept = accept_key(&key);
    if !write_all(&mut wr, format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").as_bytes()).await {
        return;
    }
    let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
    let id = ctx.with_relay(|r| r.add(&remote, &room, role_host, tx));
    let ua = head.headers.get("user-agent").cloned().unwrap_or_default();
    say(format!("open #{id} {} {room} from {remote} ua {}", if role_host { "host" } else { "peer" }, &ua[..ua.len().min(60)]));
    ctx.deliver(json!({ "type": "room:peer", "event": "open", "id": id, "peer": remote, "room": room, "role": if role_host { "host" } else { "peer" }, "ua": ua }));

    // Reader: bytes -> frames -> relay -> page.
    let rctx = ctx.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let mut buf: Vec<u8> = rest;
        let mut chunk = [0u8; 8192];
        loop {
            if !buf.is_empty() {
                pump(&rctx, id, &mut buf);
            }
            let n = match rd.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            rctx.with_relay(|r| r.touch(id));
            buf.extend_from_slice(&chunk[..n]);
            if buf.len() > MAX_PAYLOAD * 2 {
                rctx.with_relay(|r| r.close(id, 1009, "too big", CLOSE_GRACE_MS));
                buf.clear();
                continue;
            }
            pump(&rctx, id, &mut buf);
        }
        rctx.detach(id);
    });

    // Writer: the relay's outbox -> the socket; owns the socket's end.
    while let Some(out) = rx.recv().await {
        let ended = match out {
            Out::Text(t) => !write_all(&mut wr, &encode_frame(0x1, t.as_bytes())).await,
            Out::Ping(p) => !write_all(&mut wr, &encode_frame(0x9, &p)).await,
            Out::Pong(p) => !write_all(&mut wr, &encode_frame(0xA, &p)).await,
            Out::End => true,
            Out::Close { code, reason, grace_ms } => {
                write_all(&mut wr, &encode_frame(0x8, &close_payload(code, &reason))).await;
                if grace_ms > 0 {
                    let deadline = Instant::now() + Duration::from_millis(grace_ms);
                    loop {
                        let left = deadline.saturating_duration_since(Instant::now());
                        if left.is_zero() {
                            break;
                        }
                        match tokio::time::timeout(left, rx.recv()).await {
                            Ok(Some(Out::End)) | Ok(None) | Err(_) => break,
                            Ok(Some(_)) => continue,
                        }
                    }
                }
                true
            }
        };
        if ended {
            break;
        }
    }
    let _ = wr.shutdown().await;
    reader.abort();
    ctx.detach(id);
}

/// Parses what the buffer holds and feeds the relay; one lock per frame.
fn pump(ctx: &Ctx, id: u64, buf: &mut Vec<u8>) {
    let frames = match parse_frames(buf) {
        Ok(f) => f,
        Err(p) => {
            ctx.with_relay(|r| r.close(id, p.code, p.reason, CLOSE_GRACE_MS));
            return;
        }
    };
    for f in frames {
        let inbound = ctx.with_relay(|r| r.on_raw(id, f).map(|text| r.on_text(id, &text)));
        match inbound {
            Some(Inbound::ToHost { text, from, remote }) => {
                ctx.deliver(json!({ "type": "room:frame", "text": text, "from": from, "peer": remote, "id": id }));
            }
            Some(Inbound::Dropped(reason)) => say(format!("drop #{id} {reason}")),
            None => {}
        }
    }
}

async fn accept_loop(listener: TcpListener, ctx: Arc<Ctx>) {
    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                let _ = tauri::async_runtime::spawn(serve_conn(stream, addr, ctx.clone()));
            }
            Err(e) => {
                say(format!("accept error: {e}"));
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
}

async fn heartbeat_loop(ctx: Arc<Ctx>) {
    loop {
        tokio::time::sleep(Duration::from_millis(ctx.ping_ms)).await;
        let closed = ctx.with_relay(|r| r.heartbeat(Instant::now(), ctx.ping_ms, MISS_LIMIT));
        for id in closed {
            say(format!("no-pong #{id}: {MISS_LIMIT} pings unanswered, closing 4003"));
        }
    }
}

/// True when `ip` is in a private (RFC 1918) range - the shapes every home
/// router, phone hotspot and office LAN hands out.
pub fn is_private_v4(ip: &Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 10 || (o[0] == 172 && (16..=31).contains(&o[1])) || (o[0] == 192 && o[1] == 168)
}

/// True when an adapter's OS-reported name reads as a VPN/virtual tunnel
/// rather than a real Wi-Fi/Ethernet NIC. This is the ONE place (rule 4)
/// that keyword list lives - measured 2026-09-05 twice: first the
/// Rust-phase spike run sheet (a VPN-looking "10.5.0.2" advertised over the
/// laptop's real Wi-Fi subnet, because the old lan_ip() just kept whichever
/// address a UDP "connect" happened to route through first); then
/// tools/test-room-tauri.mjs on THIS dev machine, which caught this list
/// missing "nordlynx" - NordVPN's own WireGuard-based adapter name carries
/// none of "vpn"/"wireguard" literally - and picked that 10.5.0.2 again
/// over the real 192.168.1.42 Wi-Fi. Product-branded VPN adapter names
/// (nordlynx, mullvad, ...) are added by name since they don't contain a
/// generic keyword; this list is necessarily a heuristic, never exhaustive.
pub fn looks_like_vpn(adapter_name: &str) -> bool {
    let n = adapter_name.to_ascii_lowercase();
    const KEYWORDS: &[&str] = &[
        "vpn", "tailscale", "wireguard", "zerotier", "tap-", "tap ", "tun-", "tun ", "hyper-v", "virtualbox", "vmware", "virtual", "utun", "ppp", "loopback",
        // Product-branded tunnel adapters with no generic keyword in the name.
        "nordlynx", "mullvad", "surfshark", "expressvpn", "protonvpn", "windscribe", "cyberghost", "hotspot shield", "privateinternetaccess",
    ];
    KEYWORDS.iter().any(|k| n.contains(k))
}

/// Ranks candidates for the ONE address `RoomInfo.ip`/`RoomInfo.url`
/// advertise: private-range + not-VPN-looking first, then private-range,
/// then everything else; ties keep enumeration order (first seen wins).
/// Pure and unit tested directly - the real enumeration
/// (`list_ipv4_interfaces`, Windows-only) is not, since a live machine's
/// actual adapters aren't something a unit test can pin (rule 6: that half
/// is measured by the smoke script, not asserted here).
pub fn choose_advertised(candidates: &[AddressInfo]) -> Option<&AddressInfo> {
    fn tier(a: &AddressInfo) -> u8 {
        let private = a.ip.parse::<Ipv4Addr>().map(|ip| is_private_v4(&ip)).unwrap_or(false);
        match (private, looks_like_vpn(&a.name)) {
            (true, false) => 0,
            (true, true) => 1,
            (false, false) => 2,
            (false, true) => 3,
        }
    }
    candidates.iter().enumerate().min_by_key(|(i, a)| (tier(a), *i)).map(|(_, a)| a)
}

/// Every non-loopback IPv4 address this machine currently holds, with the
/// OS-reported adapter name. `GUIDON_ROOM_TEST=1` with `GUIDON_ROOM_LAN_IP`
/// set short-circuits to one synthetic entry (tools/test-room-tauri.mjs
/// forces the X10 probe to fail this way) so a test box's real adapters
/// never make the suite flaky or need a LAN to run at all.
pub fn list_ipv4_interfaces() -> Vec<AddressInfo> {
    if is_test() {
        if let Some(v) = std::env::var(LAN_IP_ENV).ok().and_then(|s| s.parse::<Ipv4Addr>().ok()) {
            return vec![AddressInfo { name: "test-override".into(), ip: v.to_string() }];
        }
    }
    #[cfg(windows)]
    {
        win_adapters::list()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// R-ROOM address listing: real Win32 FFI over `GetAdaptersAddresses`
/// (iphlpapi), the same API `ipconfig` itself is built on. No new heavy
/// dependency - `windows-sys` was already resolved in Cargo.lock through
/// tao/wry; this only names it directly with the IP-Helper feature.
#[cfg(windows)]
mod win_adapters {
    use super::AddressInfo;
    use std::net::Ipv4Addr;
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetAdaptersAddresses, GAA_FLAG_INCLUDE_PREFIX, IP_ADAPTER_ADDRESSES_LH};
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC, SOCKADDR_IN};

    /// Walks every adapter `GetAdaptersAddresses` reports and every unicast
    /// IPv4 address on it - the buffer-growth retry loop and linked-list
    /// walk Microsoft's own sample uses. The scratch buffer is `u64`-typed
    /// (not `u8`) purely so its first byte is 8-byte aligned, which the
    /// struct's own fields require; it is never read as anything but that
    /// struct.
    pub fn list() -> Vec<AddressInfo> {
        let mut size: u32 = 16 * 1024;
        for _attempt in 0..5 {
            let words = (size as usize).div_ceil(8).max(1);
            let mut buf: Vec<u64> = vec![0u64; words];
            let ptr = buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
            let rc = unsafe { GetAdaptersAddresses(AF_UNSPEC as u32, GAA_FLAG_INCLUDE_PREFIX, std::ptr::null(), ptr, &mut size) };
            if rc == ERROR_SUCCESS {
                return unsafe { walk(ptr) };
            }
            if rc != ERROR_BUFFER_OVERFLOW {
                return Vec::new();
            }
            // ERROR_BUFFER_OVERFLOW: `size` now holds the required byte
            // count GetAdaptersAddresses wrote back - loop with that.
        }
        Vec::new()
    }

    unsafe fn walk(mut adapter: *const IP_ADAPTER_ADDRESSES_LH) -> Vec<AddressInfo> {
        let mut out = Vec::new();
        while !adapter.is_null() {
            let a = &*adapter;
            let name = wide_to_string(a.FriendlyName);
            let mut ucast = a.FirstUnicastAddress;
            while !ucast.is_null() {
                let u = &*ucast;
                if !u.Address.lpSockaddr.is_null() {
                    let sa = &*(u.Address.lpSockaddr as *const SOCKADDR_IN);
                    if sa.sin_family == AF_INET {
                        let b = sa.sin_addr.S_un.S_un_b;
                        let ip = Ipv4Addr::new(b.s_b1, b.s_b2, b.s_b3, b.s_b4);
                        if !ip.is_loopback() && !ip.is_unspecified() {
                            out.push(AddressInfo { name: name.clone(), ip: ip.to_string() });
                        }
                    }
                }
                ucast = u.Next;
            }
            adapter = a.Next;
        }
        out
    }

    /// A Windows wide (UTF-16, NUL-terminated) string to a Rust `String`.
    unsafe fn wide_to_string(p: *mut u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut len: isize = 0;
        while *p.offset(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, len as usize))
    }
}

/// X10: can a second socket reach the advertised ip:port at all?
pub async fn self_probe(ip: &str, port: u16) -> bool {
    matches!(tokio::time::timeout(PROBE_TIMEOUT, TcpStream::connect((ip, port))).await, Ok(Ok(_)))
}

/* ----------------------------------------------------------- keep-awake */

/// X13: `SetThreadExecutionState` is per THREAD and ES_CONTINUOUS lasts
/// until that thread clears it or exits, so the flag lives on a thread of
/// its own for exactly the room's lifetime.
pub struct KeepAwake {
    stop: Option<std::sync::mpsc::Sender<()>>,
    held: Arc<AtomicBool>,
    pub mode: &'static str,
}

#[cfg(windows)]
mod power {
    #[link(name = "kernel32")]
    extern "system" {
        pub fn SetThreadExecutionState(flags: u32) -> u32;
    }
    pub const ES_CONTINUOUS: u32 = 0x8000_0000;
    pub const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    pub const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;
}

impl KeepAwake {
    pub fn start() -> Self {
        let held = Arc::new(AtomicBool::new(false));
        #[cfg(windows)]
        {
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            let flag = held.clone();
            let spawned = std::thread::Builder::new().name("guidon-keepawake".into()).spawn(move || {
                let prev = unsafe { power::SetThreadExecutionState(power::ES_CONTINUOUS | power::ES_SYSTEM_REQUIRED | power::ES_DISPLAY_REQUIRED) };
                flag.store(prev != 0, Ordering::SeqCst);
                let _ = rx.recv();
                unsafe { power::SetThreadExecutionState(power::ES_CONTINUOUS) };
                flag.store(false, Ordering::SeqCst);
            });
            if spawned.is_ok() {
                // The thread sets the flag before it blocks; give it a moment
                // so a stats read right after start already says held.
                for _ in 0..50 {
                    if held.load(Ordering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(2));
                }
                return KeepAwake { stop: Some(tx), held, mode: "SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_DISPLAY_REQUIRED)" };
            }
        }
        KeepAwake { stop: None, held, mode: "none" }
    }
    pub fn held(&self) -> bool {
        self.held.load(Ordering::SeqCst)
    }
}
impl Drop for KeepAwake {
    fn drop(&mut self) {
        if let Some(tx) = self.stop.take() {
            let _ = tx.send(());
            for _ in 0..50 {
                if !self.held.load(Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }
}

/* ------------------------------------------------------------- commands */

pub struct Live {
    pub info: RoomInfo,
    pub ctx: Arc<Ctx>,
    accept: tauri::async_runtime::JoinHandle<()>,
    heartbeat: tauri::async_runtime::JoinHandle<()>,
    keep: KeepAwake,
}

impl Live {
    pub fn stop(self) {
        self.ctx.with_relay(|r| r.close_all(4000, "host-left", STOP_GRACE_MS));
        self.accept.abort();
        self.heartbeat.abort();
        say(format!("stop {} on port {}", self.info.room, self.info.port));
        drop(self.keep);
    }
}

/// Managed state: `None` until the page starts a room.
#[derive(Default)]
pub struct RoomState(pub Mutex<Option<Live>>);

impl RoomState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Live>> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// Starts the listener for `code`. Any earlier room is stopped first.
pub async fn start_room(state: &RoomState, port: Option<u16>, code: &str, deliver: Deliver) -> Result<RoomInfo, String> {
    let code = code.trim().to_ascii_uppercase();
    if !is_room_code(&code) {
        return Err(format!("{code:?} is not a room code (two phonetic words and two digits)"));
    }
    if let Some(prev) = state.lock().take() {
        prev.stop();
    }
    let want = SocketAddr::from(([0, 0, 0, 0], port.unwrap_or(0)));
    let listener = TcpListener::bind(want).await.map_err(|e| format!("bind {want}: {e}"))?;
    let bound = listener.local_addr().map_err(|e| format!("local_addr: {e}"))?.port();
    let addresses = list_ipv4_interfaces();
    let ip = choose_advertised(&addresses).map(|a| a.ip.clone()).unwrap_or_else(|| "127.0.0.1".to_string());
    let ctx = Arc::new(Ctx::new(&code, bound, ping_ms(), deliver));
    let accept = tauri::async_runtime::spawn(accept_loop(listener, ctx.clone()));
    let heartbeat = tauri::async_runtime::spawn(heartbeat_loop(ctx.clone()));
    let reachable = self_probe(&ip, bound).await;
    let keep = KeepAwake::start();
    let info = RoomInfo { room: code.clone(), ip: ip.clone(), port: bound, url: format!("http://{ip}:{bound}{}{code}", schema::ENDPOINT_JOIN), reachable, addresses };
    say(format!("start {code} on 0.0.0.0:{bound}, advertised {ip}, reachable {reachable}, keep-awake {} ({})", keep.held(), keep.mode));
    *state.lock() = Some(Live { info: info.clone(), ctx, accept, heartbeat, keep });
    Ok(info)
}

#[tauri::command]
pub async fn room_start<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, RoomState>,
    port: Option<u16>,
    code: String,
    study_groups: bool,
    fork: String,
) -> Result<RoomInfo, String> {
    guard(study_groups, &fork, window.label())?;
    start_room(&state, port, &code, page_deliverer(app)).await
}

#[tauri::command]
pub fn room_send<R: Runtime>(window: WebviewWindow<R>, state: State<'_, RoomState>, to: Option<String>, frame: Value, study_groups: bool, fork: String) -> Result<Value, String> {
    guard(study_groups, &fork, window.label())?;
    let held = state.lock();
    let live = held.as_ref().ok_or_else(|| "no room is open".to_string())?;
    Ok(match live.ctx.with_relay(|r| r.host_send(to.as_deref(), &frame)) {
        Ok(n) => json!({ "sent": n }),
        Err(reason) => json!({ "sent": 0, "dropped": reason }),
    })
}

#[tauri::command]
pub fn room_stop<R: Runtime>(window: WebviewWindow<R>, state: State<'_, RoomState>, study_groups: bool, fork: String) -> Result<Value, String> {
    // The setting is accepted but not consulted (see guard_stop): the page
    // reports `false` here precisely when it is turning the room off.
    let _ = study_groups;
    guard_stop(&fork, window.label())?;
    let prev = state.lock().take();
    let stopped = prev.is_some();
    if let Some(p) = prev {
        p.stop();
    }
    Ok(json!({ "stopped": stopped }))
}

pub fn stats_json(state: &RoomState) -> Value {
    let live = state.lock();
    match live.as_ref() {
        None => json!({ "open": false, "keepAwake": false, "test": is_test(), "connections": 0, "framesIn": 0, "framesOut": 0, "dropped": 0, "droppedBy": {}, "closed": 0, "heartbeatClosed": 0, "peers": [] }),
        Some(l) => {
            let (stats, peers) = l.ctx.with_relay(|r| (r.stats.clone(), r.peers_json()));
            let mut m = match serde_json::to_value(&stats) {
                Ok(Value::Object(m)) => m,
                _ => Map::new(),
            };
            m.insert("open".into(), json!(true));
            m.insert("room".into(), json!(l.info.room));
            m.insert("ip".into(), json!(l.info.ip));
            m.insert("port".into(), json!(l.info.port));
            m.insert("url".into(), json!(l.info.url));
            m.insert("reachable".into(), json!(l.info.reachable));
            m.insert("keepAwake".into(), json!(l.keep.held()));
            m.insert("keepAwakeMode".into(), json!(l.keep.mode));
            m.insert("uptimeMs".into(), json!(l.ctx.started.elapsed().as_millis() as u64));
            m.insert("pingMs".into(), json!(l.ctx.ping_ms));
            m.insert("missLimit".into(), json!(MISS_LIMIT));
            m.insert("seatCap".into(), json!(schema::SEAT_CAP));
            m.insert("test".into(), json!(is_test()));
            m.insert("peers".into(), Value::Array(peers));
            Value::Object(m)
        }
    }
}

#[tauri::command]
pub fn room_stats<R: Runtime>(window: WebviewWindow<R>, state: State<'_, RoomState>, study_groups: bool, fork: String) -> Result<Value, String> {
    guard(study_groups, &fork, window.label())?;
    Ok(stats_json(&state))
}

/* ---------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    const ROOM: &str = "ALPHA-BRAVO-42";

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }
    fn app_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    }
    fn frame(from: &str, t: &str, body: Value) -> Value {
        json!({ "v": schema::PROTOCOL_VERSION, "t": t, "room": ROOM, "seq": 0, "from": from, "body": body })
    }
    fn masked(op: u8, payload: &[u8]) -> Vec<u8> {
        let mask = [0x11u8, 0x22, 0x33, 0x44];
        let mut out = vec![0x80 | op, 0x80 | payload.len() as u8];
        out.extend_from_slice(&mask);
        for (i, b) in payload.iter().enumerate() {
            out.push(b ^ mask[i & 3]);
        }
        out
    }
    fn drain(rx: &mut mpsc::UnboundedReceiver<Out>) -> Vec<Out> {
        let mut v = Vec::new();
        while let Ok(o) = rx.try_recv() {
            v.push(o);
        }
        v
    }
    fn texts(outs: &[Out]) -> Vec<String> {
        outs.iter().filter_map(|o| if let Out::Text(t) = o { Some(t.clone()) } else { None }).collect()
    }

    /* ---- generated schema ---- */

    #[test]
    fn generated_schema_is_fresh() {
        let out = Command::new("node")
            .args(["tools/gen-room-schema-rs.mjs", "--stdout"])
            .current_dir(app_dir())
            .output()
            .expect("node is on PATH (the generator is tools/gen-room-schema-rs.mjs)");
        assert!(out.status.success(), "generator failed: {}", String::from_utf8_lossy(&out.stderr));
        let fresh = String::from_utf8(out.stdout).expect("generator output is UTF-8");
        let disk = include_str!("room_schema_gen.rs");
        assert_eq!(disk, fresh, "src-tauri/src/room_schema_gen.rs is STALE - run `npm run room:gen-rs` in guidon-app/");
        assert!(disk.is_ascii() && !disk.contains('\r'));
    }

    #[test]
    fn generated_schema_carries_the_locked_allowlist() {
        assert_eq!(schema::PROTOCOL_VERSION, 1);
        assert_eq!(schema::TYPES, &["hello", "admit", "welcome", "snapshot", "intent", "reject", "kick", "ping", "pong", "bye", "end"]);
        assert!(!schema::INTENT_KINDS.contains(&"grade"), "no grade intent, ever (rule 8)");
        assert_eq!(schema::MAX_FRAME_BYTES, 4096);
        assert_eq!(schema::SEAT_CAP, 8);
        assert_eq!(schema::ENDPOINT_WS, "/ws");
    }

    #[test]
    fn embedded_guest_page_equals_dist_guest_html() {
        let disk = std::fs::read(app_dir().join("dist/guest.html")).expect("dist/guest.html on disk (npm run build)");
        assert_eq!(GUEST_HTML.len(), disk.len(), "byte count");
        assert!(GUEST_HTML == disk.as_slice(), "the embedded guest page differs from dist/guest.html - rebuild the exe");
        let text = String::from_utf8_lossy(GUEST_HTML);
        assert_eq!(text.matches("window.GUIDON_FORK = \"guest\";").count(), 1);
        assert!(GUEST_HTML.len() < 200 * 1024);
    }

    /* ---- hashing / handshake ---- */

    #[test]
    fn sha1_matches_the_rfc_vectors() {
        assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(hex(&sha1(b"abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(hex(&sha1(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")), "84983e441c3bd26ebaae4aa1f95129e5e54670f1");
        let long = vec![b'a'; 1000];
        assert_eq!(hex(&sha1(&long)), "291e9a6c66994949b57ba5e650361e98fc36b1ba");
    }

    #[test]
    fn base64_matches_rfc_4648() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn accept_key_is_the_rfc_6455_example() {
        assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    /* ---- schema checks ---- */

    #[test]
    fn room_codes_and_fingerprints() {
        assert!(is_room_code("ALPHA-BRAVO-42"));
        assert!(is_room_code("ZULU-YANKEE-00"));
        assert!(!is_room_code("alpha-bravo-42"));
        assert!(!is_room_code("ALPHA-BRAVO-4"));
        assert!(!is_room_code("ALPHA-NOPE-42"));
        assert!(!is_room_code("ALPHA-BRAVO-42-1"));
        assert!(is_fingerprint("PEERAAAA"));
        assert!(is_fingerprint("A2B3C4D5"));
        assert!(!is_fingerprint("PEERAAA"));
        assert!(!is_fingerprint("peeraaaa"));
        assert!(!is_fingerprint("PEER1AAA"));
    }

    #[test]
    fn validate_accepts_a_hello_and_an_intent() {
        assert_eq!(validate(&frame("PEERAAAA", "hello", json!({ "name": "A", "bankSig": "b", "build": "38c2f22", "app": "1.5.0" }))), Verdict { ok: true, reason: String::new() });
        assert!(validate(&frame("PEERAAAA", "intent", json!({ "kind": "score", "value": 2, "cardId": "bq1" }))).ok);
        assert!(validate(&frame("PEERAAAA", "ping", json!({ "n": 7 }))).ok);
        assert!(validate(&frame("PEERAAAA", "bye", json!({}))).ok);
    }

    #[test]
    fn validate_rejects_a_grade_anywhere() {
        assert_eq!(validate(&frame("PEERAAAA", "intent", json!({ "kind": "score", "value": 1, "grade": 2 }))).reason, "grade");
        let mut f = frame("PEERAAAA", "hello", json!({ "name": "A", "bankSig": "b" }));
        f["body"]["name"] = json!({ "grade": 1 });
        assert_eq!(validate(&f).reason, "grade");
    }

    #[test]
    fn validate_rejects_shape_faults() {
        assert_eq!(validate(&json!("x")).reason, "frame");
        assert_eq!(validate(&json!({ "v": 1 })).reason, "missing:t");
        let mut f = frame("PEERAAAA", "ping", json!({ "n": 1 }));
        f["extra"] = json!(1);
        assert_eq!(validate(&f).reason, "extra:extra");
        let mut f = frame("PEERAAAA", "ping", json!({ "n": 1 }));
        f["v"] = json!(2);
        assert_eq!(validate(&f).reason, "version");
        assert_eq!(validate(&frame("PEERAAAA", "grade", json!({}))).reason, "type");
        let mut f = frame("PEERAAAA", "ping", json!({ "n": 1 }));
        f["room"] = json!("NOPE-NOPE-11");
        assert_eq!(validate(&f).reason, "room");
        assert_eq!(validate(&frame("peer", "ping", json!({ "n": 1 }))).reason, "from");
        assert_eq!(validate(&frame("PEERAAAA", "intent", json!({ "kind": "cheat" }))).reason, "kind");
        assert_eq!(validate(&frame("PEERAAAA", "intent", json!({ "kind": "score" }))).reason, "body-missing:value");
        assert_eq!(validate(&frame("PEERAAAA", "intent", json!({ "kind": "score", "value": 1000 }))).reason, "value");
        assert_eq!(validate(&frame("PEERAAAA", "ping", json!({ "n": 1, "x": 2 }))).reason, "body-key:x");
        assert_eq!(validate(&frame("PEERAAAA", "hello", json!({ "name": "", "bankSig": "b" }))).reason, "name");
        assert_eq!(validate(&frame("PEERAAAA", "ping", json!({ "n": 1.5 }))).reason, "n");
    }

    #[test]
    fn validate_rejects_an_oversize_frame() {
        let f = frame("PEERAAAA", "reject", json!({ "reason": "r" }));
        assert!(validate(&f).ok);
        let big = frame("PEERAAAA", "snapshot", json!({ "snapshot": { "phase": "lobby", "mode": "relay", "seq": 1, "room": ROOM, "hostSeat": 1, "seats": [],
            "cardText": { "q": "Q".repeat(1500), "a": "A".repeat(1500), "category": "C".repeat(80) }, "deck": { "category": "D".repeat(80), "timerSec": 60 }, "bankSig": "b".repeat(48) } }));
        assert!(serde_json::to_string(&big).unwrap().len() < schema::MAX_FRAME_BYTES);
        let mut seats = Vec::new();
        for i in 1..=20 {
            seats.push(json!({ "seatNo": i, "name": "N".repeat(24), "fp": "SEATAAAA", "score": 999999, "online": true, "ready": true, "done": false }));
        }
        let mut huge = big.clone();
        huge["body"]["snapshot"]["seats"] = Value::Array(seats);
        assert!(serde_json::to_string(&huge).unwrap().len() >= schema::MAX_FRAME_BYTES);
        assert_eq!(validate(&huge).reason, "size");
    }

    #[test]
    fn validate_welcome_snapshot_rules() {
        let snap = json!({ "phase": "lobby", "mode": "relay", "seq": 1, "room": ROOM, "hostSeat": 1, "cardId": null, "cardText": null, "turnSeat": null, "lock": null, "deadline": null, "round": { "idx": 0, "total": 0 }, "seats": [{ "seatNo": 1, "name": "H", "fp": "NODEHOST", "score": 0, "online": true, "ready": true }], "bankSig": "b" });
        assert!(validate(&frame("NODEHOST", "welcome", json!({ "seatNo": 2, "token": "tok", "snapshot": snap }))).ok);
        let mut bad = snap.clone();
        bad["seats"][0]["token"] = json!("leak");
        assert_eq!(validate(&frame("NODEHOST", "welcome", json!({ "seatNo": 2, "token": "tok", "snapshot": bad }))).reason, "seat-key:token");
        let mut bad = snap.clone();
        bad["phase"] = json!("secret");
        assert_eq!(validate(&frame("NODEHOST", "snapshot", json!({ "snapshot": bad }))).reason, "snapshot-phase");

        // Agnosticism audit, 6 Sep 2026 (F8): cardText.kind is optional and
        // additive - both an explicit "text" and no kind at all must
        // validate, but any kind outside schema::CARD_TEXT_KINDS must not.
        let mut ok_with_kind = snap.clone();
        ok_with_kind["cardId"] = json!("q1");
        ok_with_kind["cardText"] = json!({ "q": "Q", "a": "A", "kind": "text" });
        assert!(validate(&frame("NODEHOST", "snapshot", json!({ "snapshot": ok_with_kind }))).ok);
        let mut ok_without_kind = snap.clone();
        ok_without_kind["cardId"] = json!("q1");
        ok_without_kind["cardText"] = json!({ "q": "Q", "a": "A" });
        assert!(validate(&frame("NODEHOST", "snapshot", json!({ "snapshot": ok_without_kind }))).ok);
        let mut bad_kind = snap.clone();
        bad_kind["cardId"] = json!("q1");
        bad_kind["cardText"] = json!({ "q": "Q", "a": "A", "kind": "image" });
        assert_eq!(validate(&frame("NODEHOST", "snapshot", json!({ "snapshot": bad_kind }))).reason, "snapshot-text-kind");
    }

    #[test]
    fn wire_envelope_round_trips_and_refuses_junk() {
        let f = frame("PEERAAAA", "ping", json!({ "n": 1 }));
        let d = wire_decode(&wire_encode(&f, None)).unwrap();
        assert_eq!(d.to, None);
        assert_eq!(d.frame, f);
        let d = wire_decode(&wire_encode(&f, Some("*"))).unwrap();
        assert_eq!(d.to.as_deref(), Some("*"));
        assert!(wire_decode("{not json").is_none());
        assert!(wire_decode("{\"to\":\"bad\",\"f\":{}}").is_none());
        assert!(wire_decode("{\"f\":{},\"x\":1}").is_none());
        assert!(wire_decode("{\"to\":null}").is_none());
        let padded = format!("{}{}", wire_encode(&f, None), " ".repeat(schema::MAX_WIRE_BYTES));
        assert!(wire_decode(&padded).is_none());
    }

    /* ---- RFC 6455 framing ---- */

    #[test]
    fn parse_frames_handles_masked_partial_and_16_bit_frames() {
        let mut buf = masked(0x9, b"hi");
        let f = parse_frames(&mut buf).unwrap();
        assert_eq!(f, vec![RawFrame { op: 0x9, fin: true, rsv: 0, payload: b"hi".to_vec() }]);
        assert!(buf.is_empty());
        let whole = masked(0x1, b"hello");
        let mut part = whole[..4].to_vec();
        assert_eq!(parse_frames(&mut part).unwrap(), vec![]);
        assert_eq!(part.len(), 4, "a partial frame stays buffered");
        let payload = vec![b'x'; 300];
        let mask = [1u8, 2, 3, 4];
        let mut big = vec![0x81, 0x80 | 126, 0x01, 0x2c];
        big.extend_from_slice(&mask);
        for (i, b) in payload.iter().enumerate() {
            big.push(b ^ mask[i & 3]);
        }
        let f = parse_frames(&mut big).unwrap();
        assert_eq!(f[0].payload, payload);
    }

    #[test]
    fn parse_frames_refuses_unmasked_and_huge() {
        let mut buf = vec![0x81, 0x02, 0x68, 0x69];
        assert_eq!(parse_frames(&mut buf), Err(Proto { code: 1002, reason: "unmasked" }));
        let mut buf = vec![0x81, 0x80 | 127];
        buf.extend_from_slice(&((MAX_PAYLOAD as u64) + 1).to_be_bytes());
        assert_eq!(parse_frames(&mut buf), Err(Proto { code: 1009, reason: "too big" }));
    }

    #[test]
    fn encode_frame_lengths() {
        assert_eq!(encode_frame(0x1, b"hi"), vec![0x81, 2, b'h', b'i']);
        let e = encode_frame(0x1, &vec![b'x'; 300]);
        assert_eq!(&e[..4], &[0x81, 126, 0x01, 0x2c]);
        let e = encode_frame(0x8, &close_payload(4000, "host-left"));
        assert_eq!(&e[..4], &[0x88, 11, 0x0f, 0xa0]);
        assert_eq!(close_payload(1000, &"r".repeat(200)).len(), 122);
    }

    /* ---- the relay on in-memory pairs ---- */

    fn pair(relay: &mut Relay, remote: &str, room: &str, host: bool) -> (u64, mpsc::UnboundedReceiver<Out>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (relay.add(remote, room, host, tx), rx)
    }

    #[test]
    fn relay_forwards_peer_frames_to_the_host_byte_for_byte() {
        let mut r = Relay::new(ROOM, 8);
        let (a, mut arx) = pair(&mut r, "127.0.0.1:1", ROOM, false);
        let text = wire_encode(&frame("PEERAAAA", "hello", json!({ "name": "A", "bankSig": "b" })), None);
        let odd = format!("{{\"to\":null, \"f\":{}}}", frame("PEERAAAA", "hello", json!({ "name": "A", "bankSig": "b" })));
        assert_eq!(r.on_text(a, &text), Inbound::ToHost { text: text.clone(), from: "PEERAAAA".into(), remote: "127.0.0.1:1".into() });
        assert_eq!(r.on_text(a, &odd), Inbound::ToHost { text: odd.clone(), from: "PEERAAAA".into(), remote: "127.0.0.1:1".into() }, "the ORIGINAL text, spaces and all");
        assert!(drain(&mut arx).is_empty(), "nothing goes back to the peer by itself");
        assert_eq!(r.stats.frames_in, 2);
        assert_eq!(r.conns[&a].fp.as_deref(), Some("PEERAAAA"));
    }

    #[test]
    fn relay_drops_and_counts_grade_room_spoof_oversize_unparseable() {
        let mut r = Relay::new(ROOM, 8);
        let (a, _arx) = pair(&mut r, "127.0.0.1:1", ROOM, false);
        assert_eq!(r.on_text(a, &wire_encode(&frame("PEERAAAA", "ping", json!({ "n": 0 })), None)), Inbound::ToHost { text: wire_encode(&frame("PEERAAAA", "ping", json!({ "n": 0 })), None), from: "PEERAAAA".into(), remote: "127.0.0.1:1".into() });
        assert_eq!(r.on_text(a, &wire_encode(&frame("PEERAAAA", "intent", json!({ "kind": "score", "value": 1, "grade": 2 })), None)), Inbound::Dropped("invalid"));
        let mut wrong = frame("PEERAAAA", "ping", json!({ "n": 1 }));
        wrong["room"] = json!("ZULU-ZULU-00");
        assert_eq!(r.on_text(a, &wire_encode(&wrong, None)), Inbound::Dropped("room"));
        assert_eq!(r.on_text(a, &wire_encode(&frame("PEERBBBB", "ping", json!({ "n": 2 })), None)), Inbound::Dropped("spoof"));
        let padded = format!("{}{}", wire_encode(&frame("PEERAAAA", "ping", json!({ "n": 3 })), None), " ".repeat(schema::MAX_WIRE_BYTES));
        assert_eq!(r.on_text(a, &padded), Inbound::Dropped("oversize"));
        assert_eq!(r.on_text(a, "{not json"), Inbound::Dropped("unparseable"));
        assert_eq!(r.on_text(a, &wire_encode(&frame("PEERAAAA", "grade", json!({})), None)), Inbound::Dropped("invalid"), "unknown type");
        let mut skew = frame("PEERAAAA", "hello", json!({ "name": "OLD", "bankSig": "b" }));
        skew["v"] = json!(schema::PROTOCOL_VERSION + 1);
        assert!(matches!(r.on_text(a, &wire_encode(&skew, None)), Inbound::ToHost { .. }), "a v-mismatch hello reaches the page (only the page answers)");
        assert_eq!(r.stats.dropped, 6);
        assert_eq!(r.stats.dropped_by["invalid"], 2);
        assert_eq!(r.stats.dropped_by["room"], 1);
        assert_eq!(r.stats.dropped_by["spoof"], 1);
        assert_eq!(r.stats.dropped_by["oversize"], 1);
        assert_eq!(r.stats.dropped_by["unparseable"], 1);
        assert_eq!(r.conns[&a].dropped, 6);
    }

    #[test]
    fn relay_host_send_addresses_one_fingerprint_or_everyone() {
        let mut r = Relay::new(ROOM, 8);
        let (a, mut arx) = pair(&mut r, "127.0.0.1:1", ROOM, false);
        let (b, mut brx) = pair(&mut r, "127.0.0.1:2", ROOM, false);
        r.on_text(a, &wire_encode(&frame("PEERAAAA", "hello", json!({ "name": "A", "bankSig": "b" })), None));
        r.on_text(b, &wire_encode(&frame("PEERBBBB", "hello", json!({ "name": "B", "bankSig": "b" })), None));
        let welcome = frame("NODEHOST", "reject", json!({ "reason": "no" }));
        assert_eq!(r.host_send(Some("PEERAAAA"), &welcome), Ok(1));
        assert_eq!(texts(&drain(&mut arx)), vec![wire_encode(&welcome, Some("PEERAAAA"))]);
        assert!(texts(&drain(&mut brx)).is_empty(), "B saw nothing addressed to A");
        let ping = frame("NODEHOST", "ping", json!({ "n": 7 }));
        assert_eq!(r.host_send(Some("*"), &ping), Ok(2));
        assert_eq!(texts(&drain(&mut arx)).len(), 1);
        assert_eq!(texts(&drain(&mut brx)).len(), 1);
        assert_eq!(r.host_send(Some("NOBODY22"), &ping), Err("unknown-to"));
        assert_eq!(r.host_send(None, &ping), Err("unknown-to"));
        assert_eq!(r.host_send(Some("PEERAAAA"), &frame("NODEHOST", "intent", json!({ "kind": "score", "value": 1, "grade": 2 }))), Err("invalid"));
        assert_eq!(r.stats.frames_out, 3);
        assert_eq!(r.stats.dropped_by["unknown-to"], 2);
        assert_eq!(r.stats.dropped_by["host-invalid"], 1);
    }

    #[test]
    fn relay_replaces_a_rebound_fingerprint_and_refuses_a_host_socket() {
        let mut r = Relay::new(ROOM, 8);
        let (a, mut arx) = pair(&mut r, "127.0.0.1:1", ROOM, false);
        r.on_text(a, &wire_encode(&frame("PEERAAAA", "hello", json!({ "name": "A", "bankSig": "b" })), None));
        let (a2, _a2rx) = pair(&mut r, "127.0.0.1:3", ROOM, false);
        assert!(matches!(r.on_text(a2, &wire_encode(&frame("PEERAAAA", "hello", json!({ "name": "A", "bankSig": "b" })), None)), Inbound::ToHost { .. }));
        assert_eq!(drain(&mut arx), vec![Out::Close { code: 4001, reason: "replaced".into(), grace_ms: CLOSE_GRACE_MS }]);
        assert_eq!(r.on_text(a, &wire_encode(&frame("PEERAAAA", "ping", json!({ "n": 1 })), None)), Inbound::Dropped("closing"));
        let ping = frame("NODEHOST", "ping", json!({ "n": 7 }));
        assert_eq!(r.host_send(Some("PEERAAAA"), &ping), Ok(1), "the page's frame goes to the NEW socket");
        let (h, mut hrx) = pair(&mut r, "127.0.0.1:9", ROOM, true);
        assert_eq!(drain(&mut hrx), vec![Out::Close { code: 4002, reason: "room already has a host".into(), grace_ms: CLOSE_GRACE_MS }]);
        assert_eq!(r.on_text(h, &wire_encode(&frame("NODEHOST", "end", json!({})), None)), Inbound::Dropped("closing"), "a refused host injects nothing");
        let (c, _crx) = pair(&mut r, "127.0.0.1:4", "ZULU-YANKEE-99", false);
        let mut other = frame("PEERCCCC", "hello", json!({ "name": "C", "bankSig": "b" }));
        other["room"] = json!("ZULU-YANKEE-99");
        assert_eq!(r.on_text(c, &wire_encode(&other, None)), Inbound::Dropped("no-host"));
    }

    #[test]
    fn relay_enforces_the_seat_cap() {
        let mut r = Relay::new(ROOM, schema::SEAT_CAP);
        let mut rxs = Vec::new();
        for i in 0..schema::SEAT_CAP {
            let (id, rx) = pair(&mut r, &format!("127.0.0.1:{i}"), ROOM, false);
            let fp = format!("PEER{}AAA", (b'A' + i as u8) as char);
            assert!(matches!(r.on_text(id, &wire_encode(&frame(&fp, "hello", json!({ "name": "x", "bankSig": "b" })), None)), Inbound::ToHost { .. }), "peer {i} binds");
            rxs.push(rx);
        }
        assert_eq!(r.bound_peers(), schema::SEAT_CAP);
        let (ninth, mut nrx) = pair(&mut r, "127.0.0.1:99", ROOM, false);
        assert_eq!(r.on_text(ninth, &wire_encode(&frame("NINTHNIN", "hello", json!({ "name": "9", "bankSig": "b" })), None)), Inbound::Dropped("full"));
        assert_eq!(drain(&mut nrx), vec![Out::Close { code: 4004, reason: "room full".into(), grace_ms: CLOSE_GRACE_MS }]);
        assert_eq!(r.bound_peers(), schema::SEAT_CAP);
        // a bound peer reconnecting (replace) is not a 9th seat
        let (again, _arx) = pair(&mut r, "127.0.0.1:100", ROOM, false);
        assert!(matches!(r.on_text(again, &wire_encode(&frame("PEERAAAA", "hello", json!({ "name": "x", "bankSig": "b" })), None)), Inbound::ToHost { .. }));
        assert_eq!(r.bound_peers(), schema::SEAT_CAP);
    }

    #[test]
    fn relay_control_frames_and_heartbeat() {
        let mut r = Relay::new(ROOM, 8);
        let (a, mut arx) = pair(&mut r, "127.0.0.1:1", ROOM, false);
        assert_eq!(r.on_raw(a, RawFrame { op: 0x9, fin: true, rsv: 0, payload: b"hi".to_vec() }), None);
        assert_eq!(drain(&mut arx), vec![Out::Pong(b"hi".to_vec())]);
        assert_eq!(r.on_raw(a, RawFrame { op: 0x1, fin: false, rsv: 0, payload: b"{\"to\":null,".to_vec() }), None);
        assert_eq!(r.on_raw(a, RawFrame { op: 0x0, fin: true, rsv: 0, payload: b"\"f\":{}}".to_vec() }), Some("{\"to\":null,\"f\":{}}".to_string()));
        assert_eq!(r.on_raw(a, RawFrame { op: 0x2, fin: true, rsv: 0, payload: vec![1] }), None);
        assert_eq!(drain(&mut arx), vec![Out::Close { code: 1003, reason: "binary".into(), grace_ms: CLOSE_GRACE_MS }]);
        let (b, mut brx) = pair(&mut r, "127.0.0.1:2", ROOM, false);
        let t0 = Instant::now();
        assert!(r.heartbeat(t0, 120, 3).is_empty(), "not silent yet");
        assert!(drain(&mut brx).is_empty());
        let later = t0 + Duration::from_millis(130);
        assert!(r.heartbeat(later, 120, 3).is_empty());
        assert!(r.heartbeat(later, 120, 3).is_empty());
        assert!(r.heartbeat(later, 120, 3).is_empty());
        assert_eq!(drain(&mut brx), vec![Out::Ping(b"hb".to_vec()); 3], "three pings, one per silent tick");
        assert_eq!(r.heartbeat(later, 120, 3), vec![b]);
        assert_eq!(drain(&mut brx), vec![Out::Close { code: 4003, reason: "no-pong".into(), grace_ms: CLOSE_GRACE_MS }]);
        assert_eq!(r.stats.heartbeat_closed, 1);
        let (c, mut crx) = pair(&mut r, "127.0.0.1:3", ROOM, false);
        let lc = Instant::now() + Duration::from_millis(130);
        r.heartbeat(lc, 120, 3);
        r.on_raw(c, RawFrame { op: 0xA, fin: true, rsv: 0, payload: b"hb".to_vec() });
        r.heartbeat(lc, 120, 3);
        assert_eq!(r.conns[&c].missed, 1, "a pong resets the miss count");
        assert_eq!(drain(&mut crx).len(), 2);
        let (d, mut drx) = pair(&mut r, "127.0.0.1:4", ROOM, false);
        assert_eq!(r.on_raw(d, RawFrame { op: 0x8, fin: true, rsv: 0, payload: vec![0x03, 0xe8] }), None);
        assert_eq!(drain(&mut drx), vec![Out::Close { code: 1000, reason: String::new(), grace_ms: 0 }], "a client close is echoed and the TCP ends at once");
        assert_eq!(r.conns[&d].close_code, Some(1000));
        r.close_all(4000, "host-left", STOP_GRACE_MS);
        assert_eq!(drain(&mut drx), vec![], "a socket already closing gets no second close frame");
        assert_eq!(drain(&mut crx), vec![Out::Close { code: 4000, reason: "host-left".into(), grace_ms: STOP_GRACE_MS }]);
    }

    /* ---- HTTP routing ---- */

    fn head(req: &str) -> Head {
        parse_head(req).expect("parses")
    }

    #[test]
    fn routes_match_the_node_server() {
        assert_eq!(route(&head("GET / HTTP/1.1\r\nHost: x\r\n\r\n")), Route::Guest { head_only: false });
        assert_eq!(route(&head("HEAD /guest.html HTTP/1.1\r\n\r\n")), Route::Guest { head_only: true });
        assert_eq!(route(&head("GET /j/ALPHA-BRAVO-42 HTTP/1.1\r\n\r\n")), Route::Guest { head_only: false });
        assert_eq!(route(&head("GET /j HTTP/1.1\r\n\r\n")), Route::Guest { head_only: false });
        assert_eq!(route(&head("GET /health HTTP/1.1\r\n\r\n")), Route::Health);
        assert_eq!(route(&head("GET /ws HTTP/1.1\r\n\r\n")), Route::UpgradeRequired);
        assert_eq!(route(&head("GET /nope HTTP/1.1\r\n\r\n")), Route::NotFound);
        assert_eq!(route(&head("POST / HTTP/1.1\r\n\r\n")), Route::NotFound);
        let up = "GET /ws?room=alpha-bravo-42&role=peer HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 13\r\n\r\n";
        assert_eq!(route(&head(up)), Route::Upgrade { key: "abc".into(), room: ROOM.into(), role_host: false });
        assert_eq!(route(&head(&up.replace("role=peer", "role=host"))), Route::Upgrade { key: "abc".into(), room: ROOM.into(), role_host: true });
        assert_eq!(route(&head(&up.replace("Version: 13", "Version: 8"))), Route::Refuse { status: 426, text: "Upgrade Required", extra: "Sec-WebSocket-Version: 13\r\n" });
        assert_eq!(route(&head(&up.replace("Sec-WebSocket-Key: abc\r\n", ""))), Route::Refuse { status: 400, text: "Bad Request", extra: "" });
        assert_eq!(route(&head(&up.replace("alpha-bravo-42", "nope"))), Route::Refuse { status: 400, text: "Bad Request", extra: "" });
        assert_eq!(route(&head(&up.replace("/ws?", "/other?"))), Route::Refuse { status: 404, text: "Not Found", extra: "" });
        assert_eq!(route(&head(&up.replace("Upgrade: websocket", "Upgrade: h2c"))), Route::Refuse { status: 400, text: "Bad Request", extra: "" });
        let r = http_response(200, "OK", "text/html; charset=utf-8", "X-Guidon-Fork: guest\r\n", b"<html>", true);
        let s = String::from_utf8(r).unwrap();
        assert!(s.starts_with("HTTP/1.1 200 OK\r\n") && s.contains("Content-Length: 6\r\n") && s.contains("X-Guidon-Fork: guest\r\n") && s.ends_with("\r\n\r\n"));
    }

    /* ---- X10: the self-probe's verdict, both ways ---- */

    #[test]
    fn self_probe_says_false_when_nothing_listens_and_true_when_something_does() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let closed_port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        assert!(!rt.block_on(self_probe("127.0.0.1", closed_port)), "a port nothing listens on is not reachable");
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(rt.block_on(self_probe("127.0.0.1", open.local_addr().unwrap().port())), "a bound port is");
        assert!(!rt.block_on(self_probe("192.0.2.1", 9)), "TEST-NET-1 never answers (the probe times out at {:?})", PROBE_TIMEOUT);
    }

    /* ---- gate + commands on the MockRuntime ---- */

    #[test]
    fn guard_needs_the_setting_the_fork_and_the_window() {
        assert!(guard(true, "tauri", "main").is_ok());
        assert!(guard(false, "tauri", "main").unwrap_err().contains("off"));
        assert!(guard(true, "web", "main").unwrap_err().contains("fork"));
        assert!(guard(true, "tauri", "other").unwrap_err().contains("main"));
        // room_stop: fork + window only - the page turns the setting OFF before it asks to stop
        assert!(guard_stop("tauri", "main").is_ok());
        assert!(guard_stop("web", "main").unwrap_err().contains("fork"));
        assert!(guard_stop("tauri", "other").unwrap_err().contains("main"));
    }

    fn invoke(cmd: &str, body: Value) -> InvokeRequest {
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    #[test]
    fn commands_refuse_without_the_gate_and_run_a_room_on_the_mock_runtime() {
        let app = mock_builder()
            .manage(RoomState::default())
            .invoke_handler(tauri::generate_handler![room_start, room_send, room_stop, room_stats])
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let webview = tauri::WebviewWindowBuilder::new(&app, WINDOW_LABEL, Default::default()).build().expect("mock window");

        let err = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": false, "fork": "tauri" }))).expect_err("setting off must reject");
        assert!(err.to_string().contains("off"), "{err}");
        let err = get_ipc_response(&webview, invoke("room_start", json!({ "port": null, "code": ROOM, "studyGroups": true, "fork": "web" }))).expect_err("fork web must reject");
        assert!(err.to_string().contains("fork"), "{err}");
        let err = get_ipc_response(&webview, invoke("room_send", json!({ "to": null, "frame": {}, "studyGroups": true, "fork": "tauri" }))).expect_err("no room open");
        assert!(err.to_string().contains("no room"), "{err}");

        let closed = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stats").deserialize::<Value>().unwrap();
        assert_eq!(closed["open"], json!(false));
        assert_eq!(closed["keepAwake"], json!(false));

        let info = get_ipc_response(&webview, invoke("room_start", json!({ "port": null, "code": "alpha-bravo-42", "studyGroups": true, "fork": "tauri" })))
            .expect("room_start resolves")
            .deserialize::<RoomInfo>()
            .unwrap();
        assert_eq!(info.room, ROOM);
        assert!(info.port > 0);
        assert_eq!(info.url, format!("http://{}:{}/j/{ROOM}", info.ip, info.port));

        // the listener is real: a Node-style client would see the guest page
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let body = rt.block_on(async {
            let mut s = TcpStream::connect(("127.0.0.1", info.port)).await.expect("connect");
            s.write_all(b"GET /j/ALPHA-BRAVO-42 HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
            let mut out = Vec::new();
            s.read_to_end(&mut out).await.unwrap();
            out
        });
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"), "{}", &text[..text.len().min(80)]);
        assert!(body.ends_with(GUEST_HTML), "the guest page bytes end the response");

        let open = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stats").deserialize::<Value>().unwrap();
        assert_eq!(open["open"], json!(true));
        assert_eq!(open["room"], json!(ROOM));
        assert_eq!(open["seatCap"], json!(schema::SEAT_CAP));
        if cfg!(windows) {
            assert_eq!(open["keepAwake"], json!(true), "X13: SetThreadExecutionState held while the room is open");
        }

        let sent = get_ipc_response(&webview, invoke("room_send", json!({ "to": "NOBODY22", "frame": frame("NODEHOST", "ping", json!({ "n": 1 })), "studyGroups": true, "fork": "tauri" }))).expect("send").deserialize::<Value>().unwrap();
        assert_eq!(sent, json!({ "sent": 0, "dropped": "unknown-to" }));

        // Settings -> Study groups goes OFF first, then the page's settings:change handler calls leave():
        // the stop request therefore carries studyGroups:false and MUST still stop (measured stuck-bound otherwise).
        let stopped = get_ipc_response(&webview, invoke("room_stop", json!({ "studyGroups": false, "fork": "tauri" }))).expect("room_stop works with the setting OFF").deserialize::<Value>().unwrap();
        assert_eq!(stopped, json!({ "stopped": true }));
        let after = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stats").deserialize::<Value>().unwrap();
        assert_eq!(after["open"], json!(false));
        assert_eq!(after["keepAwake"], json!(false));
        std::thread::sleep(Duration::from_millis(150)); // the aborted accept task drops the listener on its next poll
        let refused = rt.block_on(async { tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(("127.0.0.1", info.port))).await });
        assert!(!matches!(refused, Ok(Ok(_))), "the port is closed after room_stop");
        let again = get_ipc_response(&webview, invoke("room_stop", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stop").deserialize::<Value>().unwrap();
        assert_eq!(again, json!({ "stopped": false }));
    }

    /* ---- address advertising (the IPv4 listing) ---- */

    fn addr(name: &str, ip: &str) -> AddressInfo {
        AddressInfo { name: name.to_string(), ip: ip.to_string() }
    }

    #[test]
    fn is_private_v4_covers_all_three_rfc1918_ranges_and_nothing_else() {
        for ip in ["10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.255.254"] {
            assert!(is_private_v4(&ip.parse().unwrap()), "{ip} must be private");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "192.169.0.1", "100.64.0.1"] {
            assert!(!is_private_v4(&ip.parse().unwrap()), "{ip} must NOT be private");
        }
    }

    #[test]
    fn looks_like_vpn_matches_common_virtual_adapter_names_case_insensitively() {
        for n in ["Tailscale", "WireGuard Tunnel", "Cisco AnyConnect VPN", "TAP-Windows Adapter V9", "ZeroTier One [PublicIP]", "Hyper-V Virtual Ethernet Adapter", "VMware Network Adapter", "NordLynx"] {
            assert!(looks_like_vpn(n), "{n:?} must read as a VPN/virtual adapter");
        }
        for n in ["Intel(R) Wi-Fi 6 AX201", "Realtek PCIe GbE Family Controller", "Qualcomm Atheros QCA9377", "Ethernet"] {
            assert!(!looks_like_vpn(n), "{n:?} must NOT read as a VPN/virtual adapter");
        }
    }

    #[test]
    fn choose_advertised_prefers_private_non_vpn_over_a_vpn_looking_private_address() {
        // The exact regression this fixes (2026-09-05 spike): a VPN-looking
        // 10.5.0.2 was advertised over the laptop's real Wi-Fi subnet.
        let candidates = vec![addr("Tailscale", "10.5.0.2"), addr("Intel(R) Wi-Fi 6 AX201", "192.168.1.42")];
        assert_eq!(choose_advertised(&candidates), Some(&candidates[1]));
    }

    #[test]
    fn choose_advertised_over_the_exact_dev_machine_adapter_set() {
        // Reproduces the live machine's real GetAdaptersAddresses order
        // (measured via tools/test-room-tauri.mjs, 2026-09-05): NordLynx
        // enumerates BEFORE Wi-Fi and both are private-range, so without
        // "nordlynx" in the VPN keyword list this ties into tier 0 and the
        // "first seen wins" rule alone would pick the VPN.
        let candidates = vec![
            addr("Tailscale", "100.95.5.26"),
            addr("NordLynx", "10.5.0.2"),
            addr("OpenVPN Data Channel Offload for NordVPN", "169.254.30.224"),
            addr("Wi-Fi", "192.168.1.42"),
            addr("Bluetooth Network Connection", "169.254.203.210"),
        ];
        assert_eq!(choose_advertised(&candidates), Some(&candidates[3]), "Wi-Fi, not NordLynx");
    }

    #[test]
    fn choose_advertised_prefers_any_private_address_over_a_public_one() {
        let candidates = vec![addr("Ethernet", "203.0.113.5"), addr("Wi-Fi", "10.0.0.9")];
        assert_eq!(choose_advertised(&candidates), Some(&candidates[1]));
    }

    #[test]
    fn choose_advertised_prefers_non_vpn_public_over_vpn_public_and_is_stable_on_ties() {
        let candidates = vec![addr("OpenVPN TAP-Windows", "203.0.113.5"), addr("Ethernet", "203.0.113.9")];
        assert_eq!(choose_advertised(&candidates), Some(&candidates[1]));

        let tied = vec![addr("Wi-Fi", "192.168.1.5"), addr("Ethernet", "192.168.1.6")];
        assert_eq!(choose_advertised(&tied), Some(&tied[0]), "first seen wins a tie");
    }

    #[test]
    fn choose_advertised_of_no_candidates_is_none() {
        assert_eq!(choose_advertised(&[]), None);
    }

    // list_ipv4_interfaces()'s GUIDON_ROOM_TEST/GUIDON_ROOM_LAN_IP override is
    // exercised by tools/test-room-tauri.mjs (test 10), which launches a real
    // subprocess with that env - not here, where every #[test] shares one
    // process and mutating global env vars across parallel test threads would
    // be a race rather than a test.

    #[test]
    fn room_info_carries_every_advertisable_address() {
        let info = RoomInfo {
            room: ROOM.into(),
            ip: "192.168.1.42".into(),
            port: 1234,
            url: "http://192.168.1.42:1234/j/ALPHA-BRAVO-42".into(),
            reachable: true,
            addresses: vec![addr("Wi-Fi", "192.168.1.42"), addr("Tailscale", "10.5.0.2")],
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["addresses"], json!([{ "name": "Wi-Fi", "ip": "192.168.1.42" }, { "name": "Tailscale", "ip": "10.5.0.2" }]));
        let back: RoomInfo = serde_json::from_value(v).unwrap();
        assert_eq!(back, info);
    }
}
