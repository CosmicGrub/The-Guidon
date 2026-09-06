//! GENERATED FILE - do not edit. Produced by tools/gen-room-schema-rs.mjs
//! from src/app-modules/room-schema.js (G.roomSchema) and src/app-modules/studygroup.js (G.studyGroup.HOTSPOT_CAP).
//! Regenerate: `npm run room:gen-rs` (guidon-app/). Stale copies fail
//! `npm run lint:patterns` (--check) and `cargo test` (room::tests::generated_schema_is_fresh).
//! The room protocol has ONE home, the JavaScript module above; this is its Rust shadow.
#![allow(dead_code)]

/// The source this file was generated from, relative to guidon-app/.
pub const SOURCE: &str = "src/app-modules/room-schema.js";
pub const PROTOCOL_VERSION: u64 = 1;
pub const TYPES: &[&str] = &["hello", "admit", "welcome", "snapshot", "intent", "reject", "kick", "ping", "pong", "bye", "end"];
pub const INTENT_KINDS: &[&str] = &["ready", "buzz", "score", "answer", "advance-request"];
pub const ENVELOPE_KEYS: &[&str] = &["v", "t", "room", "seq", "from", "body"];
pub const BODY_KEYS: &[(&str, &[&str])] = &[
    ("hello", &["name", "bankSig", "resume", "rank", "build", "app"]),
    ("admit", &["pending", "atBoundary"]),
    ("welcome", &["seatNo", "token", "snapshot", "hold"]),
    ("snapshot", &["snapshot"]),
    ("intent", &["kind", "value", "cardId"]),
    ("reject", &["reason"]),
    ("kick", &["seatNo", "reason"]),
    ("ping", &["n"]),
    ("pong", &["n"]),
    ("bye", &[]),
    ("end", &["reason"]),
];
pub const REQUIRED_BODY_KEYS: &[(&str, &[&str])] = &[
    ("hello", &["name", "bankSig"]),
    ("admit", &["pending"]),
    ("welcome", &["seatNo", "token", "snapshot"]),
    ("snapshot", &["snapshot"]),
    ("intent", &["kind"]),
    ("reject", &["reason"]),
    ("kick", &["seatNo"]),
    ("ping", &["n"]),
    ("pong", &["n"]),
    ("bye", &[]),
    ("end", &[]),
];
pub const SNAPSHOT_KEYS: &[&str] = &["phase", "mode", "seq", "room", "hostSeat", "cardId", "cardText", "turnSeat", "lock", "deadline", "round", "seats", "bankSig", "deck"];
pub const SEAT_KEYS: &[&str] = &["seatNo", "name", "fp", "score", "online", "ready", "done"];
pub const PHASES: &[&str] = &["lobby", "play", "recap", "ended"];
pub const MODES: &[&str] = &["relay", "board"];
pub const MAX_FRAME_BYTES: usize = 4096;
pub const MAX_WIRE_BYTES: usize = 4160;
pub const MAX_NAME: usize = 24;
pub const MAX_SEATS: usize = 20;
pub const MAX_SCORE: u64 = 999;
pub const MAX_TOKEN: usize = 48;
pub const MAX_REASON: usize = 160;
pub const MAX_TEXT: usize = 1500;
pub const MAX_ID: usize = 40;
pub const MAX_BUILD: usize = 40;
pub const MAX_APP: usize = 24;
pub const ENDPOINT_WS: &str = "/ws";
pub const ENDPOINT_JOIN: &str = "/j/";
pub const ENDPOINT_GUEST: &str = "/";
pub const VERSION_MISMATCH_TEXT: &str = "update GUIDON on one device";
pub const NATO: &[&str] = &["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL", "INDIA", "JULIET", "KILO", "LIMA", "MIKE", "NOVEMBER", "OSCAR", "PAPA", "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM", "VICTOR", "WHISKEY", "XRAY", "YANKEE", "ZULU"];
/// G.studyGroup.HOTSPOT_CAP: the listener refuses a 9th bound peer socket (4004).
pub const SEAT_CAP: usize = 8;
