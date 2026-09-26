/**
 * Study Rooms hand-off model, pure node: the wire rules, the room core and the
 * REAL relay server, with no browser.
 *
 * WHY THIS SUITE EXISTS: AUDIT-2026-09 6M asked for "one hand-off model
 * instead of three": a Study Room that can carry a study deck, a PT plan and a
 * Team Training session through ONE versioned payload
 * ({ oid, kind, ver, title?, data }, src/app-modules/room-schema.js "THE
 * HAND-OFF MODEL"). What would ship broken, and go unnoticed, if this file were
 * deleted: a payload that leaks a name, a rank, progress or a note onto the
 * wire; an oversize or forged offer that a device accepts; a newer kind that
 * crashes an older build instead of being refused in plain words; or the
 * study deck quietly behaving differently after being moved onto the model.
 * tools/test-room-handoff.mjs proves the same things end to end through the
 * real screens in two browser contexts; this file proves the rules themselves
 * exhaustively and cheaply.
 *
 *  (1)  the model: the three kinds, their versions and carriers; the additive
 *       "offer" frame type (PROTOCOL_VERSION stays 1)
 *  (2)  make(): every kind builds; unknown kinds, the deck kind (it travels in
 *       the snapshot, never as an offer), extra keys, personal keys, bad
 *       shapes are refused with a plain message
 *  (3)  the wire rules every hop applies (JS here; the Rust host and the
 *       differential fuzz hold the other side): closed envelope, shaped
 *       fields, nesting cap, byte cap that leaves the whole frame under the
 *       frame cap - exactly at the boundary
 *  (4)  personal keys: every forbidden name, at any depth, in any case - and
 *       in other spellings (spacing, punctuation, zero-width, full-width,
 *       look-alike letters), which the wire rules also refuse
 *  (5)  classify(): unknown kind and newer version are held as notes (never
 *       applied, data dropped); invalid kind-specific data is refused
 *  (6)  sanitize()/receive(): control, direction, Arabic-letter-mark and tag
 *       characters cleaned, every string - and every changed date together with
 *       its name - screened, no screen = refused (fail closed)
 *  (7)  the deck, migrated onto the model with UNCHANGED behaviour: snapshots
 *       and welcome frames are byte-identical to what the pre-model build
 *       produced (golden strings captured from that build), and the deck field
 *       gives the same rejection reasons it always gave
 *  (8)  the room core: host offers, seated peers hold, a late seat gets the
 *       share behind its welcome, a seat that was offline when the host shared
 *       gets it (once) when it resumes, a resend is a new offer, a peer cannot
 *       offer, a forged frame is noted and applies nothing, the browser guest
 *       page keeps only {oid, kind, ver}
 *  (9)  the real relay (Node server + Node host and peers over WebSockets):
 *       the offer reaches every seated peer byte for byte, nothing personal
 *       is on the wire, hostile frames are dropped at the relay and counted,
 *       an unknown kind passes through a relay that has never heard of it, an
 *       offline seat that reconnects with its resume token is sent the offer
 *
 * Every wait is a bounded poll on a real condition. Usage:
 *   node tools/test-room-handoff-core.mjs   (exit code = FAIL count)
 */
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { ok, bad, check, finish } from "./testkit.mjs";
import { startRoomServer } from "./room-server.mjs";
import { nodeHost, nodePeer } from "./room-node-host.mjs";

for (const f of ["src/app-modules/room-schema.js", "src/app-modules/studygroup.js"]) await import(pathToFileURL(resolve(f)).href);
const S = globalThis.G.roomSchema;
const sg = globalThis.G.studyGroup;
const H = S.handoff;
const ROOM = "ALPHA-BRAVO-42";
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
const WATCHDOG_MS = 120000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM HANDOFF CORE: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();
/* A bounded poll on a real condition (there is no page here for testkit's
   until() to run in). */
async function pollUntil(pred, limit = 8000, step = 20) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await pred(); } catch (e) { v = null; }
    if (v) return { hit: true, value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 >= limit) return { hit: false, value: v, ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, step));
  }
}
/* mulberry32: a seeded stream, so seat tokens and offer ids are reproducible
   and (unlike a fixed string) different on every draw. */
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function tokenStream(seed) {
  const rnd = mulberry32(seed);
  return () => { let s = ""; for (let i = 0; i < 15; i++) s += B32[Math.floor(rnd() * 32)]; return s; };
}

/* ---- payload builders (the shapes the model documents) ---- */
const dayEntry = (id) => ({ id });
const ptData = () => ({
  tpl: "balanced",
  days: [dayEntry("rest"), dayEntry("strength"), { id: "session", ref: "s1" }, dayEntry("endurance"), dayEntry("prep"), { id: "custom", label: "Ruck", effort: "hard" }, dayEntry("recovery")],
  sessions: [{ key: "s1", label: "Circuit night", effort: "hard", type: "session", blocks: ["cd1", "cd2", "gd"] }],
  dates: [{ date: "2026-10-02", entry: { id: "session", ref: "s1" } }],
});
const teamData = () => ({ steps: ["contact-relay", "aar-huddle", "casualty-chain"] });
const offerOf = (kind, data, title, extra) => Object.assign({ oid: "ABCD2345", kind, ver: 1, data }, title ? { title } : {}, extra || {});
const frameOf = (offer, over) => Object.assign({ v: S.PROTOCOL_VERSION, t: "offer", room: ROOM, seq: 3, from: "HOSTHOST", body: { offer } }, over || {});
const RLO = String.fromCharCode(8238), NUL = String.fromCharCode(0), ZWSP = String.fromCharCode(8203), E_ACUTE = String.fromCharCode(233);
const clone = (x) => JSON.parse(JSON.stringify(x));
const reasonOf = (offer) => S.validate(frameOf(offer)).reason;
/* Stands in for G.opsecGuard.screen (a browser module): flags a phone-number
   shape and a classification-marking shape, which is all these cases need. */
const fakeScreen = (text) => ({ findings: /\d{3}[- .]\d{3}[- .]\d{4}/.test(text) || /\/\/[A-Z]/.test(text) ? [{ code: "x", looksLike: "a phone number" }] : [] });

/* ================================================================== (1) */
console.log("(1) the model");
{
  check(S.TYPES.indexOf("offer") !== -1 && S.PROTOCOL_VERSION === 1, "\"offer\" is a frame type and PROTOCOL_VERSION is still 1 (the type is additive)", () => "TYPES=" + S.TYPES.join(",") + " v=" + S.PROTOCOL_VERSION);
  const k = H.KINDS;
  check(Object.keys(k).sort().join(",") === "deck,pt-plan,team-session", "exactly three kinds: " + Object.keys(k).join(", "), () => JSON.stringify(k));
  check(k["deck"].carrier === "snapshot" && k["pt-plan"].carrier === "offer" && k["team-session"].carrier === "offer", "the deck rides the snapshot; a PT plan and a Team Training session ride offers", () => JSON.stringify(k));
  check(Object.values(k).every((x) => x.ver === 1), "every kind is at ver 1", () => JSON.stringify(k));
  check(S.BODY_KEYS.offer.join() === "offer" && S.REQUIRED_BODY_KEYS.offer.join() === "offer", "the offer body is one closed key: offer", () => JSON.stringify(S.BODY_KEYS.offer));
  check(H.MAX_BYTES < S.MAX_FRAME_BYTES - 512, "the payload cap (" + H.MAX_BYTES + ") leaves well over 500 bytes of the " + S.MAX_FRAME_BYTES + "-byte frame for the envelope", () => H.MAX_BYTES + " vs " + S.MAX_FRAME_BYTES);
  check(H.labelOf("pt-plan") === "a PT plan" && H.labelOf("team-session") === "a Team Training session" && /can't open/.test(H.labelOf("deck")) && /can't open/.test(H.labelOf("__proto__")), "labelOf() names a known kind and says so plainly for anything else (a deck is not an offer; __proto__ is nothing)", () => H.labelOf("deck"));
  const minimal = S.validate(frameOf(offerOf("team-session", teamData())));
  check(minimal.ok, "a minimal offer frame validates", () => minimal.reason);
  // What an OLDER build (no "offer" in its TYPES) does with a type it has not heard of - the rule this additive frame relies on.
  const unknownType = S.validate(Object.assign(frameOf(offerOf("team-session", teamData())), { t: "offer-from-the-future" }));
  check(!unknownType.ok && unknownType.reason === "type", "a frame type a build does not know is refused as \"type\" (an older build ignores an offer exactly this way)", () => JSON.stringify(unknownType));
}

