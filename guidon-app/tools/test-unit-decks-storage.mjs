/**
 * Unit decks and storage: the backup round trip, damaged rows, Guest and Kiosk saving
 * nothing, updating a deck, and the limit on how many a device keeps.
 *
 * WHY THIS SUITE EXISTS. A deck is a Soldier's own study material kept in one
 * "kv" row per deck. Three promises depend on that row being handled exactly right,
 * and none is visible until it goes wrong on somebody's phone:
 *
 *  1. A BACKUP carries it and a RESTORE brings it back - and a restore is a trust
 *     boundary: a backup file can be edited by hand or damaged, and a deck row is
 *     read by five study tools that trust every card and citation in it. So each
 *     defective row (an unknown key, a key that names another deck, a source that
 *     claims to be a word-for-word quote, a row that is not an object, more than 200
 *     cards) must be REFUSED, named in the Soldier's words ("your unit decks"), logged
 *     for Diagnostics, and must not stop the good rows around it from coming back. The
 *     same row check protects a row that is ALREADY on the device (a hand edit, a
 *     damaged copy): the app still starts, the deck is simply left out.
 *  2. GUEST AND KIOSK SESSIONS SAVE NOTHING. A deck may be added, switched off, studied,
 *     graded and removed in one - and the device (every IndexedDB store and every
 *     localStorage key, read underneath the app) must be byte for byte what it was, a
 *     real owner's deck already on it must be neither changed nor deleted, and after a
 *     reload the session's deck is gone. The same actions under a real profile DO reach
 *     the device, so that cannot pass because saving is broken.
 *  3. UPDATING: adding a newer version of a deck (same id) replaces it, keeps the
 *     Soldier's progress on the cards that remain, and leaves a deck they had switched
 *     off switched off. The device keeps at most 10 decks; the 11th is refused in plain
 *     words, while replacing one already there is still allowed.
 *
 * The deck is tools/fixtures/unit-pack-example.pack.json (fictional).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, check, finish, waitForRoute, clickWhenStable, until, untilAsync, expectNoConsoleNoise } from "./testkit.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { OWNER_PROFILE, deviceDump, deviceKvGet, putOnDevice } from "./device-storage.mjs";
import { loadUnitPackKit } from "./unit-pack-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "unit-pack-example.pack.json");
const PACK = JSON.parse(readFileSync(FIXTURE, "utf8"));
const DECK = PACK.id;
const P = loadUnitPackKit().unitPack;
const clone = (x) => JSON.parse(JSON.stringify(x));
const ROW = P.toDeck(PACK, { importedAt: "2026-09-26T12:00:00.000Z" });
const SRS = { reps: 1, ease: 2.5, interval: 1, due: 4102444800000, misses: 0, lastGrade: 2 };

const boot = await bootApp({ viewport: { width: 1000, height: 900 }, profile: OWNER_PROFILE, noiseLevels: ["error"] });
const { page, noise } = boot;

const kv = (k) => page.evaluate(async (k) => { const r = await G.db.get("kv", k); return r ? r.v : null; }, k);
const keys = (prefix) => page.evaluate(async (p) => (await G.db.all("kv")).map((r) => r.k).filter((k) => typeof k === "string" && k.indexOf(p) === 0).sort(), prefix);
const deckIds = () => page.evaluate(() => G.unitDecks.list().map((d) => d.id).sort());
const pack = (over) => Object.assign(clone(PACK), over);

/* ================================================================= 1. backup and restore */
await waitForRoute(page, "#/home", { ready: "#route h1, #route h2" });
{
  const label = await page.evaluate(() => G.backup.describeKey("unit-deck:pinecone-ridge-demo"));
  check(label === "your unit decks", "a restore that leaves a deck out calls it \"your unit decks\", not a raw key", () => label);
  const sum = await page.evaluate(() => G.backup.skippedSummary(["unit-deck:a", "unit-deck:b"]));
  check(sum === "2 damaged items were left out: your unit decks (2). Everything else was restored.", "and the summary reads plainly", () => sum);

  await page.evaluate(async (p) => { await G.unitDecks.add(p); await G.unitDecks.setEnabled(p.id, false); }, PACK);
  await page.evaluate(async (s) => { await G.db.put("kv", { k: "srs:unit:pinecone-ridge-demo:sop-001", v: s }); }, SRS);
  const payload = await page.evaluate(async () => await G.backup.exportAll());
  const rows = payload.stores.kv.filter((r) => /^unit-deck:/.test(r.k));
  check(rows.length === 1 && rows[0].k === "unit-deck:" + DECK && rows[0].v.enabled === false && rows[0].v.cards.length === 8, "a backup carries the deck (one row, with its on/off state)", () => JSON.stringify(rows).slice(0, 200));
  check(payload.stores.kv.some((r) => r.k === "srs:unit:pinecone-ridge-demo:sop-001"), "and the progress on its cards");
  check(!JSON.stringify(payload).includes("guidon:leader:roster"), "and the deck is not treated as private roster data (it travels by default, like My unit texts)");

  await page.evaluate(async () => { await G.db.del("kv", "unit-deck:pinecone-ridge-demo"); await G.db.del("kv", "srs:unit:pinecone-ridge-demo:sop-001"); await G.unitDecks.load(); });
  check((await deckIds()).length === 0, "after the deck is wiped from the device it is gone");
  const res = await page.evaluate(async (p) => { const r = await G.backup.importAll(p); await G.unitDecks.load(); return r; }, payload);
  check(res.skipped.kv === 0 && res.restored.kv >= 2, "restoring the backup brings back the deck and its progress, skipping nothing", () => JSON.stringify(res));
  const back = await page.evaluate(() => ({ list: G.unitDecks.list(), cards: G.unitDecks.cards().length }));
  check(back.list.length === 1 && back.list[0].id === DECK && back.list[0].enabled === false && back.cards === 0, "the deck is back, still switched OFF (so none of its cards show)", () => JSON.stringify(back));
  check((await kv("srs:unit:pinecone-ridge-demo:sop-001")) !== null, "and its progress is back");
  await page.evaluate(async () => { await G.unitDecks.setEnabled("pinecone-ridge-demo", true); });
  check((await page.evaluate(() => G.unitDecks.cards().length)) === 8, "switched on again, its 8 cards are back in the study pool");
}
{ // damaged rows in a backup: each refused, named, logged; the good ones still restored
  const good = clone(ROW); good.id = "good-one"; good.name = "Good deck";
  const html = clone(ROW); html.id = "html-text"; html.name = "Deck <b>bold</b>"; html.cards[0].q = "<img src=x onerror=alert(1)> Q?";
  const extraKey = clone(ROW); extraKey.id = "extra-key"; extraKey.evil = 1;
  const mismatch = clone(ROW); mismatch.id = "someone-else";
  const verbatim = clone(ROW); verbatim.id = "claims-quote"; verbatim.cards[0].source[0].quoteKind = "verbatim";
  const tooMany = clone(ROW); tooMany.id = "too-many"; tooMany.cards = Array.from({ length: 201 }, (_, i) => ({ id: "c" + i, category: "C", q: "Q" + i, a: "A", keyPoints: [] }));
  const cardKey = clone(ROW); cardKey.id = "card-key"; cardKey.cards[1].script = "x";
  const oldSchema = clone(ROW); oldSchema.id = "old-schema"; oldSchema.schema = 9;
  const badRows = [
    { k: "unit-deck:extra-key", v: extraKey }, { k: "unit-deck:key-mismatch", v: mismatch }, { k: "unit-deck:claims-quote", v: verbatim },
    { k: "unit-deck:not-object", v: "just text" }, { k: "unit-deck:too-many", v: tooMany }, { k: "unit-deck:card-key", v: cardKey }, { k: "unit-deck:old-schema", v: oldSchema },
  ];
  const payload = { schema: (await page.evaluate(async () => (await G.backup.exportAll()).schema)), exportedAt: new Date().toISOString(), stores: { kv: [{ k: "unit-deck:good-one", v: good }, { k: "unit-deck:html-text", v: html }].concat(badRows), userScenarios: [], attempts: [] } };
  const res = await page.evaluate(async (p) => { const r = await G.backup.importAll(p); await G.unitDecks.load(); return r; }, payload);
  check(res.skipped.kv === badRows.length && JSON.stringify(res.skippedKeys.slice().sort()) === JSON.stringify(badRows.map((r) => r.k).sort()), `each of the ${badRows.length} defective rows is refused and named`, () => JSON.stringify(res));
  const say = await page.evaluate((k) => G.backup.skippedSummary(k), res.skippedKeys);
  check(new RegExp("^" + badRows.length + " damaged items were left out: your unit decks \\(" + badRows.length + "\\)\\. Everything else was restored\\.$").test(say), "and the screen says so in words (your unit decks)", () => say);
  const ids = await deckIds();
  check(ids.includes("good-one") && ids.includes("html-text") && ids.includes(DECK) && ids.length === 3, "the good rows around them came back (and the row with markup in its text is fine - it is only text)", () => JSON.stringify(ids));
  check((await keys("unit-deck:")).every((k) => !/extra-key|key-mismatch|claims-quote|not-object|too-many|card-key|old-schema/.test(k)), "none of the refused rows reached the device");
  const logged = await page.evaluate(async () => (await G.selfheal.recent(60)).filter((e) => e.kind === "kv-reject").map((e) => e.key));
  check(badRows.every((r) => logged.includes(r.k)), "every refusal is logged for Diagnostics (kv-reject)", () => JSON.stringify(logged));
  await page.evaluate(async () => { await G.unitDecks.remove("good-one"); await G.unitDecks.remove("html-text"); });
}
{ // a damaged row ALREADY on the device: the app still starts, the deck is left out
  const bad = clone(ROW); bad.id = "damaged"; bad.cards[0].evil = "x";
  await putOnDevice(page, { stores: { kv: [{ k: "unit-deck:damaged", v: bad }, { k: "unit-deck:wrong-key", v: Object.assign(clone(ROW), { id: "another-id" }) }] } });
  await page.reload({ waitUntil: "load" });
  await waitForRoute(page, "#/home", { ready: "#route h1, #route h2" });
  await until(page, () => G.store && G.unitDecks && G.unitDecks.list().length > 0);
  const ids = await deckIds();
  check(JSON.stringify(ids) === JSON.stringify([DECK]), "with a damaged row and a mis-keyed row on the device the app starts and lists only the sound deck", () => JSON.stringify(ids));
  const logged = await page.evaluate(async () => (await G.selfheal.recent(60)).filter((e) => e.kind === "kv-reject").map((e) => e.key));
  check(logged.includes("unit-deck:damaged") && logged.includes("unit-deck:wrong-key"), "and both are logged for Diagnostics", () => JSON.stringify(logged));
  await page.evaluate(async () => { await G.db.del("kv", "unit-deck:damaged"); await G.db.del("kv", "unit-deck:wrong-key"); });
}

