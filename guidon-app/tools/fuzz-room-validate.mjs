#!/usr/bin/env node
/**
 * Differential fuzz test for the room protocol's validate() (room-tls-and-
 * discovery-pitch.md section 3, "the Rust validate() differential fuzz
 * test"). Two independent implementations exist of the SAME wire contract -
 * src/app-modules/room-schema.js's validate() (JavaScript, the ONE protocol
 * home) and src-tauri/src/room.rs's validate() (Rust, generated against
 * room_schema_gen.rs, itself emitted from the JS schema by
 * tools/gen-room-schema-rs.mjs) - and nothing before this tool ever ran the
 * same frame through both and compared verdicts. `cargo test`'s existing 73
 * tests (as of this session) hand-pick specific cases on the Rust side
 * only; this generates many and checks agreement directly.
 *
 * Design:
 *   - Frame generation is a PURE function of (seed, index): calling
 *     generateCase(seed, i) twice always returns byte-identical output, no
 *     hidden state, no Date.now()/Math.random() anywhere in it (a fixed
 *     default seed makes a full run CI-deterministic; `--replay <seed>
 *     <index>` regenerates exactly one case standalone for a human to
 *     inspect or hand to `cargo run --features fuzz-validate --bin
 *     fuzz_validate` directly).
 *   - Two generation strategies, chosen deterministically per case:
 *       (a) "random"  - coarse-grained, varying shape/depth/type JSON, most
 *           of which never gets past validate()'s early object/key checks -
 *           exercises the very first branches on both sides.
 *       (b) "mutate"  - starts from ONE real, valid frame per schema.TYPES
 *           entry (built from the schema's own constants, never a
 *           hand-typed duplicate protocol) and applies 1-3 random
 *           single-field mutations from a fixed catalog (drop/add a key,
 *           flip the version, corrupt the room-code pattern, a non-integer
 *           seq, a malformed fingerprint, a string pushed past a MAX_*
 *           limit, a `grade` key inserted somewhere, a snapshot field gone
 *           bad, ...) - exercises the deep, rule-for-rule logic both
 *           implementations must agree on bit for bit.
 *   - The Rust binary (src-tauri/src/bin/fuzz_validate.rs) is spawned ONCE
 *     and fed every generated frame's wire text over stdin, one per line;
 *     it is a strict one-line-in, one-line-out pipe, so verdicts come back
 *     on stdout in the SAME order the frames were sent - no per-line
 *     request/response round trip is needed, only positional matching.
 *   - Both sides are compared against the SAME wire text: `S.validate()`
 *     runs on `JSON.parse(wireText)`, never on the pre-serialization JS
 *     object, so a value that does not round-trip through JSON the same
 *     way in both languages (there are none by construction here, but this
 *     is the only comparison that is actually meaningful for a WIRE
 *     protocol) can never produce a spurious harness-only mismatch.
 *   - Severities: an accept/reject (`ok`) disagreement is FATAL - a real
 *     cross-implementation protocol-security bug, since one side would let
 *     a peer through the other refuses. Both sides rejecting but with a
 *     different `reason` string is recorded but non-fatal (the wire only
 *     ever exposes the "version" reason to a peer; every other reason is
 *     silent per room-schema.js's own validate() doc comment).
 *
 * Usage:
 *   node tools/fuzz-room-validate.mjs [--count N] [--seed S]
 *   node tools/fuzz-room-validate.mjs --replay <seed> <index>
 *
 * Exit code: number of FATAL mismatches (0 = clean run). Prints a final
 * `{tested, mismatches, seed}` JSON summary line (mismatches = fatal only;
 * non-fatal reason-string mismatches are reported separately above it).
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const SCHEMA_JS = "src/app-modules/room-schema.js";
const DEFAULT_SEED = "guidon-room-validate-fuzz-v1";
const DEFAULT_COUNT = 2000;

for (const f of [SCHEMA_JS]) await import(pathToFileURL(resolve(APP, f)).href);
const S = globalThis.G && globalThis.G.roomSchema;
if (!S) {
  console.error("fuzz-room-validate: G.roomSchema is not defined after loading " + SCHEMA_JS);
  process.exit(2);
}

/* ------------------------------------------------------- deterministic PRNG
   xmur3 (string -> 32-bit seed) + mulberry32 (seed -> () -> [0,1) stream).
   Both are tiny, well-known, dependency-free generators - chosen ONLY for
   determinism and speed, not cryptographic quality (this fuzzes a JSON
   validator, not a cipher). rngFor(seed, index) reseeds from a hash of
   "<seed>:<index>" so every case is a pure function of (seed, index) with
   no draw-order dependency on any other case - #k does not need #0..#k-1
   to have run first, which is exactly what makes --replay exact. */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFor(seed, index) {
  return mulberry32(xmur3(`${seed}:${index}`)());
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_ ";
function randomString(rng, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += CHARS[Math.floor(rng() * CHARS.length)];
  return s;
}
const FP_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // matches FP_RE [A-Z2-7]{8}
function randomFingerprint(rng) {
  let s = "";
  for (let i = 0; i < 8; i++) s += FP_ALPHABET[Math.floor(rng() * FP_ALPHABET.length)];
  return s;
}

/* --------------------------------------------------- strategy (a): random */
function randomScalar(rng) {
  switch (int(rng, 0, 5)) {
    case 0: return null;
    case 1: return rng() < 0.5;
    case 2: return int(rng, -2_000_000, 2_000_000); // ints, incl. out-of-range/negative
    case 3: return Math.round((rng() - 0.5) * 2_000_000_000) / 1000; // finite floats
    case 4: return randomString(rng, int(rng, 0, 40));
    default: return "";
  }
}
const REALISH_KEYS = ["v", "t", "room", "seq", "from", "body", "name", "bankSig", "seatNo", "token",
  "snapshot", "kind", "value", "cardId", "reason", "n", "phase", "mode", "seats", "grade", "pending", "hold"];
function randomKey(rng) {
  return rng() < 0.6 ? pick(rng, REALISH_KEYS) : randomString(rng, int(rng, 1, 10));
}
function randomValue(rng, depth) {
  if (depth >= 4) return randomScalar(rng);
  switch (int(rng, 0, 3)) {
    case 0: {
      const n = int(rng, 0, 3);
      const arr = [];
      for (let i = 0; i < n; i++) arr.push(randomValue(rng, depth + 1));
      return arr;
    }
    case 1: case 2: {
      const n = int(rng, 0, 5);
      const obj = {};
      for (let i = 0; i < n; i++) obj[randomKey(rng)] = randomValue(rng, depth + 1);
      return obj;
    }
    default: return randomScalar(rng);
  }
}
/** A top-level value biased toward object shape (validate()'s first branch
    needs an object to get anywhere past reason "frame"), but still lets
    non-objects through sometimes to exercise that very first branch too. */
function randomFrame(rng) {
  if (rng() < 0.15) return randomValue(rng, 4); // may be scalar/array - "frame"
  const n = int(rng, 0, 8);
  const obj = {};
  for (let i = 0; i < n; i++) obj[randomKey(rng)] = randomValue(rng, 1);
  return obj;
}

/* ------------------------------------------------- strategy (b): mutation
   One minimal valid frame per TYPES entry, built from the schema's OWN
   constants (never a hand-typed second protocol) - the same shape
   tools/test-room-core.mjs's own "(a) a minimal valid frame of every
   allowed type validates" check uses. */
function validSnapshot(rng) {
  return {
    phase: "lobby", mode: "relay", seq: 0, room: S.roomCode(rng), hostSeat: 1,
    cardId: null, cardText: null, turnSeat: null, lock: null, deadline: null, round: null,
    seats: [{ seatNo: 1, name: "HOST", fp: randomFingerprint(rng), score: 0, online: true, ready: true }],
    bankSig: S.bankSig({ board: { version: "1", questions: new Array(10) } }),
  };
}
function baseFrames(rng) {
  const room = S.roomCode(rng);
  const from = randomFingerprint(rng);
  const snap = validSnapshot(rng);
  const bodies = {
    hello: { name: "SGT SNUFFY", bankSig: snap.bankSig },
    admit: { pending: true },
    welcome: { seatNo: 2, token: "abc12345", snapshot: snap },
    snapshot: { snapshot: snap },
    intent: { kind: "score", value: 2, cardId: "bq1" },
    reject: { reason: "nope" },
    kick: { seatNo: 2 },
    ping: { n: 1 }, pong: { n: 1 }, bye: {}, end: { reason: "done" },
  };
  const out = {};
  for (const t of S.TYPES) {
    out[t] = { v: S.PROTOCOL_VERSION, t, room, seq: 0, from, body: bodies[t] };
  }
  return out;
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }

const MAX_FIELD_BY_TYPE = {
  hello: [["name", S.MAX_NAME], ["bankSig", 48], ["resume", S.MAX_TOKEN], ["rank", 8], ["build", S.MAX_BUILD], ["app", S.MAX_APP]],
  welcome: [["token", S.MAX_TOKEN]],
  reject: [["reason", S.MAX_REASON]],
  kick: [["reason", S.MAX_REASON]],
  end: [["reason", S.MAX_REASON]],
  intent: [["cardId", S.MAX_ID]],
};

const MUTATIONS = [
  // drop a random top-level envelope key
  (f, rng) => { const k = pick(rng, S.ENVELOPE_KEYS); delete f[k]; return f; },
  // add an extra, unknown top-level key
  (f, rng) => { f["x_" + randomString(rng, int(rng, 1, 6))] = randomScalar(rng); return f; },
  // flip the protocol version
  (f, rng) => { f.v = rng() < 0.5 ? S.PROTOCOL_VERSION + int(rng, 1, 5) : S.PROTOCOL_VERSION - int(rng, 1, 5); return f; },
  // corrupt the room-code pattern (lowercase, missing dash, bad digit count, unknown NATO word)
  (f, rng) => {
    f.room = pick(rng, [String(f.room).toLowerCase(), "NOTAWORD-ALSONOT-99", "ALPHA-BRAVO-1", "ALPHA_BRAVO_42", "ALPHA-BRAVO"]);
    return f;
  },
  // non-integer / out-of-range seq
  (f, rng) => { f.seq = pick(rng, [1.5, -1, 1e13, "3", null]); return f; },
  // malformed fingerprint (wrong case, wrong length, digits outside 2-7)
  (f, rng) => { f.from = pick(rng, [String(f.from).toLowerCase(), "SHORT", "TOOLONGFINGERPRINT", "AAAAAAA0", "AAAAAAA1", "AAAAAAA9"]); return f; },
  // drop a required body key
  (f, rng) => {
    const req = S.REQUIRED_BODY_KEYS[f.t] || [];
    if (req.length && f.body && typeof f.body === "object") delete f.body[pick(rng, req)];
    return f;
  },
  // add an unknown body key
  (f, rng) => { if (f.body && typeof f.body === "object") f.body["y_" + randomString(rng, int(rng, 1, 6))] = randomScalar(rng); return f; },
  // push a type-appropriate string field past its MAX_* limit
  (f, rng) => {
    const fields = MAX_FIELD_BY_TYPE[f.t];
    if (fields && f.body && typeof f.body === "object") {
      const [key, max] = pick(rng, fields);
      f.body[key] = "X".repeat(max + int(rng, 1, 20));
    }
    return f;
  },
  // insert a `grade` key - never allowed anywhere in the frame
  (f, rng) => {
    if (rng() < 0.5 || !(f.body && typeof f.body === "object")) f.grade = 1;
    else f.body.grade = int(rng, 1, 5);
    return f;
  },
  // replace body with a type-confused value
  (f, rng) => { f.body = pick(rng, [[], "not-an-object", 42, null, true]); return f; },
  // corrupt a snapshot's phase/mode (welcome/snapshot types only - harmless no-op otherwise)
  (f, rng) => {
    if (f.body && f.body.snapshot && typeof f.body.snapshot === "object") {
      if (rng() < 0.5) f.body.snapshot.phase = "not-a-phase";
      else f.body.snapshot.mode = "not-a-mode";
    }
    return f;
  },
  // overflow a snapshot's seats array past MAX_SEATS
  (f, rng) => {
    if (f.body && f.body.snapshot && Array.isArray(f.body.snapshot.seats)) {
      const seat = f.body.snapshot.seats[0] || { seatNo: 1, name: "H", fp: randomFingerprint(rng), score: 0, online: true };
      for (let i = f.body.snapshot.seats.length; i <= S.MAX_SEATS; i++) f.body.snapshot.seats.push({ ...seat, seatNo: i + 1 });
    }
    return f;
  },
  // out-of-range intent score value
  (f, rng) => { if (f.t === "intent") f.body.value = pick(rng, [-1, S.MAX_SCORE + 1, 1e10, 1.5]); return f; },
  // null out a required top-level field
  (f, rng) => { f[pick(rng, ["from", "room", "t"])] = null; return f; },
  // flip a boolean-typed field to a non-boolean
  (f, rng) => {
    if (f.t === "admit") f.body.pending = pick(rng, ["yes", 1, null]);
    else if (f.body && f.body.snapshot && Array.isArray(f.body.snapshot.seats) && f.body.snapshot.seats[0]) f.body.snapshot.seats[0].online = pick(rng, ["yes", 1, null]);
    return f;
  },
];

function mutatedFrame(rng) {
  const bases = baseFrames(rng);
  const t = pick(rng, S.TYPES);
  let frame = clone(bases[t]);
  const n = int(rng, 1, 3);
  const applied = [];
  for (let i = 0; i < n; i++) {
    const idx = int(rng, 0, MUTATIONS.length - 1);
    // Mutations are combined in random order/combinations, so an earlier
    // one (e.g. replacing body with a string) can make a later one's
    // assumptions (e.g. "body is an object") invalid - that is itself
    // valid, interesting fuzz input, not a bug to prevent; skip a mutation
    // that no longer applies rather than guarding every function against
    // every other one's possible prior damage.
    try {
      const next = MUTATIONS[idx](frame, rng);
      if (next !== undefined) frame = next;
      applied.push(idx);
    } catch { /* skip - see above */ }
  }
  return { frame, meta: { baseType: t, mutations: applied } };
}

/* ------------------------------------------------------------ occasional
   genuinely-malformed-JSON-on-the-wire cases (~2%): exercise the ONE path
   that is not "a JS value both sides can agree on" - text that fails to
   even parse. room::validate() (Rust) substitutes Value::Null for these
   (see src-tauri/src/bin/fuzz_validate.rs's own header); the fair JS-side
   comparison is therefore S.validate(null), not S.validate() on the broken
   text (there is no such call - S.validate() only ever takes an
   already-parsed value, by design). */
const MALFORMED_WIRE = [
  "{not valid json", "[1,2,", '{"v":1,"t":"ping"', "undefined", "{'single':'quotes'}", "", "NaN", "{\"a\":}"];

/** generateCase(seed, index) -> { wireText, jsCompareValue, strategy, meta }
    Pure function of (seed, index) - see the header above. */
function generateCase(seed, index) {
  const rng = rngFor(seed, index);
  const roll = rng();
  if (roll < 0.02) {
    const text = pick(rng, MALFORMED_WIRE);
    return { wireText: text, jsCompareValue: null, strategy: "malformed-wire", meta: {} };
  }
  if (roll < 0.52) {
    const frame = randomFrame(rng);
    const wireText = safeStringify(frame);
    return { wireText, jsCompareValue: safeParse(wireText), strategy: "random", meta: {} };
  }
  const { frame, meta } = mutatedFrame(rng);
  const wireText = safeStringify(frame);
  return { wireText, jsCompareValue: safeParse(wireText), strategy: "mutate", meta };
}
function safeStringify(v) {
  const s = JSON.stringify(v);
  return s === undefined ? "null" : s;
}
function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/* --------------------------------------------------------------- Rust IO */
function findRustBinary() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    resolve(APP, `src-tauri/target/release/fuzz_validate${exe}`),
    resolve(APP, `src-tauri/target/debug/fuzz_validate${exe}`),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

async function runBatch(bin, cases) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
    const verdicts = new Array(cases.length);
    let received = 0;
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      let v;
      try { v = JSON.parse(line); } catch (e) { v = { ok: false, reason: "<unparseable-rust-output:" + line + ">" }; }
      verdicts[received] = v;
      received++;
      if (received === cases.length) {
        rl.close();
        child.stdin.end();
        resolvePromise(verdicts);
      }
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (received < cases.length) {
        reject(new Error(`fuzz_validate exited early (code=${code} signal=${signal}) after ${received}/${cases.length} verdicts`));
      }
    });

    // Write every frame's wire text, one per line, with backpressure handling.
    let i = 0;
    function writeMore() {
      while (i < cases.length) {
        const ok = child.stdin.write(cases[i].wireText.replace(/\r?\n/g, " ") + "\n");
        i++;
        if (!ok) { child.stdin.once("drain", writeMore); return; }
      }
    }
    writeMore();
  });
}

