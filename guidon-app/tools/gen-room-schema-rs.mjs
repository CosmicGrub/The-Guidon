#!/usr/bin/env node
/**
 * Room schema -> Rust (collective P4, R-ROOM, standing rule 4): the Rust
 * host (src-tauri/src/room.rs) validates every frame against the SAME
 * protocol the page, the guest page and the Node reference server use -
 * src/app-modules/room-schema.js - and that file is JavaScript. There is
 * no hand-typed copy of the allowlist in Rust: this tool IMPORTS the
 * schema module the way tools/room-server.mjs does, reads G.roomSchema
 * (plus G.studyGroup.HOTSPOT_CAP, the seat cap the host screen names) and
 * emits src-tauri/src/room_schema_gen.rs as Rust constants. The emitted
 * file is deterministic (same input, same bytes), LF-only and ASCII.
 *
 *   node tools/gen-room-schema-rs.mjs            write the .rs (npm run room:gen-rs)
 *   node tools/gen-room-schema-rs.mjs --check    exit 1 when the .rs on disk is stale
 *   node tools/gen-room-schema-rs.mjs --stdout   print the generation, write nothing
 *
 * Two verifiers keep it fresh: `npm run lint:patterns` runs --check, and
 * `cargo test` (room::tests::generated_schema_is_fresh) regenerates through
 * this tool and compares byte for byte, so a schema edit that forgot the
 * regeneration is a red test on both sides.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const SCHEMA_JS = "src/app-modules/room-schema.js";
const ROOM_JS = "src/app-modules/studygroup.js";
const OUT = resolve(APP, "src-tauri/src/room_schema_gen.rs");

for (const f of [SCHEMA_JS, ROOM_JS]) await import(pathToFileURL(resolve(APP, f)).href);
const S = globalThis.G.roomSchema;
const SG = globalThis.G.studyGroup;

function rsStr(s) {
  s = String(s);
  if (!/^[\x20-\x7e]*$/.test(s)) throw new Error("gen-room-schema-rs: non-printable-ASCII string in the schema: " + JSON.stringify(s));
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function rsStrList(name, list) {
  if (!Array.isArray(list)) throw new Error("gen-room-schema-rs: " + name + " is not an array");
  return "pub const " + name + ": &[&str] = &[" + list.map(rsStr).join(", ") + "];";
}
function rsKeyed(name, obj) {
  if (!obj || typeof obj !== "object") throw new Error("gen-room-schema-rs: " + name + " is not an object");
  const rows = Object.keys(obj).map((k) => "    (" + rsStr(k) + ", &[" + obj[k].map(rsStr).join(", ") + "]),");
  return "pub const " + name + ": &[(&str, &[&str])] = &[\n" + rows.join("\n") + "\n];";
}
function rsInt(name, ty, v) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error("gen-room-schema-rs: " + name + " is not a non-negative integer: " + v);
  return "pub const " + name + ": " + ty + " = " + v + ";";
}

export function generate() {
  const lines = [
    "//! GENERATED FILE - do not edit. Produced by tools/gen-room-schema-rs.mjs",
    "//! from " + SCHEMA_JS + " (G.roomSchema) and " + ROOM_JS + " (G.studyGroup.HOTSPOT_CAP).",
    "//! Regenerate: `npm run room:gen-rs` (guidon-app/). Stale copies fail",
    "//! `npm run lint:patterns` (--check) and `cargo test` (room::tests::generated_schema_is_fresh).",
    "//! The room protocol has ONE home, the JavaScript module above; this is its Rust shadow.",
    "#![allow(dead_code)]",
    "",
    "/// The source this file was generated from, relative to guidon-app/.",
    "pub const SOURCE: &str = " + rsStr(SCHEMA_JS) + ";",
    rsInt("PROTOCOL_VERSION", "u64", S.PROTOCOL_VERSION),
    rsStrList("TYPES", S.TYPES),
    rsStrList("INTENT_KINDS", S.INTENT_KINDS),
    rsStrList("ENVELOPE_KEYS", S.ENVELOPE_KEYS),
    rsKeyed("BODY_KEYS", S.BODY_KEYS),
    rsKeyed("REQUIRED_BODY_KEYS", S.REQUIRED_BODY_KEYS),
    rsStrList("SNAPSHOT_KEYS", S.SNAPSHOT_KEYS),
    rsStrList("SEAT_KEYS", S.SEAT_KEYS),
    rsStrList("PHASES", S.PHASES),
    rsStrList("MODES", S.MODES),
    rsInt("MAX_FRAME_BYTES", "usize", S.MAX_FRAME_BYTES),
    rsInt("MAX_WIRE_BYTES", "usize", S.MAX_WIRE_BYTES),
    rsInt("MAX_NAME", "usize", S.MAX_NAME),
    rsInt("MAX_SEATS", "usize", S.MAX_SEATS),
    rsInt("MAX_SCORE", "u64", S.MAX_SCORE),
    rsInt("MAX_TOKEN", "usize", S.MAX_TOKEN),
    rsInt("MAX_REASON", "usize", S.MAX_REASON),
    rsInt("MAX_TEXT", "usize", S.MAX_TEXT),
    rsInt("MAX_ID", "usize", S.MAX_ID),
    rsInt("MAX_BUILD", "usize", S.MAX_BUILD),
    rsInt("MAX_APP", "usize", S.MAX_APP),
    "pub const ENDPOINT_WS: &str = " + rsStr(S.ENDPOINTS.ws) + ";",
    "pub const ENDPOINT_JOIN: &str = " + rsStr(S.ENDPOINTS.join) + ";",
    "pub const ENDPOINT_GUEST: &str = " + rsStr(S.ENDPOINTS.guest) + ";",
    "pub const VERSION_MISMATCH_TEXT: &str = " + rsStr(S.VERSION_MISMATCH_TEXT) + ";",
    rsStrList("NATO", S.NATO),
    "/// G.studyGroup.HOTSPOT_CAP: the listener refuses a 9th bound peer socket (4004).",
    rsInt("SEAT_CAP", "usize", SG.HOTSPOT_CAP),
    "",
  ];
  const text = lines.join("\n");
  if (!/^[\x00-\x7f]*$/.test(text)) throw new Error("gen-room-schema-rs: generated text is not ASCII");
  if (text.includes("\r")) throw new Error("gen-room-schema-rs: generated text contains CR");
  return text;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const text = generate();
  const rel = "src-tauri/src/room_schema_gen.rs";
  if (process.argv.includes("--stdout")) {
    process.stdout.write(text);
  } else if (process.argv.includes("--check")) {
    const disk = await readFile(OUT, "utf8").catch(() => null);
    if (disk === text) { console.log("  PASS  " + rel + " is a fresh generation of " + SCHEMA_JS + " (" + text.length + " bytes)"); }
    else { console.log("  FAIL  " + rel + " is " + (disk == null ? "missing" : "STALE") + " - run: npm run room:gen-rs"); console.log("\nGEN-ROOM-SCHEMA-RS: 1 FAILURE(S)"); process.exit(1); }
    console.log("\nGEN-ROOM-SCHEMA-RS: all passed");
  } else {
    const disk = await readFile(OUT, "utf8").catch(() => null);
    await writeFile(OUT, text, "utf8");
    console.log("gen-room-schema-rs: " + (disk === text ? "unchanged" : "wrote") + " " + rel + " (" + text.length + " bytes) from " + SCHEMA_JS);
  }
}