/* ================================================================= 3. updating, and the limit */
{
  await page.evaluate(async (p) => { await G.unitDecks.setEnabled(p.id, false); }, PACK);
  const newer = pack({ packVersion: "2026.10", packDate: "2026-10-05", name: "Pinecone Ridge Demo Squadron study deck (2nd edition)" });
  newer.cards = newer.cards.filter((c) => c.id !== "board-002");            // one card retired
  newer.cards[0].a = "Formation is at 0645. Be in place by 0635.";           // one card reworded, same id
  newer.cards.push({ id: "sop-004", category: "Local SOP", q: "Who signs the weekend duty roster?", a: "The first sergeant." });
  const inspect = await page.evaluate(async (p) => { const r = await G.unitDecks.inspect(p); return { ok: r.ok, replaces: r.replaces }; }, newer);
  check(inspect.ok && inspect.replaces && inspect.replaces.packVersion === "2026.09" && inspect.replaces.enabled === false, "the import check knows it is an update and what it replaces", () => JSON.stringify(inspect));
  const res = await page.evaluate(async (p) => await G.unitDecks.add(p), newer);
  check(res.ok && res.replaced === true, "adding the newer version REPLACES the deck (same id)", () => JSON.stringify(res));
  const row = await kv("unit-deck:" + DECK);
  check(row.packVersion === "2026.10" && row.cards.length === 8 && row.cards[0].a.startsWith("Formation is at 0645") && row.name.endsWith("(2nd edition)"), "the new wording, new cards and new version are what is kept", () => JSON.stringify([row.packVersion, row.cards.length]));
  check(row.enabled === false && (await page.evaluate(() => G.unitDecks.cards().length)) === 0, "a deck the Soldier had switched off stays OFF after the update");
  check((await kv("srs:unit:pinecone-ridge-demo:sop-001")) !== null, "progress on a card that is still in the deck (same id) is kept");
  await page.evaluate(async (s) => { await G.db.put("kv", { k: "srs:unit:pinecone-ridge-demo:board-002", v: s }); }, SRS);
  await page.evaluate(async (p) => { await G.unitDecks.add(p); }, newer);
  check((await kv("srs:unit:pinecone-ridge-demo:board-002")) !== null, "and an update never deletes anyone's progress behind their back (a retired card's row stays)");
  await page.evaluate(async () => { await G.unitDecks.remove("pinecone-ridge-demo", { deleteHistory: true }); });
  check((await keys("srs:unit:pinecone-ridge-demo:")).length === 1, "(Remove with \"delete\" clears the rows of the cards the deck HAS; a retired card's leftover is the only one that stays)", async () => JSON.stringify(await keys("srs:unit:")));
  await page.evaluate(async () => { await G.db.del("kv", "srs:unit:pinecone-ridge-demo:board-002"); });
}
{
  const many = await page.evaluate(async () => {
    const mk = (i) => ({ format: "guidon-unit-pack", formatVersion: 1, id: "deck-" + i, name: "Deck " + i, packVersion: "1", packDate: "2026-09-26", cards: [{ id: "c1", category: "C", q: "Question " + i + "?", a: "Answer " + i }] });
    const out = [];
    for (let i = 1; i <= 10; i++) out.push((await G.unitDecks.add(mk(i))).ok);
    const eleventh = await G.unitDecks.add(mk(11));
    const replace = await G.unitDecks.add(Object.assign(mk(3), { packVersion: "2" }));
    return { out, eleventh, replace, n: G.unitDecks.list().length };
  });
  check(many.out.every(Boolean) && many.n === 10, "ten decks fit");
  check(many.eleventh.ok === false && many.eleventh.stage === "limit" && /already have 10 unit decks/.test(many.eleventh.messages[0]) && /Remove one first/.test(many.eleventh.messages[0]), "the eleventh is refused in plain words (remove one first)", () => JSON.stringify(many.eleventh));
  check(many.replace.ok === true && many.replace.replaced === true && many.n === 10, "but replacing one that is already there is allowed at the limit");
  await page.evaluate(async () => { for (let i = 1; i <= 10; i++) await G.unitDecks.remove("deck-" + i); });
  check((await keys("unit-deck:")).length === 0, "and removing them leaves no row behind");
}
{ // an owner's session really writes to the device (so the Guest checks below cannot pass because saving is broken)
  await page.evaluate(async (p) => { await G.unitDecks.add(p); }, PACK);
  const onDevice = await deviceKvGet(page, "unit-deck:" + DECK);
  check(!!onDevice && onDevice.v.id === DECK, "under a real profile the deck IS on the device (read underneath the app)");
  await page.evaluate(async () => { await G.unitDecks.remove("pinecone-ridge-demo", { deleteHistory: true }); });
  check(!(await deviceKvGet(page, "unit-deck:" + DECK)), "and removing it takes the row off the device");
}

