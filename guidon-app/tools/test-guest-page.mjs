/**
 * Guest page (collective P3b, X2 / Q5): dist/guest.html is a build artifact
 * tools/build.mjs emits from the same source as the app - the schema module
 * verbatim, the room module's pure core lifted between its two marker
 * comments, and src/guest.html's tiny card/score view - stamped
 * window.GUIDON_FORK = "guest". It is what a room host serves to a phone
 * that has nothing installed: plain http, insecure context, no crypto.subtle,
 * no camera, no wake lock, nothing stored. Written BEFORE the artifact
 * exists - its first run is the RED baseline.
 *
 *   (1) the artifact: < 200 KB, LF-only, the fork marker exactly once, the
 *       EXACT text of src/app-modules/room-schema.js inside it, and no
 *       reference to crypto.subtle / getUserMedia / wakeLock anywhere
 *   (2) byte identity: what tools/room-server.mjs serves at / and at
 *       /j/<code> equals dist/guest.html byte for byte
 *   (3) one Chromium at http://127.0.0.1:<port>/j/<code> (plain http): the
 *       page joins a room hosted by tools/room-node-host.mjs (the app's own
 *       pure core over a real socket - the Rust/Kotlin stand-in), is
 *       admitted by hand, readies, sees the card text ride inline (its
 *       bankSig differs), scores a Mock Board card on the 3-point scale,
 *       and the host's tally shows that score; the page ends in the ended
 *       state; localStorage / IndexedDB / cookies stay empty; the guest's
 *       hello carries the stamped build fields; zero page errors
 *
 * Usage: node tools/test-guest-page.mjs   (exit code = FAIL count)
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startRoomServer } from "./room-server.mjs";
import { nodeHost, nodePeer } from "./room-node-host.mjs";
import { launchEngine, closeEngines } from "./xeng-harness.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, limit = 8000, step = 50) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try { value = await pred(); } catch (e) { value = null; }
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}
const WATCHDOG_MS = 150000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nGUEST PAGE: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const GUEST = resolve("dist/guest.html");

console.log("test-guest-page: artifact checks, byte identity, then one Chromium joining a Node-hosted board over plain http\n");
let srv = null, host = null, cand = null;
try {
  /* ---------------- (1) the artifact ---------------- */
  const buf = await readFile(GUEST).catch(() => null);
  if (!buf) { bad("(1) dist/guest.html does not exist (npm run build should emit it)"); throw new Error("no artifact - RED"); }
  const text = buf.toString("utf8");
  buf.length < 200 * 1024 ? ok("(1) dist/guest.html is " + buf.length + " bytes (< 200 KB)") : bad("(1) dist/guest.html is " + buf.length + " bytes (limit 200 KB)");
  !text.includes("\r") ? ok("(1) LF-only") : bad("(1) CR bytes present");
  const marks = text.split('window.GUIDON_FORK = "guest";').length - 1;
  marks === 1 ? ok("(1) window.GUIDON_FORK = \"guest\" occurs exactly once") : bad("(1) fork marker occurs " + marks + " times");
  const schemaSrc = await readFile("src/app-modules/room-schema.js", "utf8");
  text.includes(schemaSrc.trim()) ? ok("(1) the exact text of src/app-modules/room-schema.js is inside the guest page (ONE schema module)") : bad("(1) the schema module text is not embedded verbatim");
  const forbidden = [/crypto\.subtle/, /\.subtle\b/, /getUserMedia/, /wakeLock/, /mediaDevices/, /localStorage/, /indexedDB/, /sessionStorage/, /document\.cookie/];
  const hits = forbidden.filter((re) => re.test(text)).map(String);
  hits.length === 0 ? ok("(1) no reference to crypto.subtle / getUserMedia / wakeLock / mediaDevices / any storage API") : bad("(1) forbidden references: " + hits.join(" "));
  /^[\x00-\x7f]*$/.test(text) ? ok("(1) ASCII-only") : info("(1) non-ASCII bytes present (allowed, noted)");
  const sha = (text.match(/window\.GUIDON_BUILD_SHA = "([0-9a-f]*)"/) || [])[1];
  const app = (text.match(/window\.GUIDON_APP_VERSION = "([^"]*)"/) || [])[1];
  typeof sha === "string" && app ? ok("(1) build stamps present: app " + app + ", sha " + (sha ? sha.slice(0, 7) : "(empty: no git)")) : bad("(1) build stamps missing");

  /* ---------------- (2) byte identity through the server ---------------- */
  srv = await startRoomServer({ loopback: true, port: 0, guest: GUEST, quiet: true });
  const base = "http://127.0.0.1:" + srv.port;
  const wsBase = "127.0.0.1:" + srv.port;
  for (const p of ["/", S.ENDPOINTS.join + "KILO-LIMA-11"]) {
    const r = await fetch(base + p);
    const b = Buffer.from(await r.arrayBuffer());
    b.equals(buf) ? ok("(2) GET " + p + " equals dist/guest.html byte for byte (" + b.length + " bytes)") : bad("(2) GET " + p + ": " + r.status + ", " + b.length + " bytes vs " + buf.length);
  }

  /* ---------------- (3) the guest joins a Node-hosted board ---------------- */
  const ids = ["gq1", "gq2"];
  const cards = { gq1: { q: "State the first line of the NCO Creed.", a: "No one is more professional than I.", category: "Creeds" }, gq2: { q: "How many stanzas does the Soldier's Creed have?", a: "Thirteen lines in one stanza.", category: "Creeds" } };
  host = nodeHost({ wsBase, mode: "board", ids, cards, category: "Creeds", name: "NODE-HOST", pingMs: 1000, missLimit: 3, holdMs: 8000 });
  const ROOM = await host.ready;
  ok("(3) Node host (the app's pure core over a real socket) opened board room " + ROOM);
  cand = nodePeer({ wsBase, room: ROOM, fp: "CANDCAND", name: "CANDIDATE" });
  await cand.ready;
  cand.hello();
  const candPending = await until(() => host.pending().some((p) => p.fp === "CANDCAND") ? true : null);
  candPending.hit ? ok("(3) the Node candidate's hello is pending on the host") : bad("(3) candidate hello never arrived");
  host.act({ type: "admit", fp: "CANDCAND" });
  const candSeated = await until(() => { const s = cand.state(); return s.joinState === "seated" ? s.self.seatNo : null; });
  candSeated.hit && candSeated.value === 2 ? ok("(3) the candidate is seat 2") : bad("(3) candidate seat: " + JSON.stringify(candSeated));

  const browser = await launchEngine("chromium");
  const page = await (await browser.newContext()).newPage();
  const noise = [];
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(base + S.ENDPOINTS.join + ROOM, { waitUntil: "load" });
  const boot = await page.evaluate(() => ({ fork: window.GUIDON_FORK, schema: !!(window.G && G.roomSchema), core: !!(window.G && G.roomCore && G.roomCore.initPeer), code: (document.querySelector(".gp-code") || { value: "" }).value, secure: window.isSecureContext, proto: location.protocol }));
  boot.fork === "guest" && boot.schema && boot.core ? ok("(3) the page runs as the guest fork with G.roomSchema and G.roomCore (the lifted pure core)") : bad("(3) boot: " + JSON.stringify(boot));
  boot.code === ROOM ? ok("(3) the room code is pre-filled from /j/" + ROOM) : bad("(3) code field: " + JSON.stringify(boot.code));
  info("(3) origin " + boot.proto + " isSecureContext=" + boot.secure + " (127.0.0.1 is potentially trustworthy; a LAN IP is not - the page uses nothing that needs it either way)");
  await page.fill(".gp-name", "PHONE-GUEST");
  await page.click(".gp-join");
  const guestPending = await until(() => { const p = host.pending().find((x) => x.name === "PHONE-GUEST"); return p ? p : null; });
  guestPending.hit ? ok("(3) the guest's hello reached the host over the socket in " + guestPending.ms + " ms (fp " + guestPending.value.fp + ", bankSig " + JSON.stringify(guestPending.value.bankSig) + ")") : bad("(3) guest hello never arrived: pending " + JSON.stringify(host.pending()));
  const gfp = guestPending.value ? guestPending.value.fp : null;
  const helloIn = host.log.find((x) => x.dir === "in" && x.frame.t === "hello" && x.frame.from === gfp);
  helloIn && helloIn.frame.body.app === app && (helloIn.frame.body.build || "") === (sha || "") ? ok("(3) the guest's hello carries the stamped build fields (app " + helloIn.frame.body.app + ")") : bad("(3) guest hello body: " + JSON.stringify(helloIn && helloIn.frame.body));
  const waitingCopy = await until(() => page.evaluate(() => /waiting for the host/i.test(document.body.textContent) ? true : null));
  waitingCopy.hit ? ok("(3) the guest sees \"Waiting for the host\" (admit-each; no admit-all exists anywhere)") : bad("(3) pending copy missing");
  const ledger = await page.evaluate(() => window.G.netLedger ? G.netLedger.list().length : -1);
  ledger === 1 ? ok("(3) the guest page's G.netLedger records exactly one connection") : bad("(3) guest ledger: " + ledger);
  host.act({ type: "admit", fp: gfp });
  const seated = await until(() => page.evaluate(() => { const s = window.__guestState && window.__guestState(); return s && s.joinState === "seated" ? s.self.seatNo : null; }));
  seated.hit && seated.value === 3 ? ok("(3) admitted: the guest is seat 3 (" + seated.ms + " ms)") : bad("(3) guest seat: " + JSON.stringify(seated));
  const rosterRows = await until(() => page.evaluate(() => document.querySelectorAll(".gp-seat").length === 3 ? 3 : null));
  rosterRows.hit ? ok("(3) the guest renders the 3-seat roster") : bad("(3) roster rows: " + JSON.stringify(rosterRows.value));
  await page.click(".gp-ready");
  cand.intent({ kind: "ready" });
  const readyAll = await until(() => host.seats().filter((s) => s.ready).length === 3 ? true : null);
  readyAll.hit ? ok("(3) both ready intents tallied on the host") : bad("(3) ready: " + JSON.stringify(host.seats()));
  host.act({ type: "start" });
  const card = await until(() => page.evaluate(() => { const q = document.querySelector(".gp-q"); return q && q.textContent.trim().length > 10 ? q.textContent.trim() : null; }));
  card.hit && card.value === cards.gq1.q ? ok("(3) the card text rides inline (guest bankSig differs) and renders: \"" + card.value + "\"") : bad("(3) card on guest: " + JSON.stringify(card.value));
  const noScoreYet = await page.evaluate(() => document.querySelectorAll(".gp-score").length);
  noScoreYet === 0 ? ok("(3) no score buttons before the candidate answers") : bad("(3) score buttons shown early: " + noScoreYet);
  cand.intent({ kind: "answer" });
  const answerShown = await until(() => page.evaluate(() => { const a = document.querySelector(".gp-a"); return a && a.textContent.trim().length > 5 ? a.textContent.trim() : null; }));
  answerShown.hit && answerShown.value === cards.gq1.a ? ok("(3) the doctrinal answer appears after the candidate's answer intent") : bad("(3) answer on guest: " + JSON.stringify(answerShown.value));
  const scoreBtns = await until(() => page.evaluate(() => document.querySelectorAll(".gp-score").length === 3 ? 3 : null));
  scoreBtns.hit ? ok("(3) three score buttons (0/1/2 points, the 3-point answerScale)") : bad("(3) score buttons: " + JSON.stringify(scoreBtns.value));
  await page.click('.gp-score[data-value="2"]');
  const tallied = await until(() => { const sc = host.scores(); const per = sc["0"] || {}; return per["3"] === 2 ? per : null; });
  tallied.hit ? ok("(3) the guest's score intent (value 2) is tallied on the host for seat 3: " + JSON.stringify(tallied.value) + " (" + tallied.ms + " ms)") : bad("(3) host scores: " + JSON.stringify(host.scores()));
  const candScore = host.seats().find((s) => s.seatNo === 2).score;
  candScore === 2 ? ok("(3) the candidate's seat shows the awarded 2 points") : bad("(3) candidate score " + candScore);
  host.act({ type: "advance" });
  const card2 = await until(() => page.evaluate(() => { const q = document.querySelector(".gp-q"); return q && /stanzas/i.test(q.textContent) ? true : null; }));
  card2.hit ? ok("(3) host advanced: card 2 rendered on the guest") : bad("(3) card 2 missing");
  host.act({ type: "advance" });
  const recap = await until(() => page.evaluate(() => { const s = window.__guestState(); return s.phase === "recap" ? true : null; }));
  recap.hit ? ok("(3) recap reached the guest") : bad("(3) recap missing");
  host.act({ type: "end" });
  const ended = await until(() => page.evaluate(() => !!document.querySelector(".gp-terminal[data-kind=ended]")));
  ended.hit ? ok("(3) end -> the guest shows the ended state") : bad("(3) ended state missing");
  const storage = await page.evaluate(async () => ({ ls: localStorage.length, ss: sessionStorage.length, cookie: document.cookie, idb: (await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]))).length }));
  storage.ls === 0 && storage.ss === 0 && storage.cookie === "" && storage.idb === 0 ? ok("(3) nothing stored: localStorage 0, sessionStorage 0, no cookie, 0 IndexedDB databases") : bad("(3) storage: " + JSON.stringify(storage));
  const external = requests.filter((u) => !u.startsWith(base));
  external.length === 0 ? ok("(3) every request stayed on the room server's origin (" + requests.length + " requests)") : bad("(3) external requests: " + external.join(", "));
  noise.length === 0 ? ok("(3) zero page errors / console errors on the guest page") : bad("(3) noise: " + noise.slice(0, 3).join(" | "));
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await closeEngines().catch(() => {});
  if (cand) cand.close();
  if (host) host.close();
  if (srv) await srv.close().catch(() => {});
}
console.log("\n" + (fails ? `GUEST PAGE: ${fails} FAILURE(S)` : "GUEST PAGE: all passed"));
process.exit(fails ? 1 : 0);
