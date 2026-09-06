//! GUIDON desktop shell - library face.
//!
//! Mechanical split (room-tls-and-discovery-pitch.md section 3, "the Rust
//! `validate()` differential fuzz test"): src-tauri was a binary-only crate,
//! so a second `[[bin]]` target (src/bin/fuzz_validate.rs) had no way to
//! reach `room::validate()` short of a second copy of the module - exactly
//! the kind of drift room_schema_gen.rs's own header warns against ("never
//! a typed copy"). This file exists ONLY to give the crate a `[lib]` target
//! so a sibling binary can `use guidon::{room, room_schema_gen}` and call the
//! real function. main.rs keeps building the same app it always did; every
//! `room::...` / `room_schema_gen::...` call site there is unchanged, since
//! the path segment is the same either way (`mod room;` vs `use
//! guidon::room` both resolve `room::validate` identically).
//!
//! room_schema_gen.rs's own `#![allow(dead_code)]` is an inner attribute
//! that lives inside that file, not here - it applies regardless of whether
//! the module is reached via `mod` in the binary or `pub mod` here, so
//! nothing needs to be duplicated for it.
//!
//! One consequence of this split that is NOT purely mechanical, recorded
//! here rather than left implicit: room.rs's own `#[cfg(test)]` tests now
//! run via `cargo test --lib` (this crate) instead of riding along inside
//! the "guidon" bin's unittest binary as they did before. One of those
//! tests built a real `tauri::test` mock app and window, and that exact
//! construction crashes any standalone test binary in this package other
//! than the bin's own - see src/room_gate_test.rs's header for the full
//! measurement. That single test moved there (bin-hosted, `mod`-included
//! from main.rs only); every other room.rs test is pure logic with no
//! tauri windowing and is unaffected, still runs, still passes, right here.

pub mod room;
pub mod room_schema_gen;
pub mod room_tls;