/* ================================================================= 2. Guest and Kiosk save nothing */
// Two dumps in a row are identical once boot housekeeping is over; paced by animation frames, not by sleeping.
async function settledDump(p) {
  let last = JSON.stringify(await deviceDump(p));
  for (let i = 0; i < 40; i++) {
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const now = JSON.stringify(await deviceDump(p));
    if (now === last && i >= 3) return now;
    last = now;
  }
  return last;
}
// The owner's own deck: different cards and categories from the fixture, so the session's deck is the one Board Drill shows.
const OWNER_ROW = P.toDeck({ format: "guidon-unit-pack", formatVersion: 1, id: "owner-deck", name: "Owner's own deck", packVersion: "1", packDate: "2026-09-01",
  cards: [{ id: "sop-001", category: "Owner topics", q: "Which door does the owner's troop use?", a: "The east door." }, { id: "sop-002", category: "Owner topics", q: "Who keeps the owner's keys?", a: "The armorer." }] }, { importedAt: "2026-09-01T00:00:00.000Z" });
// A diff that names the row, for a device that changed when it should not have.
const whatChanged = (a, b) => {
  const A = JSON.parse(a), B = JSON.parse(b), out = [];
  for (const s of new Set([...Object.keys(A.stores), ...Object.keys(B.stores)])) {
    const ma = new Map((A.stores[s] || []).map((r) => [String(r && (r.k != null ? r.k : r.id != null ? r.id : r.key)), JSON.stringify(r)]));
    const mb = new Map((B.stores[s] || []).map((r) => [String(r && (r.k != null ? r.k : r.id != null ? r.id : r.key)), JSON.stringify(r)]));
    for (const k of new Set([...ma.keys(), ...mb.keys()])) if (ma.get(k) !== mb.get(k)) out.push(s + ":" + k + (ma.has(k) ? "" : " (added)") + (mb.has(k) ? "" : " (removed)"));
  }
  for (const k of new Set([...Object.keys(A.local), ...Object.keys(B.local)])) if (A.local[k] !== B.local[k]) out.push("localStorage:" + k);
  return out.join(", ");
};