/* --------------------------------------------------------------- replay */
async function replay(seed, index) {
  const c = generateCase(seed, index);
  console.log(JSON.stringify({ seed, index, strategy: c.strategy, meta: c.meta, wireText: c.wireText }, null, 2));
  const jsVerdict = S.validate(c.jsCompareValue);
  console.log("js verdict:  " + JSON.stringify(jsVerdict));
  const bin = findRustBinary();
  if (!bin) {
    console.error("(no fuzz_validate binary found under src-tauri/target/{debug,release} - build it first: `cargo build --features fuzz-validate --bin fuzz_validate` from src-tauri/)");
    process.exit(2);
  }
  const [verdict] = await runBatch(bin, [c]);
  console.log("rust verdict:" + JSON.stringify(verdict));
  const fatal = jsVerdict.ok !== !!verdict.ok;
  const reasonDiff = !fatal && jsVerdict.ok === false && jsVerdict.reason !== verdict.reason;
  console.log(fatal ? "MISMATCH (fatal: ok/reject disagree)" : reasonDiff ? "reason differs (non-fatal)" : "MATCH");
  process.exit(fatal ? 1 : 0);
}

/* ------------------------------------------------------------------ main */
function parseArgs(argv) {
  const out = { seed: DEFAULT_SEED, count: DEFAULT_COUNT, replay: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") out.seed = argv[++i];
    else if (a === "--count") out.count = parseInt(argv[++i], 10);
    else if (a === "--replay") { out.replay = [argv[++i], parseInt(argv[++i], 10)]; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.replay) return replay(args.replay[0], args.replay[1]);

  const bin = findRustBinary();
  if (!bin) {
    console.error("fuzz-room-validate: no fuzz_validate binary found under src-tauri/target/{debug,release}/.");
    console.error("Build it first: cd src-tauri && cargo build --features fuzz-validate --bin fuzz_validate");
    process.exit(2);
  }
  console.log(`fuzz-room-validate: seed=${JSON.stringify(args.seed)} count=${args.count} binary=${bin}`);

  const cases = [];
  for (let i = 0; i < args.count; i++) cases.push(generateCase(args.seed, i));

  const verdicts = await runBatch(bin, cases);

  let mismatches = 0;
  const fatalDetails = [];
  let reasonMismatches = 0;
  const reasonDetails = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const jsVerdict = S.validate(c.jsCompareValue);
    const rustVerdict = verdicts[i] || { ok: false, reason: "<missing>" };
    const jsOk = !!jsVerdict.ok;
    const rustOk = !!rustVerdict.ok;
    if (jsOk !== rustOk) {
      mismatches++;
      fatalDetails.push({ index: i, strategy: c.strategy, meta: c.meta, wireText: c.wireText, js: jsVerdict, rust: rustVerdict });
    } else if (!jsOk && jsVerdict.reason !== rustVerdict.reason) {
      reasonMismatches++;
      reasonDetails.push({ index: i, strategy: c.strategy, meta: c.meta, wireText: c.wireText, js: jsVerdict, rust: rustVerdict });
    }
  }

  if (fatalDetails.length) {
    console.log(`\n=== FATAL mismatches (ok/reject disagreement): ${fatalDetails.length} ===`);
    for (const d of fatalDetails) console.log(JSON.stringify(d));
  }
  if (reasonDetails.length) {
    console.log(`\n=== non-fatal reason-string mismatches (both reject, different reason): ${reasonDetails.length} ===`);
    for (const d of reasonDetails) console.log(JSON.stringify(d));
  }

  const summary = { tested: cases.length, mismatches, seed: args.seed };
  console.log("\n" + JSON.stringify(summary));
  process.exit(mismatches > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("fuzz-room-validate: " + (e && e.stack || e));
  process.exit(2);
});