/* ================================================================== (2) */
console.log("\n(2) make(): the sending side's one door");
{
  for (const [kind, data] of [["pt-plan", ptData()], ["team-session", teamData()]]) {
    const m = H.make(kind, "Squad  night\n", data);
    check(m.ok && m.offer.kind === kind && m.offer.ver === 1 && m.offer.title === "Squad night" && !("oid" in m.offer), kind + ": builds an offer (no oid - the host mints it), title cleaned to \"Squad night\"", () => JSON.stringify(m));
    const withOid = Object.assign({ oid: "ABCD2345" }, m.offer);
    check(S.validate(frameOf(withOid)).ok && H.classify(withOid).status === "ok", kind + ": what make() builds passes the wire rules and classifies ok", () => JSON.stringify(H.classify(withOid)));
  }
  const cases = [
    ["a deck (it travels in the snapshot, not as an offer)", () => H.make("deck", null, { category: "Creeds", timerSec: 60 }), "kind", /can't share/],
    ["an unknown kind", () => H.make("quiz-pack", null, { x: 1 }), "kind", /can't share/],
    ["a constructor-shaped kind", () => H.make("constructor", null, {}), "kind", /can't share/],
    ["a PT plan with an extra key", () => H.make("pt-plan", null, Object.assign(ptData(), { extra: 1 })), "pt-plan-key:extra", /couldn't put that together/],
    ["a PT plan with six days", () => H.make("pt-plan", null, Object.assign(ptData(), { days: ptData().days.slice(0, 6) })), "pt-plan-days", /couldn't put that together/],
    ["a PT plan day pointing at a session that is not in the payload", () => { const d = ptData(); d.days[2] = { id: "session", ref: "nope" }; return H.make("pt-plan", null, d); }, "pt-plan-day-entry-ref", /couldn't put that together/],
    ["a PT plan day with a label on a built-in session type", () => { const d = ptData(); d.days[1] = { id: "strength", label: "x" }; return H.make("pt-plan", null, d); }, "pt-plan-day-entry-key:label", /couldn't put that together/],
    ["an ad hoc PT day with no effort", () => { const d = ptData(); d.days[5] = { id: "custom", label: "Ruck" }; return H.make("pt-plan", null, d); }, "pt-plan-day-entry-effort", /couldn't put that together/],
    ["a session with an unknown effort", () => { const d = ptData(); d.sessions[0].effort = "extreme"; return H.make("pt-plan", null, d); }, "pt-plan-session-effort", /couldn't put that together/],
    ["a session with more blocks than a room carries", () => { const d = ptData(); d.sessions[0].blocks = Array.from({ length: H.LIMITS.ptBlocks + 1 }, (_, i) => "d" + i); return H.make("pt-plan", null, d); }, "pt-plan-session-blocks", /couldn't put that together/],
    ["a session with a block id that is not an id", () => { const d = ptData(); d.sessions[0].blocks = ["has a space"]; return H.make("pt-plan", null, d); }, "pt-plan-session-block", /couldn't put that together/],
    ["more dated changes than a room carries", () => { const d = ptData(); d.dates = Array.from({ length: H.LIMITS.ptDates + 1 }, (_, i) => ({ date: "2026-10-0" + (i % 9 + 1), entry: dayEntry("rest") })); return H.make("pt-plan", null, d); }, "pt-plan-dates", /couldn't put that together/],
    ["a dated change with a malformed date", () => { const d = ptData(); d.dates[0].date = "next Tuesday"; return H.make("pt-plan", null, d); }, "pt-plan-date-day", /couldn't put that together/],
    ["a session with no steps", () => H.make("team-session", null, { steps: [] }), "team-session-steps", /couldn't put that together/],
    ["a session with too many steps", () => H.make("team-session", null, { steps: Array.from({ length: H.LIMITS.teamSteps + 1 }, () => "aar-huddle") }), "team-session-steps", /couldn't put that together/],
    ["a session step that is not an id", () => H.make("team-session", null, { steps: ["Contact Report Relay"] }), "team-session-step", /couldn't put that together/],
    ["a personal key inside a PT plan", () => H.make("pt-plan", null, Object.assign(ptData(), { notes: "x" })), "offer-personal", /personal detail/],
    ["a personal key inside a Team session", () => H.make("team-session", null, { steps: ["aar-huddle"], rank: "SSG" }), "offer-personal", /personal detail/],
  ];
  for (const [what, run, reason, message] of cases) {
    const m = run();
    check(!m.ok && m.reason === reason && message.test(m.message || ""), "refused: " + what + " -> " + reason + " (\"" + String(m.message).slice(0, 44) + "...\")", () => JSON.stringify(m));
  }
}

/* ================================================================== (3) */
console.log("\n(3) the wire rules every hop applies");
{
  const good = () => offerOf("team-session", teamData(), "Squad night");
  const tweak = (k, v) => { const o = good(); o[k] = v; return o; };
  const table = [
    ["oid in lower case", tweak("oid", "abcd2345"), "offer-oid"],
    ["oid too short", tweak("oid", "ABC"), "offer-oid"],
    ["oid too long", tweak("oid", "ABCD2345ABCD2"), "offer-oid"],
    ["oid with a digit outside 2-7", tweak("oid", "ABCD2341"), "offer-oid"],
    ["kind in capitals", tweak("kind", "PT-plan"), "offer-kind"],
    ["kind of one letter", tweak("kind", "x"), "offer-kind"],
    ["kind starting with a digit", tweak("kind", "9plan"), "offer-kind"],
    ["kind past 24 characters", tweak("kind", "a".repeat(25)), "offer-kind"],
    ["ver 0", tweak("ver", 0), "offer-ver"],
    ["ver 100", tweak("ver", 100), "offer-ver"],
    ["ver as text", tweak("ver", "1"), "offer-ver"],
    ["ver with a fraction", tweak("ver", 1.5), "offer-ver"],
    ["title of 41 characters", tweak("title", "T".repeat(41)), "offer-title"],
    ["title as a number", tweak("title", 5), "offer-title"],
    ["data as an array", tweak("data", [1]), "offer-data"],
    ["data as text", tweak("data", "x"), "offer-data"],
    ["an extra envelope key", tweak("extra", 1), "offer-key:extra"],
    ["a missing data", (() => { const o = good(); delete o.data; return o; })(), "offer-missing:data"],
    ["a missing oid", (() => { const o = good(); delete o.oid; return o; })(), "offer-missing:oid"],
  ];
  for (const [what, offer, reason] of table) {
    const r = reasonOf(offer);
    check(r === reason, "rejected: " + what + " -> " + reason, () => "got " + JSON.stringify(r));
  }
  check(reasonOf("nope") === "offer" && S.validate(Object.assign(frameOf(good()), { body: {} })).reason === "body-missing:offer" && S.validate(Object.assign(frameOf(good()), { body: { offer: good(), x: 1 } })).reason === "body-key:x",
    "rejected: an offer that is not an object, a body with no offer, a body with a second key");
  check(S.validate(frameOf(good(), { extra: 1 })).reason === "extra:extra" && S.validate(frameOf(good(), { v: 2 })).reason === "version", "the envelope rules are unchanged around it: an extra envelope key and a wrong version are still refused");
  // Nesting: the offer object is depth 1.
  const nest = (d) => { const o = good(); let x = o.data; for (let i = 0; i < d; i++) { x.z = {}; x = x.z; } return o; };
  check(S.validate(frameOf(nest(H.MAX_DEPTH - 2))).ok, "an offer nested up to the cap validates (data is depth 2, so " + (H.MAX_DEPTH - 2) + " more levels)");
  check(reasonOf(nest(H.MAX_DEPTH - 1)) === "offer-depth", "one level past the nesting cap is refused as \"offer-depth\"", () => JSON.stringify(reasonOf(nest(H.MAX_DEPTH - 1))));
  // Bytes: exactly at the cap, then one over - and the WHOLE frame still fits.
  const padTo = (n) => {
    const o = offerOf("quiz-pack", { pad: "" });
    o.data.pad = "P".repeat(Math.max(0, n - bytes(o)));
    return o;
  };
  const atCap = padTo(H.MAX_BYTES), over = padTo(H.MAX_BYTES + 1);
  check(bytes(atCap) === H.MAX_BYTES && S.validate(frameOf(atCap)).ok, "an offer of exactly " + H.MAX_BYTES + " bytes validates", () => bytes(atCap) + " " + reasonOf(atCap));
  check(bytes(over) === H.MAX_BYTES + 1 && reasonOf(over) === "offer-size", "one byte over is refused as \"offer-size\"", () => bytes(over) + " " + reasonOf(over));
  check(bytes(frameOf(atCap)) < S.MAX_FRAME_BYTES, "the largest legal offer still leaves the whole frame under " + S.MAX_FRAME_BYTES + " bytes (" + bytes(frameOf(atCap)) + ")", () => String(bytes(frameOf(atCap))));
  const wide = frameOf(offerOf("quiz-pack", { pad: E_ACUTE.repeat(1600) }));
  check(S.validate(wide).reason === "offer-size", "size is counted in UTF-8 BYTES, not characters (1,600 two-byte letters are refused)", () => JSON.stringify(S.validate(wide)));
  // The largest REAL payload a Soldier can build: a full plan with the most sessions and blocks a room carries.
  const big = ptData();
  big.sessions = Array.from({ length: H.LIMITS.ptSessions }, (_, i) => ({ key: "s" + (i + 1), label: "Session number " + (i + 1) + " with a real name", effort: "moderate", type: "session", blocks: Array.from({ length: H.LIMITS.ptBlocks }, (_, j) => "drill" + j) }));
  big.days = big.days.map((d) => d.id === "session" ? { id: "session", ref: "s2" } : d);
  big.dates = Array.from({ length: H.LIMITS.ptDates }, (_, i) => ({ date: "2026-10-0" + (i + 1), entry: { id: "session", ref: "s" + (i % H.LIMITS.ptSessions + 1) } }));
  const bigMade = H.make("pt-plan", "A full weekly plan", big);
  check(bigMade.ok && bytes(frameOf(Object.assign({ oid: "ABCD2345" }, bigMade.offer))) < S.MAX_FRAME_BYTES, "a full weekly plan (every session, every block, every dated change a room allows) still fits one frame (" + (bigMade.ok ? bytes(frameOf(Object.assign({ oid: "ABCD2345" }, bigMade.offer))) : "?") + " bytes)", () => JSON.stringify(bigMade).slice(0, 200));
}

/* ================================================================== (4) */
console.log("\n(4) personal keys, everywhere");
{
  const asked = ["profile", "rank", "name", "mos", "progress", "attempts", "notes", "results"];
  check(asked.every((k) => H.FORBIDDEN_KEYS.indexOf(k) !== -1), "the forbidden list names every one the design named: " + asked.join(", "), () => H.FORBIDDEN_KEYS.join());
  const legit = [offerOf("pt-plan", ptData(), "Weekly PT plan"), offerOf("team-session", teamData(), "Squad night")];
  check(legit.every((o) => !H.hasForbiddenKey(o)), "no legitimate payload uses a forbidden name as a field (so a hit is never a false alarm)");
  let checked = 0, missed = [];
  for (const key of H.FORBIDDEN_KEYS.concat(["Rank", "NAME", "displayName", "Notes", "MOS"])) {
    for (const [where, build] of [
      ["the top of data", (o) => { o.data[key] = "x"; return o; }],
      ["the offer itself", (o) => { o[key] = "x"; return o; }],
      ["inside an array of objects", (o) => { o.data.steps = [{ [key]: "x" }]; return o; }],
      ["one level down", (o) => { o.data.z = { [key]: 1 }; return o; }],
    ]) {
      checked++;
      const o = build(offerOf("team-session", teamData()));
      // A stray key on the offer itself reads "offer-key" first, and a grade key anywhere reads "grade" (the
      // whole-frame rule 8 check runs before the body's); every other place must read "offer-personal".
      const expected = key === "grade" ? "grade" : where === "the offer itself" ? "offer-key:" + key : "offer-personal";
      const r = reasonOf(o);
      if (r !== expected) missed.push(key + "@" + where + "=" + r);
    }
  }
  check(missed.length === 0, "every forbidden name, at four positions and in mixed case, is refused (" + checked + " forged offers)", () => missed.slice(0, 5).join(" | "));
  const buried = offerOf("team-session", { steps: ["aar-huddle"], a: { b: { c: { d: { e: { rank: "SSG" } } } } } });
  check(reasonOf(buried) === "offer-depth", "a personal key buried past the nesting cap cannot dodge the scan: refused for depth", () => reasonOf(buried));
  check(S.validate(frameOf(offerOf("team-session", { steps: ["aar-huddle"], grade: 2 }))).reason === "grade", "a grade key is refused inside an offer too, by rule 8's whole-frame check");

  /* Other SPELLINGS of a forbidden key: the deny-list folds spacing and
     punctuation away and refuses any key with a non-ASCII character, so a
     trailing space, a zero-width character, a full-width or math-alphabet
     spelling (what NFKC would fold to ASCII) or a look-alike letter cannot slip
     a personal key past it. (Rust agrees: room.rs key_is_forbidden, its own
     test and the differential fuzz.) */
  const ZWJ = String.fromCharCode(8205), NBSP = String.fromCharCode(160), BOM = String.fromCharCode(65279), ALM2 = String.fromCharCode(1564);
  const fullWidth = (k) => k.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  const mathBold = (k) => k.replace(/[a-z]/g, (c) => String.fromCodePoint(c.charCodeAt(0) - 97 + 0x1d5ee));
  const spellings = {
    "a trailing space": (k) => k + " ", "a leading space": (k) => " " + k, "a space inside": (k) => k.slice(0, 1) + " " + k.slice(1),
    "an underscore inside": (k) => k.slice(0, 1) + "_" + k.slice(1), "a hyphen inside and a dot after": (k) => k.slice(0, 1) + "-" + k.slice(1) + ".",
    "a zero-width space inside": (k) => k.slice(0, 1) + ZWSP + k.slice(1), "a zero-width joiner inside": (k) => k.slice(0, 1) + ZWJ + k.slice(1),
    "a right-to-left override after": (k) => k + RLO, "a byte-order mark before": (k) => BOM + k, "an Arabic letter mark after": (k) => k + ALM2,
    "a no-break space after": (k) => k + NBSP, "full-width letters": fullWidth, "math sans-serif bold letters": mathBold,
    "Cyrillic look-alikes for a and o": (k) => k.replace(/a/g, String.fromCharCode(1072)).replace(/o/g, String.fromCharCode(1086)),
    "an accented letter": (k) => k.slice(0, 1) + E_ACUTE + k.slice(1),
  };
  let spellChecked = 0; const spellMissed = [];
  for (const key of H.FORBIDDEN_KEYS) {
    for (const [how, fn] of Object.entries(spellings)) {
      const spelled = fn(key);
      if (spelled === key) continue;
      for (const [where, build] of [["the top of data", (o) => { o.data[spelled] = "x"; return o; }], ["inside an array of objects", (o) => { o.data.steps = [{ [spelled]: "x" }]; return o; }], ["one level down", (o) => { o.data.z = { [spelled]: 1 }; return o; }]]) {
        spellChecked++;
        const r = reasonOf(build(offerOf("team-session", teamData())));
        if (r !== "offer-personal") spellMissed.push(key + " with " + how + " @" + where + "=" + r);
      }
    }
  }
  check(spellChecked > 1000 && spellMissed.length === 0, "every forbidden name in " + Object.keys(spellings).length + " other spellings, at three positions, is refused as personal (" + spellChecked + " forged offers)", () => spellMissed.slice(0, 5).join(" | "));
  const ordinary = ["oid", "kind", "ver", "title", "data", "tpl", "days", "sessions", "dates", "id", "label", "effort", "ref", "key", "type", "blocks", "date", "entry", "steps", "pad", "z", "q_abc"];
  check(ordinary.every((k) => reasonOf(offerOf("quiz-pack", { [k]: 1 })) !== "offer-personal"), "the field names a payload really uses are never caught by the fold (no false alarm)", () => ordinary.filter((k) => reasonOf(offerOf("quiz-pack", { [k]: 1 })) === "offer-personal").join());
  check(!H.hasForbiddenKey({ a: [{ b: { label: "a name in a VALUE, not a key", steps: ["rank"] } }] }), "a personal word as a VALUE is not a key and is not caught here (values are screened by the receiving side)");
}

/* ================================================================== (5) */
console.log("\n(5) classify(): what a device does with each status");
{
  const c = (o) => H.classify(o);
  check(c(offerOf("pt-plan", ptData())).status === "ok" && c(offerOf("team-session", teamData())).status === "ok", "a known kind at a known version is ok");
  const future = c(offerOf("quiz-pack", { anything: 1 }));
  check(future.status === "unsupported-kind", "an unknown kind is held as a note (unsupported-kind), not an error", () => JSON.stringify(future));
  const newer = c(offerOf("pt-plan", ptData(), null, { ver: 2 }));
  check(newer.status === "newer-version", "a newer ver of a known kind is held as a note (newer-version) without reading its data", () => JSON.stringify(newer));
  check(c(offerOf("pt-plan", { days: [] })).status === "invalid" && c(offerOf("team-session", { steps: [] })).status === "invalid", "a known kind with data that breaks its own rules is invalid");
  const deckOffer = c(offerOf("deck", { category: "Creeds", timerSec: 60 }));
  check(deckOffer.status === "unsupported-kind", "a deck sent as an offer is not something a device acts on (it is the room's own deck, carried in the snapshot)", () => JSON.stringify(deckOffer));
  check(c(offerOf("constructor", {})).status === "unsupported-kind" && c(offerOf("hasownproperty", {})).status === "unsupported-kind", "kind names that collide with Object.prototype are just unknown kinds");
  const r1 = H.receive(offerOf("quiz-pack", { x: 1 }), { screen: fakeScreen });
  const r2 = H.receive(offerOf("pt-plan", ptData(), null, { ver: 2 }), { screen: fakeScreen });
  check(!r1.ok && r1.status === "unsupported-kind" && /doesn't know how to open/.test(r1.message) && !("offer" in r1), "receive() of an unknown kind: plain words, no payload carried on", () => JSON.stringify(r1));
  check(!r2.ok && r2.status === "newer-version" && /newer GUIDON/.test(r2.message) && !("offer" in r2), "receive() of a newer version: plain words naming the fix, no payload carried on", () => JSON.stringify(r2));
  check(Object.values(H.MESSAGES).every((m) => typeof m === "string" && m.length > 20 && !/\b(oid|payload|schema|JSON|undefined|null|NaN|opsec)\b/i.test(m)), "every message is a plain sentence with no engineering words", () => JSON.stringify(H.MESSAGES));
}

/* ================================================================== (6) */
console.log("\n(6) sanitize()/receive(): cleaned, screened, fail closed");
{
  const clean = offerOf("pt-plan", ptData(), "Weekly PT plan");
  const r = H.receive(clean, { screen: fakeScreen });
  check(r.ok && r.status === "ok" && JSON.stringify(r.offer) === JSON.stringify(clean), "a clean offer passes and comes back unchanged", () => JSON.stringify(r));
  const noScreen = H.receive(clean, {});
  check(!noScreen.ok && noScreen.status === "no-guard" && /couldn't check/.test(noScreen.message), "no screen function: refused (fail closed), in plain words", () => JSON.stringify(noScreen));
  const thrower = H.receive(clean, { screen: () => { throw new Error("guard broke"); } });
  check(!thrower.ok && thrower.status === "no-guard", "a screen that throws is treated as no screen: refused, not waved through", () => JSON.stringify(thrower));
  // Text with control and direction-changing characters is CLEANED, and the cleaned copy is what comes back.
  const messy = offerOf("pt-plan", ptData(), "  Week" + RLO + "  plan" + NUL + " ");
  messy.data.sessions[0].label = "Circuit" + ZWSP + "   night\n";
  const m = H.receive(messy, { screen: fakeScreen });
  check(m.ok && m.offer.title === "Week plan" && m.offer.data.sessions[0].label === "Circuit night", "control, zero-width and direction-override characters become spaces and runs collapse: \"" + (m.offer && m.offer.title) + "\" / \"" + (m.offer && m.offer.data.sessions[0].label) + "\"", () => JSON.stringify(m));
  // A label of nothing but invisible characters is empty after cleaning: refused, not shown as a blank line.
  const blank = offerOf("pt-plan", ptData()); blank.data.sessions[0].label = ZWSP + ZWSP;
  const b = H.receive(blank, { screen: fakeScreen });
  check(!b.ok && b.status === "refused", "a label that is nothing after cleaning is refused", () => JSON.stringify(b));
  // One finding on ANY string refuses the WHOLE offer - a label, the title, even an id.
  for (const [what, edit] of [
    ["a session label with a phone number", (o) => { o.data.sessions[0].label = "Call 270-555-0101"; }],
    ["an ad hoc day label with a classification marking", (o) => { o.data.days[5].label = "Run (S//NF)"; }],
    ["the title with a phone number", (o) => { o.title = "Ask 270-555-0101"; }],
    ["a drill id shaped like a phone number", (o) => { o.data.sessions[0].blocks = ["270-555-0101"]; }],
    ["a Team Training step id shaped like a phone number", (o) => { o.data.steps = ["270-555-0101"]; }],
  ]) {
    const o = what.indexOf("Team") !== -1 ? offerOf("team-session", teamData(), "Squad night") : offerOf("pt-plan", ptData(), "Weekly PT plan");
    edit(o);
    const x = H.receive(o, { screen: fakeScreen });
    check(!x.ok && x.status === "refused" && x.found && x.found.length > 0 && !("offer" in x), "refused whole: " + what, () => JSON.stringify(x));
  }
  check(H.cleanText("a" + RLO + "b") === "a b" && H.cleanText(" \t ") === "" && H.cleanText(5) === "5", "cleanText is total: direction override -> space, blank -> empty, a number -> its text");

  /* The Arabic letter mark (U+061C) and the Unicode "tag" characters
     (U+E0000-U+E007F, invisible, used to hide text inside text) are cleaned
     too - by the one cleanText() that make() (the sending side) and sanitize()
     (the receiving side) both use. */
  const ALM = String.fromCharCode(1564);
  const tagged = (s) => Array.from(s).map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
  check(H.cleanText("Week" + ALM + "plan") === "Week plan", "the Arabic letter mark is cleaned to a space");
  check(H.cleanText("Circuit" + tagged("hidden text") + " night") === "Circuit night", "invisible tag characters spelling out a hidden message leave nothing behind: \"" + H.cleanText("Circuit" + tagged("hidden text") + " night") + "\"");
  const TAG_FIRST = String.fromCodePoint(0xe0000), TAG_LAST = String.fromCodePoint(0xe007f), JUST_BEFORE = String.fromCodePoint(0xdffff), JUST_AFTER = String.fromCodePoint(0xe0080);
  check(H.cleanText("a" + TAG_FIRST + "b") === "a b" && H.cleanText("a" + TAG_LAST + "b") === "a b", "both ends of the tag block (U+E0000 and U+E007F) are cleaned");
  check(H.cleanText("a" + JUST_BEFORE + "b") === "a" + JUST_BEFORE + "b" && H.cleanText("a" + JUST_AFTER + "b") === "a" + JUST_AFTER + "b", "the code points just outside the block (U+DFFFF and U+E0080) are left alone");
  check(H.cleanText("Caf" + E_ACUTE) === "Caf" + E_ACUTE && H.cleanText(String.fromCodePoint(0x1f600) + " go") === String.fromCodePoint(0x1f600) + " go", "ordinary accented letters and an emoji (an astral character) are untouched");
  const madeTagged = H.make("team-session", "Squad" + ALM + tagged("x") + " night", teamData());
  check(madeTagged.ok && madeTagged.offer.title === "Squad night", "sending side: make() cleans a title carrying them: \"" + (madeTagged.offer && madeTagged.offer.title) + "\"");
  const rx = offerOf("pt-plan", ptData(), "Week" + ALM + tagged("y") + "ly");
  rx.data.sessions[0].label = "Circuit" + tagged("z") + ALM + " night";
  const rxr = H.receive(rx, { screen: fakeScreen });
  check(rxr.ok && rxr.offer.title === "Week ly" && rxr.offer.data.sessions[0].label === "Circuit night", "receiving side: receive() cleans a title and a session label carrying them", () => JSON.stringify(rxr));

  /* Two harmless strings can add up to something that is not. A changed date
     is one string and its name is another; the sensitive-text check only sees
     "a future date + a place" on ONE line. So the receiving side screens each
     changed date as the line the preview shows for it ("<date>: <name>"). The
     stand-in screen below flags exactly that shape and nothing on either
     string alone. */
  const comboScreen = (text) => ({ findings: /20\d\d-\d\d-\d\d.*\bRange\b/.test(text) ? [{ code: "future-operation-location", looksLike: "a future date and place for a unit activity" }] : [] });
  const dated = (entry) => { const o = offerOf("pt-plan", ptData(), "Weekly PT plan"); o.data.dates = [{ date: "2026-10-02", entry }]; return o; };
  check(!comboScreen("2026-10-02").findings.length && !comboScreen("Live-fire at Range 4").findings.length && comboScreen("2026-10-02: Live-fire at Range 4").findings.length === 1, "(the stand-in screen passes each string alone and flags them together)");
  const liveFire = H.receive(dated({ id: "custom", label: "Live-fire at Range 4", effort: "hard" }), { screen: comboScreen });
  check(!liveFire.ok && liveFire.status === "refused" && liveFire.found.length === 1 && !("offer" in liveFire), "a changed date whose name adds up to a date + place line is refused whole, though every string passes alone", () => JSON.stringify(liveFire));
  const sess = offerOf("pt-plan", ptData(), "Weekly PT plan"); sess.data.sessions[0].label = "Live-fire at Range 4"; sess.data.dates = [{ date: "2026-10-02", entry: { id: "session", ref: "s1" } }];
  const viaSession = H.receive(sess, { screen: comboScreen });
  check(!viaSession.ok && viaSession.status === "refused", "the same holds when the name comes from one of the payload's own custom sessions", () => JSON.stringify(viaSession));
  const weekday = offerOf("pt-plan", ptData(), "Weekly PT plan"); weekday.data.days[5] = { id: "custom", label: "Live-fire at Range 4", effort: "hard" };
  check(H.receive(weekday, { screen: comboScreen }).ok, "a weekday entry with that name is not a dated line, so it is not combined (no false alarm)");
  check(JSON.stringify(H.combinedLines("pt-plan", sess.data)) === JSON.stringify(["2026-10-02: Live-fire at Range 4"]) && H.combinedLines("team-session", teamData()).length === 0 && H.combinedLines("pt-plan", { days: [] }).length === 0 && H.combinedLines("pt-plan", null).length === 0, "combinedLines() is the dated line per changed date, and nothing for another kind, no dates or no data");
}

/* ================================================================== (7) */
console.log("\n(7) the deck, migrated onto the model, behaves as it always did");
/* Captured ONCE from the build BEFORE the deck moved onto the model (git show HEAD:...studygroup.js): the snapshot
   and the welcome frame a host sends for each deck below, byte for byte. */
const GOLDEN = [
  { name: "every category, 60s",
    snapshot: "{\"phase\":\"lobby\",\"mode\":\"relay\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":0},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":null,\"timerSec\":60}}",
    welcome: "{\"v\":1,\"t\":\"welcome\",\"room\":\"ALPHA-BRAVO-42\",\"seq\":1,\"from\":\"HOSTHOST\",\"body\":{\"seatNo\":2,\"token\":\"ABCDEFGHIJKLMNO2\",\"snapshot\":{\"phase\":\"lobby\",\"mode\":\"relay\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":0},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":null,\"timerSec\":60}},\"hold\":60}}" },
  { name: "one category, untimed",
    snapshot: "{\"phase\":\"lobby\",\"mode\":\"relay\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":0},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":\"Creeds\",\"timerSec\":null}}",
    welcome: "{\"v\":1,\"t\":\"welcome\",\"room\":\"ALPHA-BRAVO-42\",\"seq\":1,\"from\":\"HOSTHOST\",\"body\":{\"seatNo\":2,\"token\":\"ABCDEFGHIJKLMNO2\",\"snapshot\":{\"phase\":\"lobby\",\"mode\":\"relay\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":0},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":\"Creeds\",\"timerSec\":null}},\"hold\":60}}" },
  { name: "mixed label",
    snapshot: "{\"phase\":\"lobby\",\"mode\":\"relay\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":0},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":\"Mixed deck #0abc1def2\",\"timerSec\":90}}",
    welcome: "{\"v\":1,\"t\":\"welcome\",\"room\":\"ALPHA-BRAVO-42\",\"seq\":1,\"from\":\"HOSTHOST\",\"body\":{\"seatNo\":2,\"token\":\"ABCDEFGHIJKLMNO2\",\"snapshot\":{\"phase\":\"lobby\",\"mode\":\"relay\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":0},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":\"Mixed deck #0abc1def2\",\"timerSec\":90}},\"hold\":60}}" },
  { name: "board with ids",
    snapshot: "{\"phase\":\"lobby\",\"mode\":\"board\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":2},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":\"Creeds\",\"timerSec\":null}}",
    welcome: "{\"v\":1,\"t\":\"welcome\",\"room\":\"ALPHA-BRAVO-42\",\"seq\":1,\"from\":\"HOSTHOST\",\"body\":{\"seatNo\":2,\"token\":\"ABCDEFGHIJKLMNO2\",\"snapshot\":{\"phase\":\"lobby\",\"mode\":\"board\",\"seq\":1,\"room\":\"ALPHA-BRAVO-42\",\"hostSeat\":1,\"cardId\":null,\"cardText\":null,\"turnSeat\":null,\"lock\":null,\"deadline\":null,\"round\":{\"idx\":0,\"total\":2},\"seats\":[{\"seatNo\":1,\"name\":\"HOST\",\"fp\":\"HOSTHOST\",\"score\":0,\"online\":true,\"ready\":true,\"done\":false},{\"seatNo\":2,\"name\":\"PEER\",\"fp\":\"PEERPEER\",\"score\":0,\"online\":true,\"ready\":false,\"done\":false}],\"bankSig\":\"bank:10:x\",\"deck\":{\"category\":\"Creeds\",\"timerSec\":null}},\"hold\":60}}" },
];
{
  const cases = [
    { name: "every category, 60s", mode: "relay", deck: { category: null, timerSec: 60 } },
    { name: "one category, untimed", mode: "relay", deck: { category: "Creeds", timerSec: null } },
    { name: "mixed label", mode: "relay", deck: { category: "Mixed deck #0abc1def2", timerSec: 90 } },
    { name: "board with ids", mode: "board", deck: { category: "Creeds", timerSec: null, ids: ["bq1", "bq2"] }, cards: { bq1: { q: "Q1", a: "A1", category: "Creeds" }, bq2: { q: "Q2", a: "A2", category: "Creeds" } } },
  ];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    let n = 0;
    const token = () => "ABCDEFGHIJKLMNO" + String(n++ % 10).replace(/[01]/g, "2");
    const ctx = { now: () => 1000, token };
    const host = sg.initHost({ room: ROOM, mode: c.mode, self: { fp: "HOSTHOST", name: "HOST" }, bankSig: "bank:10:x", deck: c.deck, cards: c.cards || {}, now: 1000, token });
    let r = sg.reduce(host, { v: 1, t: "hello", room: ROOM, seq: 0, from: "PEERPEER", body: { name: "PEER", bankSig: "bank:10:x" } }, ctx);
    r = sg.act(r.state, { type: "admit", fp: "PEERPEER" }, ctx);
    const snap = JSON.stringify(sg.snapshotOf(r.state));
    const welcome = JSON.stringify(r.effects[0].frame);
    check(snap === GOLDEN[i].snapshot, "\"" + c.name + "\": the snapshot is byte-identical to the pre-model build's", () => "now  " + snap + "\nwas  " + GOLDEN[i].snapshot);
    check(welcome === GOLDEN[i].welcome && r.effects.length === 1, "\"" + c.name + "\": the welcome frame is byte-identical, and with no offer nothing extra is sent", () => "now  " + welcome + "\nwas  " + GOLDEN[i].welcome);
    const model = H.deckData(c.deck);
    check(JSON.stringify(sg.snapshotOf(r.state).deck) === JSON.stringify(model) && Object.keys(model).join() === "category,timerSec", "\"" + c.name + "\": the snapshot's deck IS the model's deck data (same two fields, same order)", () => JSON.stringify(model));
    check(H.deckProblem(model) === null, "\"" + c.name + "\": the model accepts it as a deck");
  }
  const snapOf = (deck) => ({ v: 1, t: "snapshot", room: ROOM, seq: 1, from: "HOSTHOST", body: { snapshot: { phase: "lobby", mode: "relay", seq: 1, room: ROOM, hostSeat: 1, seats: [], deck } } });
  const reasons = [
    [{ category: "Creeds", timerSec: 60 }, null, "a normal deck"],
    [{ category: null, timerSec: null }, null, "an empty deck"],
    [{ category: 5 }, "snapshot-deck-cat", "a category that is not text"],
    [{ category: "C".repeat(81) }, "snapshot-deck-cat", "a category past 80 characters"],
    [{ timerSec: 0 }, "snapshot-deck-timer", "a timer of zero"],
    [{ timerSec: 3601 }, "snapshot-deck-timer", "a timer past an hour"],
    [{ x: 1 }, "snapshot-deck-key:x", "an extra key"],
    [[], "snapshot-deck", "an array"],
    ["Creeds", "snapshot-deck", "text"],
  ];
  for (const [deck, want, what] of reasons) {
    const v = S.validate(snapOf(deck));
    check(want === null ? v.ok : (!v.ok && v.reason === want), "the snapshot's deck field: " + what + " -> " + (want || "accepted") + " (the reasons this field has always given)", () => JSON.stringify(v));
  }
}

/* ================================================================== (8) */
console.log("\n(8) the room core: host offers, peers hold");
{
  const tok = tokenStream(11);
  const ctx = { now: () => 5000, token: tok };
  const host0 = sg.initHost({ room: ROOM, mode: "relay", self: { fp: "HOSTHOST", name: "HOST" }, bankSig: "bank:10:x", deck: { category: null, timerSec: 60 }, cards: {}, now: 1000, token: tok });
  const hello = (fp, name) => ({ v: 1, t: "hello", room: ROOM, seq: 0, from: fp, body: { name, bankSig: "bank:10:x" } });
  function seat(host, fp, name) {
    let r = sg.reduce(host, hello(fp, name), ctx);
    r = sg.act(r.state, { type: "admit", fp }, ctx);
    let peer = sg.initPeer({ room: ROOM, self: { fp, name }, bankSig: "bank:10:x", now: 1000 });
    peer = sg.reduce(peer, r.effects[0].frame, ctx).state;
    return { host: r.state, peer, effects: r.effects };
  }
  let a = seat(host0, "PEERAAAA", "ONE");
  let b = seat(a.host, "PEERBBBB", "TWO");
  let host = b.host, peerA = a.peer, peerB = b.peer;
  check(host.offer === null && peerA.offer === null && peerB.offer === null && peerA.joinState === "seated", "before anything is shared nobody holds an offer");

  const made = H.make("pt-plan", "Weekly PT plan", ptData());
  const offered = sg.act(host, { type: "offer", offer: made.offer }, ctx);
  check(offered.accepted && offered.effects.length === 2 && offered.effects.every((e) => e.frame.t === "offer" && e.frame.body.offer.oid === offered.state.offer.oid), "the host's offer goes to exactly the two seated peers (2 frames, one oid)", () => JSON.stringify({ acc: offered.accepted, n: offered.effects.length, reason: offered.reason }));
  check(offered.effects.map((e) => e.to).sort().join() === "PEERAAAA,PEERBBBB" && offered.effects.every((e) => S.validate(e.frame).ok), "each addressed to one fingerprint, each a valid frame", () => offered.effects.map((e) => e.to).join());
  const wireOffer = offered.state.offer;
  check(Object.keys(wireOffer).sort().join() === "data,kind,oid,title,ver" && S.handoff.classify(wireOffer).status === "ok" && /^[A-Z2-7]{8}$/.test(wireOffer.oid), "the stored offer is exactly the wire form ({oid, kind, ver, title, data}), with an 8-character id", () => JSON.stringify(Object.keys(wireOffer)));
  host = offered.state;

  const gotA = sg.reduce(peerA, offered.effects[0].frame, ctx);
  check(gotA.accepted && gotA.state.offer && gotA.state.offer.oid === wireOffer.oid && JSON.stringify(gotA.state.offer.data) === JSON.stringify(wireOffer.data) && gotA.state.offerNote === "", "a seated peer HOLDS the offer (in its own state; nothing else changes)", () => JSON.stringify(gotA.reason));
  check(gotA.state.seq === peerA.seq && gotA.state.phase === peerA.phase && JSON.stringify(gotA.state.seats) === JSON.stringify(peerA.seats), "receiving an offer touches nothing else: seq, phase and seats are as they were");
  peerA = gotA.state;
  const dup = sg.reduce(peerA, offered.effects[0].frame, ctx);
  check(!dup.accepted && dup.reason === "dup-offer" && dup.state === peerA, "the same offer id again (a replayed or resent frame) changes nothing and asks nothing twice", () => dup.reason);

  // A late seat: admitted AFTER the share, it gets the offer right behind its welcome.
  const late = seat(host, "PEERCCCC", "THREE");
  check(late.effects.length === 2 && late.effects[0].frame.t === "welcome" && late.effects[1].frame.t === "offer" && late.effects[1].frame.body.offer.oid === host.offer.oid, "a device admitted after the share gets the offer right behind its welcome (same id)", () => late.effects.map((e) => e.frame.t).join());
  const lateGot = sg.reduce(late.peer, late.effects[1].frame, ctx);
  check(lateGot.accepted && lateGot.state.offer.oid === host.offer.oid, "...and holds it");
  host = late.host;

  // A seat that is OFFLINE when the host shares never gets it then (the host addresses only seats that are online) -
  // and gets the host's CURRENT share right behind its welcome the moment it resumes, exactly once, by the same path a
  // newly admitted seat uses.
  {
    const byeOf = (fp) => ({ v: 1, t: "bye", room: ROOM, seq: 0, from: fp, body: {} });
    const resumeHello = (h, fp, name) => ({ v: 1, t: "hello", room: ROOM, seq: 0, from: fp, body: { name, bankSig: "bank:10:x", resume: h.seats.find((x) => x.fp === fp).token } });
    const dropped = sg.reduce(host, byeOf("PEERBBBB"), ctx);
    check(dropped.accepted && dropped.state.seats.find((x) => x.fp === "PEERBBBB").online === false, "a seat drops offline (its bye)");
    const shared = sg.act(dropped.state, { type: "offer", offer: made.offer }, ctx);
    const sharedTo = shared.effects.map((e) => e.to).sort().join();
    check(shared.accepted && !sharedTo.includes("PEERBBBB") && sharedTo === "PEERAAAA,PEERCCCC", "the host shares while it is offline: the offer goes to the seats that are online and NOT to the offline one", () => sharedTo);
    const back = sg.reduce(shared.state, resumeHello(shared.state, "PEERBBBB", "TWO"), ctx);
    const backTypes = back.effects.map((e) => e.frame.t).join();
    check(back.accepted && back.reason === "resumed" && backTypes === "welcome,offer" && back.effects.every((e) => e.to === "PEERBBBB"), "the seat resumes: it is sent its welcome and then the host's current offer (" + backTypes + ")", () => back.reason + " " + backTypes);
    const backOffer = back.effects.find((e) => e.frame.t === "offer").frame;
    check(backOffer.body.offer.oid === shared.state.offer.oid && JSON.stringify(backOffer.body.offer) === JSON.stringify(shared.state.offer) && S.validate(backOffer).ok, "...the very offer the host shared (same id, same bytes), and a valid frame");
    check(back.effects.filter((e) => e.frame.t === "offer").length === 1, "exactly one offer frame goes to the resumed seat");
    let gotWelcome = sg.reduce(peerB, back.effects[0].frame, ctx);
    check(gotWelcome.accepted && gotWelcome.state.offer === peerB.offer, "the peer takes the welcome (its held offer is as it was)");
    const gotOffer = sg.reduce(gotWelcome.state, back.effects[1].frame, ctx);
    check(gotOffer.accepted && gotOffer.state.offer && gotOffer.state.offer.oid === shared.state.offer.oid, "...and then HOLDS the offer it had missed", () => gotOffer.reason);
    // A seat that already holds it (a re-hello while still online) is sent it again and simply ignores the repeat.
    const rehello = sg.reduce(back.state, resumeHello(back.state, "PEERBBBB", "TWO"), ctx);
    const repeat = sg.reduce(gotOffer.state, rehello.effects.find((e) => e.frame.t === "offer").frame, ctx);
    check(rehello.reason === "rehello" && !repeat.accepted && repeat.reason === "dup-offer" && repeat.state === gotOffer.state, "a re-hello from a seat that already holds it resends the offer; the device ignores the repeat (\"dup-offer\") and asks nothing twice", () => rehello.reason + " " + repeat.reason);
    // With nothing shared a resume sends the welcome and only the welcome, as it always did.
    const quietPending = sg.reduce(host0, hello("PEERQQQQ", "Q"), ctx);
    const quietSeated = sg.act(quietPending.state, { type: "admit", fp: "PEERQQQQ" }, ctx);
    const quietBack = sg.reduce(sg.reduce(quietSeated.state, byeOf("PEERQQQQ"), ctx).state, resumeHello(quietSeated.state, "PEERQQQQ", "Q"), ctx);
    check(quietBack.reason === "resumed" && quietBack.effects.length === 1 && quietBack.effects[0].frame.t === "welcome", "with nothing shared, a resume still sends the welcome and nothing else", () => quietBack.effects.map((e) => e.frame.t).join());
    // A seat that resumes AFTER the host has replaced the offer gets the newest one, not the old one.
    const second = sg.act(shared.state, { type: "offer", offer: { kind: "team-session", ver: 1, title: "Second", data: teamData() } }, ctx);
    const late2 = sg.reduce(second.state, resumeHello(second.state, "PEERBBBB", "TWO"), ctx);
    check(late2.effects[1].frame.body.offer.oid === second.state.offer.oid && second.state.offer.oid !== shared.state.offer.oid, "a seat resuming after the host shared again is sent the NEWEST offer");
  }

  // A resend is a NEW offer (new id) - a device that said "not now" is asked again on purpose.
  const again = sg.act(host, { type: "offer", offer: { kind: wireOffer.kind, ver: wireOffer.ver, title: wireOffer.title, data: wireOffer.data } }, ctx);
  check(again.accepted && again.state.offer.oid !== wireOffer.oid, "sending the same payload again mints a new offer id (" + wireOffer.oid + " -> " + again.state.offer.oid + ")", () => JSON.stringify(again.reason));
  const replaced = sg.reduce(peerA, again.effects.find((e) => e.to === "PEERAAAA").frame, ctx);
  check(replaced.accepted && replaced.state.offer.oid === again.state.offer.oid, "the peer's held offer is replaced by the new one");
  host = again.state; peerA = replaced.state;

  // Who can and cannot offer.
  const peerOffer = sg.act(peerA, { type: "offer", offer: made.offer }, ctx);
  check(!peerOffer.accepted && peerOffer.reason === "action" && peerOffer.state === peerA, "a peer cannot offer (its act() ignores the action)", () => peerOffer.reason);
  const toHost = sg.reduce(host, frameOf(wireOffer, { from: "PEERAAAA" }), ctx);
  check(!toHost.accepted && toHost.reason === "role" && toHost.state === host, "an offer frame arriving AT the host is ignored (\"role\"): only a host offers", () => toHost.reason);
  const spoof = sg.reduce(peerB, frameOf(wireOffer, { from: "PEERAAAA" }), ctx);
  check(!spoof.accepted && spoof.reason === "not-host", "an offer that does not come from the host's fingerprint is ignored by a peer (\"not-host\")", () => spoof.reason);
  const unseated = sg.reduce(sg.initPeer({ room: ROOM, self: { fp: "PEERDDDD", name: "FOUR" }, bankSig: "b", now: 1 }), frameOf(wireOffer, { from: "HOSTHOST" }), ctx);
  check(!unseated.accepted && unseated.reason === "unadmitted", "a device that has not been seated yet holds nothing (\"unadmitted\")", () => unseated.reason);

  // What the host itself refuses to send.
  for (const [what, offer, reason] of [
    ["an unknown kind", { kind: "quiz-pack", ver: 1, data: { x: 1 } }, "offer-unsupported-kind"],
    ["a deck as an offer", { kind: "deck", ver: 1, data: { category: "Creeds", timerSec: 60 } }, "offer-unsupported-kind"],
    ["a newer version", { kind: "pt-plan", ver: 2, data: ptData() }, "offer-newer-version"],
    ["a PT plan with a personal key", { kind: "pt-plan", ver: 1, data: Object.assign(ptData(), { profile: {} }) }, "offer-personal"],
    ["a PT plan with a stray key", { kind: "pt-plan", ver: 1, data: Object.assign(ptData(), { extra: 1 }) }, "offer-pt-plan-key:extra"],
    ["an oversize payload", { kind: "team-session", ver: 1, data: { steps: ["aar-huddle"], pad: "P".repeat(3200) } }, "offer-size"],
    ["nothing", null, "offer-shape"],
    ["an array", [], "offer-shape"],
  ]) {
    const r = sg.act(host, { type: "offer", offer }, ctx);
    check(!r.accepted && r.reason === reason && r.state === host && r.effects.length === 0, "the host refuses to send " + what + " (" + reason + ") and its state does not change", () => JSON.stringify({ acc: r.accepted, reason: r.reason }));
  }
  const smuggled = sg.act(host, { type: "offer", offer: Object.assign({ oid: "ZZZZZZZZ", notes: "x", rank: "SSG" }, { kind: "team-session", ver: 1, data: teamData() }) }, ctx);
  check(smuggled.accepted && Object.keys(smuggled.state.offer).sort().join() === "data,kind,oid,ver" && smuggled.state.offer.oid !== "ZZZZZZZZ" && JSON.stringify(smuggled.effects).indexOf("SSG") === -1, "extra top-level fields on the host's action are dropped (only oid, kind, ver, title, data can leave), and the host mints the id itself", () => JSON.stringify(smuggled.state.offer));

  // What a peer does with a forged or unreadable offer from the host.
  const forge = (offer, over) => sg.reduce(peerB, frameOf(offer, Object.assign({ from: "HOSTHOST", seq: 9 }, over || {})), ctx);
  const unk = forge(offerOf("quiz-pack", { anything: 1 }, "Secret sauce"));
  check(unk.accepted && unk.state.offer && unk.state.offer.unsupported === "unsupported-kind" && !("data" in unk.state.offer) && !("title" in unk.state.offer), "an unknown kind is held as a bare note: the kind's data and title are DROPPED, never kept", () => JSON.stringify(unk.state.offer));
  const nv = forge(offerOf("pt-plan", ptData(), null, { ver: 3, oid: "NEWVER22" }));
  check(nv.accepted && nv.state.offer.unsupported === "newer-version" && !("data" in nv.state.offer), "a newer version is held as a bare note too", () => JSON.stringify(nv.state.offer));
  const bad1 = forge(offerOf("pt-plan", Object.assign(ptData(), { extra: 1 }), null, { oid: "BADKEY22" }));
  check(!bad1.accepted && bad1.state.offerNote === H.MESSAGES.refused && JSON.stringify(bad1.state.offer) === JSON.stringify(peerB.offer), "a forged field: refused, the peer is told once in one fixed sentence, and its held offer is untouched", () => JSON.stringify({ reason: bad1.reason, note: bad1.state.offerNote }));
  const bad2 = forge(offerOf("team-session", Object.assign(teamData(), { rank: "SSG" }), null, { oid: "PERSON22" }));
  check(!bad2.accepted && bad2.state.offerNote === H.MESSAGES.refused && bad2.reason === "offer-personal" && JSON.stringify(bad2.state.offer) === JSON.stringify(peerB.offer), "a personal key from the host: refused at the wire rules, noted, applied nowhere", () => JSON.stringify({ reason: bad2.reason }));
  const bad3 = forge(offerOf("quiz-pack", { pad: "P".repeat(3300) }, null, { oid: "TOOBIG22" }));
  check(!bad3.accepted && bad3.reason === "offer-size" && bad3.state.offerNote === H.MESSAGES.refused, "an oversize offer: refused (\"offer-size\") and noted", () => bad3.reason);
  const stranger = sg.reduce(peerB, frameOf(offerOf("team-session", teamData(), null, { oid: "STRANGE2" }), { from: "PEERAAAA" }), ctx);
  check(!stranger.accepted && stranger.state.offerNote === "" && stranger.state.offer === peerB.offer, "an invalid-looking offer from someone who is NOT the host gets no note and no effect", () => stranger.reason);
  const wrongRoom = sg.reduce(peerB, frameOf(offerOf("team-session", Object.assign(teamData(), { rank: "x" }), null, { oid: "WRONGRM2" }), { from: "HOSTHOST", room: "ZULU-ZULU-99" }), ctx);
  check(!wrongRoom.accepted && wrongRoom.state.offerNote === "", "...nor one for another room");

  // The browser guest page can never use a payload (no PT Planner, no Team Training) and tells the person
  // nothing about it is kept - so it keeps none: only {oid, kind, ver}, as it does for a kind it cannot open.
  const gctx = { now: () => 5000, token: tok, keepOffer: false };
  const guestFrame = (offer) => frameOf(offer, { from: "HOSTHOST", seq: 9 });
  const guestOk = sg.reduce(peerB, guestFrame(offerOf("pt-plan", ptData(), "Weekly PT plan", { oid: "GUESTOK2" })), gctx);
  const stub = guestOk.state.offer;
  check(guestOk.accepted && stub && Object.keys(stub).sort().join() === "kind,oid,unsupported,ver" && stub.oid === "GUESTOK2" && stub.kind === "pt-plan" && stub.ver === 1 && stub.unsupported === "guest",
    "the guest page keeps only {oid, kind, ver} of a PT plan it cannot open", () => JSON.stringify(stub));
  check(JSON.stringify(guestOk.state).indexOf("Circuit night") === -1 && JSON.stringify(guestOk.state).indexOf("Weekly PT plan") === -1 && JSON.stringify(guestOk.state).indexOf("Ruck") === -1, "...nothing of the plan's title, names or drill ids is anywhere in that page's state");
  const guestTeam = sg.reduce(peerB, guestFrame(offerOf("team-session", teamData(), "Squad night", { oid: "GUESTTM2" })), gctx);
  check(guestTeam.accepted && Object.keys(guestTeam.state.offer).sort().join() === "kind,oid,unsupported,ver" && JSON.stringify(guestTeam.state).indexOf("aar-huddle") === -1 && JSON.stringify(guestTeam.state).indexOf("Squad night") === -1, "...and the same for a Team Training session (no exercise ids, no title)");
  const guestDup = sg.reduce(guestOk.state, guestFrame(offerOf("pt-plan", ptData(), "Weekly PT plan", { oid: "GUESTOK2" })), gctx);
  check(!guestDup.accepted && guestDup.reason === "dup-offer", "a repeat of the same offer id is still ignored on the guest page");
  const guestBad = sg.reduce(peerB, guestFrame(offerOf("pt-plan", Object.assign(ptData(), { extra: 1 }), null, { oid: "GUESTBD2" })), gctx);
  const guestUnk = sg.reduce(peerB, guestFrame(offerOf("quiz-pack", { anything: 1 }, "Secret sauce", { oid: "GUESTUK2" })), gctx);
  check(!guestBad.accepted && guestBad.state.offerNote === H.MESSAGES.refused && guestUnk.state.offer.unsupported === "unsupported-kind" && !("data" in guestUnk.state.offer), "a forged offer is still refused and noted, and an unknown kind is still a bare \"can't open this\", on the guest page");
  const appGot = sg.reduce(peerB, guestFrame(offerOf("pt-plan", ptData(), "Weekly PT plan", { oid: "APPKEEP2" })), ctx);
  check(appGot.accepted && appGot.state.offer.data && appGot.state.offer.title === "Weekly PT plan" && !("unsupported" in appGot.state.offer), "the app itself (no keepOffer:false) still keeps the whole offer, as it must to preview it");
}

/* ================================================================== (9) */
console.log("\n(9) the real relay: Node server, Node host and peers over WebSockets");
const evidence = join(tmpdir(), "guidon-room-handoff-evidence-" + process.pid + ".json");
let srv = null, host = null;
const peers = [];
try {
  srv = await startRoomServer({ loopback: true, port: 0, guest: resolve("dist/guest.html"), evidence, quiet: true });
  const wsBase = "127.0.0.1:" + srv.port;
  const room = "MIKE-NOVEMBER-27";
  host = nodeHost({ room, wsBase, fp: "NODEHOST", name: "HOST-KILO", token: tokenStream(23), bankSig: "bank:10:x", timerSec: 60 });
  await host.ready;
  for (const [fp, name] of [["PEERAAAA", "ONE"], ["PEERBBBB", "TWO"]]) {
    const p = nodePeer({ room, wsBase, fp, name, bankSig: "bank:10:x" });
    peers.push(p);
    await p.ready;
    p.hello();
  }
  const pend = await pollUntil(() => host.pending().length === 2);
  check(pend.hit, "two peers said hello through the real relay", () => JSON.stringify(host.pending()));
  for (const p of peers) host.act({ type: "admit", fp: p.fp });
  const seated = await pollUntil(() => peers.every((p) => p.state().joinState === "seated"));
  check(seated.hit, "both peers are seated");

  // The host's PT plan, carrying planted personal data in the OBJECT it was built from - the builder copies by name, so it must not travel.
  const source = ptData();
  const stored ={ plan: source, ownerName: "PLANTED-NAME", rank: "PLANTEDRANK", mos: "PLANTEDMOS", notes: "PLANTED-NOTE", progress: { attempts: 41 } };
  const made = H.make("pt-plan", "Weekly PT plan", stored.plan);
  check(made.ok && JSON.stringify(made).indexOf("PLANTED") === -1, "the offer built from a record that carries planted personal data holds none of it", () => JSON.stringify(made));
  const res = host.act({ type: "offer", offer: made.offer });
  check(res.accepted, "the host sends the offer through the relay", () => res.reason);
  const got = await pollUntil(() => peers.every((p) => p.state().offer && p.state().offer.oid === host.state().offer.oid));
  check(got.hit, "both peers hold the offer (" + got.ms + " ms)");
  const inbound = peers.map((p) => p.log.filter((e) => e.dir === "in" && e.frame && e.frame.t === "offer"));
  check(inbound.every((l) => l.length === 1), "each peer received exactly one offer frame", () => inbound.map((l) => l.length).join());
  const outText = host.log.filter((e) => e.dir === "out" && e.frame && e.frame.t === "offer").map((e) => JSON.stringify(e.frame.body.offer));
  check(inbound.every((l) => outText.includes(JSON.stringify(l[0].frame.body.offer))), "what each peer received is byte for byte what the host sent (the relay carries it untouched)");
  const allWire = [].concat(host.log, ...peers.map((p) => p.log)).map((e) => JSON.stringify(e.frame));
  check(allWire.every((t) => t.indexOf("PLANTED") === -1), "no planted personal string appears in any of the " + allWire.length + " frames any party logged");
  const keys = new Set();
  (function walk(v) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const k of Object.keys(v)) { keys.add(k.toLowerCase()); walk(v[k]); } })(inbound.flat().map((e) => e.frame.body.offer));
  check(![...keys].some((k) => H.FORBIDDEN_KEYS.indexOf(k) !== -1), "no forbidden key name appears anywhere in the offers that crossed the relay (" + keys.size + " distinct keys seen)", () => [...keys].join());
  check(peers.every((p) => p.state().offerNote === "" && p.state().seq === peers[0].state().seq), "the peers' room state is otherwise untouched");

  // A hostile peer socket: hand-built frames straight at the relay.
  const before = srv.stats();
  const evil = new WebSocket("ws://" + wsBase + S.ENDPOINTS.ws + "?room=" + room + "&role=peer");
  await new Promise((res2, rej) => { evil.addEventListener("open", res2, { once: true }); evil.addEventListener("error", () => rej(new Error("evil socket")), { once: true }); });
  const evilFrame = (offer) => S.wireEncode({ v: 1, t: "offer", room, seq: 0, from: "EVILEVIL", body: { offer } }, null);
  evil.send(evilFrame(offerOf("pt-plan", Object.assign(ptData(), { rank: "SSG" }))));                          // personal key
  evil.send(evilFrame(offerOf("quiz-pack", { pad: "P".repeat(3300) })));                                        // oversize
  evil.send(evilFrame(offerOf("team-session", teamData(), null, { oid: "lower" })));                            // bad oid
  const dropped = await pollUntil(() => (srv.stats().droppedBy.invalid || 0) - (before.droppedBy.invalid || 0) >= 3);
  check(dropped.hit, "three hostile offers (a personal key, an oversize payload, a malformed id) are dropped at the relay and counted as \"invalid\"", () => JSON.stringify(srv.stats().droppedBy));
  check(!host.log.some((e) => e.dir === "in" && e.frame && e.frame.t === "offer"), "none of them reached the host");
  // A valid-looking offer from a peer DOES pass the relay (it is a valid frame); the host's own reducer is what ignores it.
  const ignoredBefore = host.stats.ignored.role || 0;
  evil.send(evilFrame(offerOf("team-session", teamData(), null, { oid: "FROMPEER" })));
  const roleIgnored = await pollUntil(() => (host.stats.ignored.role || 0) > ignoredBefore);
  check(roleIgnored.hit && host.state().offer.oid !== "FROMPEER", "an offer sent BY a peer reaches the host as a valid frame and the host ignores it (\"role\"); its own offer is untouched", () => JSON.stringify(host.stats.ignored));
  evil.close();

  // The relay never learns what a kind is: an unknown kind passes straight through.
  const future = { v: 1, t: "offer", room, seq: 0, from: "NODEHOST", body: { offer: offerOf("quiz-pack", { anything: [1, 2, 3] }, "From the future", { oid: "FUTURE22", ver: 4 }) } };
  const okFrame = S.validate(future);
  host.ws.send(S.wireEncode(future, "*"));
  const futureSeen = await pollUntil(() => peers.every((p) => p.state().offer && p.state().offer.oid === "FUTURE22"));
  check(okFrame.ok && futureSeen.hit && peers.every((p) => p.state().offer.unsupported === "unsupported-kind" && !("data" in p.state().offer)), "an offer of a kind and version no build has heard of crosses the relay and is held by each peer as a bare \"can't open this\" note", () => JSON.stringify(peers.map((p) => p.state().offer)));

  // A seat that is offline when the host shares gets the share when it resumes - through the real relay, over real sockets.
  const room2 = "TANGO-WHISKEY-31";
  const host2 = nodeHost({ room: room2, wsBase, fp: "NODEHOST", name: "HOST-KILO", token: tokenStream(41), bankSig: "bank:10:x", pingMs: 300, missLimit: 3, holdMs: 30000 });
  const late2 = [];
  try {
    await host2.ready;
    const first = nodePeer({ room: room2, wsBase, fp: "PEERCCCC", name: "THREE", bankSig: "bank:10:x", pingMs: 300, missLimit: 3 });
    late2.push(first);
    await first.ready;
    first.hello();
    check((await pollUntil(() => host2.pending().length === 1)).hit, "a peer says hello to a second room through the relay");
    host2.act({ type: "admit", fp: "PEERCCCC" });
    check((await pollUntil(() => first.state().joinState === "seated")).hit, "...and is seated");
    const resumeToken = first.state().self.token;
    first.close();
    check((await pollUntil(() => host2.seats().find((s) => s.fp === "PEERCCCC" && !s.online))).hit, "its connection drops and the host marks the seat offline");
    const made2 = H.make("team-session", "Squad night", teamData());
    const shared2 = host2.act({ type: "offer", offer: made2.offer });
    const toOffline = host2.log.filter((e) => e.dir === "out" && e.frame && e.frame.t === "offer" && e.to === "PEERCCCC").length;
    check(shared2.accepted && toOffline === 0, "the host shares while the seat is offline: no offer frame is addressed to it (" + toOffline + ")", () => shared2.reason);
    const again2 = nodePeer({ room: room2, wsBase, fp: "PEERCCCC", name: "THREE", bankSig: "bank:10:x", pingMs: 300, missLimit: 3 });
    late2.push(again2);
    await again2.ready;
    again2.hello(resumeToken);
    const gotBack = await pollUntil(() => again2.state().offer && again2.state().offer.oid === host2.state().offer.oid);
    check(gotBack.hit, "the same seat reconnects with its resume token and HOLDS the host's current offer (" + gotBack.ms + " ms)", () => JSON.stringify(again2.state().offer));
    const inbound2 = again2.log.filter((e) => e.dir === "in" && e.frame).map((e) => e.frame.t).filter((t) => t === "welcome" || t === "offer");
    check(inbound2.join() === "welcome,offer", "it arrived right behind the welcome, in that order, exactly once (" + inbound2.join() + ")");
    check(again2.state().joinState === "seated" && host2.seats().find((s) => s.fp === "PEERCCCC").online, "and the seat is back: seated on the peer, online on the host");
  } catch (e) {
    bad("resume block: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
  } finally {
    for (const p of late2) p.close();
    host2.close();
  }
} catch (e) {
  bad("real relay block: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  for (const p of peers) p.close();
  if (host) host.close();
  if (srv) await srv.close();
  await rm(evidence, { force: true });
}

await finish("ROOM HANDOFF CORE");