for (const mode of ["guest", "kiosk"]) {
  const s = await boot.openSession({ viewport: { width: 1000, height: 900 }, profile: null, noiseLevels: ["error"], noise });
  const g = s.page;
  // What a real owner left on this device before anyone opened a session.
  await g.waitForFunction(() => !!(window.G && window.G.db && typeof window.G.db.put === "function"));
  await putOnDevice(g, { stores: { kv: [{ k: "unit-deck:owner-deck", v: OWNER_ROW }, { k: "srs:unit:owner-deck:sop-001", v: SRS }] } });
  await g.reload({ waitUntil: "load" });
  await dismissOnboarding(g, { mode });
  await waitForRoute(g, "#/home", { ready: "#route h1, #route h2" });
  await until(g, () => G.unitDecks && G.unitDecks.list().some((d) => d.id === "owner-deck"));
  const baseline = await settledDump(g);
  check(/unit-deck:owner-deck/.test(baseline), `${mode}: the owner's deck is on the device before the session starts`);

  // Add a deck through the real screen (file, preview, confirm).
  await waitForRoute(g, "#/settings", { fresh: true, ready: "#settings-unitdecks-panel" });
  await clickWhenStable(g, g.locator("[data-unit-deck-open]"));
  await g.locator("[data-unit-deck-file]").setInputFiles(FIXTURE);
  await clickWhenStable(g, g.locator("[data-unit-deck-check]"));
  await g.waitForSelector("[data-unit-deck-preview]");
  await clickWhenStable(g, g.locator("[data-unit-deck-confirm-add]"));
  await until(g, (id) => !!document.querySelector('[data-unit-deck="' + id + '"]'), DECK);
  check((await g.evaluate(() => G.unitDecks.list().map((d) => d.id).sort())).join() === "owner-deck," + DECK, `${mode}: the deck can be added and works for the session (both decks are listed)`);
  const inDrill = await (async () => {
    await waitForRoute(g, "#/board", { fresh: true, ready: ".qz-card" });
    await clickWhenStable(g, g.locator('[aria-label="Jump to category"] .list-detail-row', { has: g.locator(".ldr-name", { hasText: /^Unit: Local SOP$/ }) }));
    await until(g, () => { const l = document.querySelector(".qz-front .kc-label"); return !!l && l.textContent.indexOf("Unit: Local SOP") === 0; });
    return g.evaluate(() => (document.querySelector(".qz-front .unit-deck-tag") || {}).textContent || "");
  })();
  check(inDrill === "Unit deck: " + PACK.name, `${mode}: its cards are in Board Drill for the session`, () => inDrill);
  // Grade a unit card (keyboard, as a Soldier does), switch the owner's deck off, remove and re-add, reset progress.
  await g.evaluate(() => document.querySelector(".qz-wrap").focus());
  await g.keyboard.press("Space");
  await g.waitForSelector(".qz-card.flipped");
  await g.keyboard.press("3");
  await untilAsync(g, async () => (await G.db.all("kv")).some((r) => typeof r.k === "string" && r.k.indexOf("srs:unit:pinecone-ridge-demo:") === 0));
  check((await g.evaluate(async () => (await G.db.all("kv")).filter((r) => String(r.k).indexOf("srs:unit:pinecone-ridge-demo:") === 0).length)) === 1, `${mode}: grading a unit card works in the session`);
  await g.evaluate(async () => { await G.unitDecks.setEnabled("owner-deck", false); });
  await g.evaluate(async () => { await G.unitDecks.remove("pinecone-ridge-demo", { deleteHistory: true }); });
  await g.evaluate(async (p) => { await G.unitDecks.add(p); await G.unitDecks.resetHistory("owner-deck"); }, PACK);
  const view = await g.evaluate(() => ({ decks: G.unitDecks.list().map((d) => d.id + ":" + d.enabled).sort(), cards: G.unitDecks.cards().length }));
  check(JSON.stringify(view.decks) === JSON.stringify(["owner-deck:false", DECK + ":true"]) && view.cards === 8, `${mode}: switching off, removing, re-adding and resetting all worked in the session`, () => JSON.stringify(view));
  // ...and the device is untouched.
  const after = await settledDump(g);
  check(after === baseline, `${mode}: the device is byte for byte what it was before the session (IndexedDB and localStorage, read underneath the app)`, () => "the device changed: " + whatChanged(baseline, after));
  const onDev = await deviceKvGet(g, "unit-deck:" + DECK);
  const owner = await deviceKvGet(g, "unit-deck:owner-deck");
  check(!onDev && owner && owner.v.enabled === true && JSON.stringify(owner.v) === JSON.stringify(OWNER_ROW), `${mode}: the session's deck never reached the device, and the owner's deck is unchanged (still on, not removed)`);
  const srsInSession = await g.evaluate(async () => { const r = await G.db.get("kv", "srs:unit:owner-deck:sop-001"); return !!r; });
  check(srsInSession === false, `${mode}: inside the session the owner deck's progress reads as reset (a tombstone in memory)`, "the session still sees the progress it reset");
  const devSrs = await deviceKvGet(g, "srs:unit:owner-deck:sop-001");
  check(!!devSrs && devSrs.v.lastGrade === 2, `${mode}: the owner's saved progress on their own deck is still on the device`);
  // After a reload the session is gone and so is its deck. (Leave the Board Drill first: the address keeps
  // its hash across a reload, and a screen drawn before a mode is chosen saves its own hint flag as usual.)
  await waitForRoute(g, "#/home", { ready: "#route h1, #route h2" });
  await g.reload({ waitUntil: "load" });
  await dismissOnboarding(g, { mode });
  await waitForRoute(g, "#/home", { ready: "#route h1, #route h2" });
  const gone = await deviceKvGet(g, "unit-deck:" + DECK);
  const still = await g.evaluate(() => G.unitDecks.list().map((d) => d.id + ":" + d.enabled).sort());
  check(!gone && JSON.stringify(still) === JSON.stringify(["owner-deck:true"]), `${mode}: after a reload the session's deck is gone and the owner's deck is as they left it`, () => JSON.stringify(still));
  const final = await settledDump(g);
  check(final === baseline, `${mode}: and the device is still byte for byte unchanged`, () => "the device changed after the reload: " + whatChanged(baseline, final));
  await s.context.close();
}

expectNoConsoleNoise(noise);
await finish("UNIT DECKS STORAGE");
