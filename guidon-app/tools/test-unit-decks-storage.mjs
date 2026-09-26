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
 *  1b. THE RESTORE AND THE START-UP ARE THE SAME GATE AS THE IMPORT. The screen that refuses a deck holding a Social Security number, a
 *     marking, a roster or a hidden character runs again on every saved row - one that arrives in a backup and one already on the
 *     device - and so does a size cap and a limit of 10 decks. A hand-built backup therefore cannot bring in what the import would have
 *     refused, and an over-full device keeps its 10 oldest decks and says which it left out. Names like "constructor" are ordinary
 *     deck ids (the 10-deck limit and the "replaces" notice do not mistake them for something already there).
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
{ // the restore is a trust boundary: a row that never went past the import check gets the import's screen
  const dirty = (id, mutate) => { const r = clone(ROW); r.id = id; r.name = "Deck " + id; mutate(r); return { k: "unit-deck:" + id, v: r }; };
  const bigRow = dirty("too-big", (r) => { r.cards = Array.from({ length: 200 }, (_, i) => ({ id: "c" + i, category: "C", q: "Question number " + i + "?", a: "a".repeat(1200), keyPoints: Array.from({ length: 8 }, () => "k".repeat(200)) })); });
  const bad = [
    dirty("has-ssn", (r) => { r.cards[1].a = "Use 123-45-6789 to look it up."; }),
    dirty("has-marking", (r) => { r.cards[0].q = "Is this SECRET//NOFORN?"; }),
    dirty("has-roster", (r) => { r.cards[0].keyPoints = ["SGT Smith", "SSG Jones", "SPC Brown"]; }),
    dirty("has-spread-roster", (r) => { r.cards = ["SGT Smith", "SSG Jones", "SPC Brown", "CPL Green", "PFC White", "PVT Black", "SFC Gray"].map((n, i) => ({ id: "n" + i, category: "C", q: "Who is number " + i + "?", a: n, keyPoints: [] })); }),
    dirty("has-email", (r) => { r.unit = "Alpha a.b@example.com"; }),
    dirty("has-fullwidth-ssn", (r) => { r.cards[1].a = "\uFF11\uFF12\uFF13-\uFF14\uFF15-\uFF16\uFF17\uFF18\uFF19"; }),
    dirty("has-zwsp", (r) => { r.cards[0].q = "Formation\u200B time?"; }),
    dirty("nine-sources", (r) => { r.cards[0].source = ["AR 1", "AR 2", "AR 3", "AR 4", "AR 5", "AR 6", "AR 7", "AR 8", "AR 9"].map((pub) => ({ pub, edition: "", para: "", quoteKind: "paraphrase" })); }),
    bigRow,
  ];
  const good = clone(ROW); good.id = "clean-one"; good.name = "Clean deck";
  const payload = { schema: (await page.evaluate(async () => (await G.backup.exportAll()).schema)), exportedAt: new Date().toISOString(), stores: { kv: [{ k: "unit-deck:clean-one", v: good }].concat(bad), userScenarios: [], attempts: [] } };
  const res = await page.evaluate(async (p) => { const r = await G.backup.importAll(p); await G.unitDecks.load(); return r; }, payload);
  check(res.skipped.kv === bad.length && JSON.stringify(res.skippedKeys.slice().sort()) === JSON.stringify(bad.map((r) => r.k).sort()), `a restore refuses every one of ${bad.length} rows the import check would have refused (a Social Security number, a marking, a roster in one card or spread over seven, an email address, fullwidth digits, a hidden character, nine sources, a row over the size limit) and names each`, () => JSON.stringify(res));
  const ids = await deckIds();
  check(ids.includes("clean-one") && !ids.some((i) => /^has-|^nine-|^too-big$/.test(i)), "while the clean row beside them is restored", () => JSON.stringify(ids));
  check((await keys("unit-deck:")).every((k) => k === "unit-deck:clean-one" || k === "unit-deck:" + DECK), "and none of the refused rows reached the device");
  check(!JSON.stringify(res).includes("123-45-6789"), "and what the restore reports never repeats a number");
  await page.evaluate(async () => { await G.unitDecks.remove("clean-one"); });

  // The same rows, already ON the device (put there underneath the app): the start-up leaves them out, and says why.
  await putOnDevice(page, { stores: { kv: bad.concat([{ k: "unit-deck:clean-two", v: Object.assign(clone(good), { id: "clean-two" }) }]) } });
  await page.evaluate(async () => { await G.unitDecks.load(); });
  const onDev = await deckIds();
  check(onDev.includes("clean-two") && !onDev.some((i) => /^has-|^nine-|^too-big$/.test(i)), "rows already on the device that fail the screen are left out at start-up (never studied), the clean one is kept", () => JSON.stringify(onDev));
  // The start-up's log is written by a queue that finishes a moment after load() returns: wait for all of it instead of reading it early.
  await untilAsync(page, async (n) => (await G.selfheal.recent(80)).filter((e) => e.kind === "kv-reject" && /^unit-deck:(has-|nine-|too-big)/.test(e.key || "") && /^a saved unit deck/.test(e.detail || "")).length >= n, bad.length);
  const why = await page.evaluate(async () => (await G.selfheal.recent(80)).filter((e) => e.kind === "kv-reject" && /^unit-deck:(has-|nine-|too-big)/.test(e.key || "") && /^a saved unit deck/.test(e.detail || "")).map((e) => e.key + " -> " + e.detail));
  check(bad.every((r) => why.some((w) => w.indexOf(r.k + " ->") === 0)), "and each is logged for Diagnostics", () => JSON.stringify(why));
  check(why.some((w) => /has-ssn -> a saved unit deck holds text the sensitive-text check refuses/.test(w)) && why.some((w) => /too-big -> a saved unit deck is larger than a unit deck may be/.test(w)), "with the reason (the text the screen refuses, or the size)", () => JSON.stringify(why));
  const cards = await page.evaluate(() => G.unitDecks.cards().map((c) => c.q).join("|"));
  check(!/SECRET|Smith|123-45/.test(cards), "and nothing from a refused row is in the study pool");
  // Left out is NOT hidden and NOT silent: the rows are still on the device (and in a backup) until the Soldier removes them, so Settings lists
  // each one, says why in plain words, and offers a Remove button that takes it off the device.
  const inBackup = await page.evaluate(async () => (await G.backup.exportAll()).stores.kv.map((r) => r.k).filter((k) => /^unit-deck:has-/.test(k)));
  const hasN = bad.filter((r) => /^unit-deck:has-/.test(r.k)).length;
  check(inBackup.length === hasN, "(until removed, a left-out row IS still in the backup the app would export - which the privacy text says)", () => JSON.stringify(inBackup));
  await waitForRoute(page, "#/settings", { fresh: true, ready: "[data-unit-decks-leftout]" });
  const lo = await page.evaluate(() => ({
    head: (document.querySelector("[data-unit-decks-leftout] p") || {}).textContent || "", hint: (document.querySelector("[data-unit-decks-leftout] p.hint") || {}).textContent || "",
    rows: Array.from(document.querySelectorAll("[data-unit-deck-leftout-row]")).map((r) => ({ key: r.getAttribute("data-unit-deck-leftout-row"), text: r.querySelector("p").textContent, btn: (r.querySelector("button") || {}).textContent, aria: (r.querySelector("button") || {}).getAttribute("aria-label") })),
    api: G.unitDecks.leftOut().map((r) => r.key).sort(),
  }));
  check(lo.rows.length === bad.length && JSON.stringify(lo.api) === JSON.stringify(bad.map((r) => r.k).sort()) && /^9 saved decks could not be loaded$/.test(lo.head) && /left them out of your study tools\. They are still on this device, and in any backup you export, until you remove them\./.test(lo.hint), "Settings lists every saved deck that could not be loaded, and says they are still on the device and in any backup until removed", () => JSON.stringify(lo));
  const said = (k) => (lo.rows.find((r) => r.key === "unit-deck:" + k) || {}).text || "";
  check(said("has-ssn") === "A saved deck (has-ssn) is left out because its text looks like something that does not belong in a study deck." && said("too-big") === "A saved deck (too-big) is left out because it is larger than a unit deck may be." && said("nine-sources") === "A saved deck (nine-sources) is left out because it did not pass GUIDON's check.", "each says why, in plain words, and never repeats what was in the row", () => JSON.stringify(lo.rows.map((r) => r.text)));
  check(lo.rows.every((r) => r.btn === "Remove it" && /^Remove the saved deck .+ from this device$/.test(r.aria)), "with a labelled Remove button on each");
  check(!(await page.locator("#settings-unitdecks-panel").innerText()).includes("123-45-6789"), "and the panel never shows what is inside a left-out deck");
  await clickWhenStable(page, page.locator('[data-unit-deck-leftout-remove="unit-deck:has-ssn"]'));
  await until(page, () => !document.querySelector('[data-unit-deck-leftout-row="unit-deck:has-ssn"]'));
  check(!(await deviceKvGet(page, "unit-deck:has-ssn")) && (await deviceKvGet(page, "unit-deck:has-email")) !== null, "Remove it takes THAT row off the device and only that one");
  const after1 = await page.evaluate(async () => ({ head: (document.querySelector("[data-unit-decks-leftout] p") || {}).textContent, api: G.unitDecks.leftOut().length, backup: (await G.backup.exportAll()).stores.kv.map((r) => r.k).filter((k) => /^unit-deck:has-/.test(k)).length, focus: document.activeElement && document.activeElement.hasAttribute("data-unit-deck-open") }));
  check(after1.head === "8 saved decks could not be loaded" && after1.api === 8 && after1.backup === hasN - 1 && after1.focus === true, "the list shrinks, the row is out of the next backup, and focus moves to \"Add a unit deck\"", () => JSON.stringify(after1));
  await page.evaluate(async (ks) => { for (const k of ks) await G.db.del("kv", k); await G.unitDecks.load(); }, bad.map((r) => r.k).concat(["unit-deck:clean-two"]));
  const none = await page.evaluate(() => G.unitDecks.leftOut().length);
  check(none === 0, "with the rows gone the list is empty again");
  // A device with the WRONG CLOCK must not lose decks: a row is judged as of the day it was added.
  const wrongClock = clone(ROW); wrongClock.id = "clock-check"; wrongClock.name = "Clock check"; wrongClock.importedAt = "2100-01-01T00:00:00.000Z";
  wrongClock.cards[0].a = "The convoy departs Fort Foo on 15 March 2099.";
  const early = clone(wrongClock); early.id = "clock-early"; early.name = "Clock early"; early.importedAt = "2026-09-26T00:00:00.000Z";
  await putOnDevice(page, { stores: { kv: [{ k: "unit-deck:clock-check", v: wrongClock }, { k: "unit-deck:clock-early", v: early }] } });
  await page.evaluate(async () => { await G.unitDecks.load(); });
  const clockIds = await deckIds();
  check(clockIds.includes("clock-check") && !clockIds.includes("clock-early"), "a deck added when its future-dated sentence had already passed is kept at start-up whatever this device's clock says; one added while that date was still ahead is left out, as the import would have refused it", () => JSON.stringify(clockIds));
  await page.evaluate(async () => { await G.db.del("kv", "unit-deck:clock-check"); await G.db.del("kv", "unit-deck:clock-early"); await G.unitDecks.load(); });
}
{ // a device keeps at most 10 decks, whatever was put on it
  await page.evaluate(async () => { await G.unitDecks.remove("pinecone-ridge-demo"); });   // (the example deck comes back at the end of this block)
  const mk = (n) => { const r = clone(ROW); r.id = "many-" + String(n).padStart(2, "0"); r.name = "Many " + n; r.importedAt = "2026-09-" + String(10 + n).padStart(2, "0") + "T00:00:00.000Z"; r.cards = r.cards.slice(0, 2); return { k: "unit-deck:" + r.id, v: r }; };
  const thirteen = Array.from({ length: 13 }, (_, i) => mk(i + 1));
  await putOnDevice(page, { stores: { kv: thirteen } });
  await page.evaluate(async () => { await G.unitDecks.load(); });
  const kept = (await deckIds()).filter((i) => /^many-/.test(i));
  check(kept.length === 10 && kept[0] === "many-01" && kept[9] === "many-10", "13 sound decks on the device: the start-up keeps the 10 OLDEST and leaves the 3 newest out", () => JSON.stringify(kept));
  await untilAsync(page, async () => (await G.selfheal.recent(80)).filter((e) => e.kind === "kv-reject" && /^unit-deck:many-1[123]$/.test(e.key || "")).length >= 3);
  const why = await page.evaluate(async () => (await G.selfheal.recent(80)).filter((e) => e.kind === "kv-reject" && /^unit-deck:many-1[123]$/.test(e.key || "")).map((e) => e.key));
  check(why.length === 3, "and logs the three it left out (past the limit of 10)", () => JSON.stringify(why));
  const lim = await page.evaluate(() => G.unitDecks.leftOut().map((r) => r.key + " -> " + r.reason).sort());
  check(JSON.stringify(lim) === JSON.stringify(["unit-deck:many-11 -> you already have 10 unit decks, the most GUIDON keeps", "unit-deck:many-12 -> you already have 10 unit decks, the most GUIDON keeps", "unit-deck:many-13 -> you already have 10 unit decks, the most GUIDON keeps"]), "and lists them in Settings as left out because you already have 10 (so they can be removed)", () => JSON.stringify(lim));
  await page.evaluate(async (ks) => { for (const k of ks) await G.db.del("kv", k); await G.unitDecks.load(); }, thirteen.map((r) => r.k));
  // A restore onto an empty device: the first 10 come in, the rest are named as left out.
  const twelve = Array.from({ length: 12 }, (_, i) => mk(i + 1));
  const schema = await page.evaluate(async () => (await G.backup.exportAll()).schema);
  const r1 = await page.evaluate(async (p) => { const r = await G.backup.importAll(p); await G.unitDecks.load(); return r; }, { schema, stores: { kv: twelve, userScenarios: [], attempts: [] } });
  check(r1.restored.kv === 10 && r1.skipped.kv === 2 && JSON.stringify(r1.skippedKeys) === JSON.stringify(["unit-deck:many-11", "unit-deck:many-12"]), "a restore of 12 decks onto an empty device brings in 10 and names the other 2 as left out", () => JSON.stringify(r1));
  // A full device: a deck it already has may be replaced by the backup's newer copy, a new one is left out.
  const replacement = mk(3); replacement.v.name = "Many 3, newer";
  const r2 = await page.evaluate(async (p) => { const r = await G.backup.importAll(p); await G.unitDecks.load(); return r; }, { schema, stores: { kv: [replacement, mk(20)], userScenarios: [], attempts: [] } });
  const named = await page.evaluate(() => G.unitDecks.list().find((d) => d.id === "many-03").name);
  check(r2.restored.kv === 1 && r2.skipped.kv === 1 && r2.skippedKeys[0] === "unit-deck:many-20" && named === "Many 3, newer", "on a full device a restore may replace a deck it has, but not add an 11th", () => JSON.stringify({ r2, named }));
  await page.evaluate(async (ks) => { for (const k of ks) await G.db.del("kv", k); await G.unitDecks.load(); }, twelve.map((r) => r.k));
  check((await keys("unit-deck:")).length === 0, "(and the device is clean again)");
  await page.evaluate(async (p) => { await G.unitDecks.add(p); }, PACK);
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
    // "constructor" is an inherited name on an ordinary object, so a plain-object registry would think a deck with that id already exists.
    const ctor = await G.unitDecks.add(Object.assign(mk(12), { id: "constructor" }));
    const replace = await G.unitDecks.add(Object.assign(mk(3), { packVersion: "2" }));
    return { out, eleventh, ctor: { ok: ctor.ok, stage: ctor.stage }, replace, n: G.unitDecks.list().length };
  });
  check(many.out.every(Boolean) && many.n === 10, "ten decks fit");
  check(many.eleventh.ok === false && many.eleventh.stage === "limit" && /already have 10 unit decks/.test(many.eleventh.messages[0]) && /Remove one first/.test(many.eleventh.messages[0]), "the eleventh is refused in plain words (remove one first)", () => JSON.stringify(many.eleventh));
  check(many.ctor.ok === false && many.ctor.stage === "limit" && many.n === 10, "a deck whose id is \"constructor\" is a NEW deck like any other, so it does not get past the limit either", () => JSON.stringify(many.ctor));
  check(many.replace.ok === true && many.replace.replaced === true && many.n === 10, "but replacing one that is already there is allowed at the limit");
  await page.evaluate(async () => { for (let i = 1; i <= 10; i++) await G.unitDecks.remove("deck-" + i); });
  check((await keys("unit-deck:")).length === 0, "and removing them leaves no row behind");
  // Two adds started together at nine decks must not both get the tenth place (the check and the save are not one step).
  const race = await page.evaluate(async () => {
    const mk = (i) => ({ format: "guidon-unit-pack", formatVersion: 1, id: "race-" + i, name: "Race " + i, packVersion: "1", packDate: "2026-09-26", cards: [{ id: "c1", category: "C", q: "Question " + i + "?", a: "Answer " + i }] });
    for (let i = 1; i <= 9; i++) await G.unitDecks.add(mk(i));
    const both = await Promise.all([G.unitDecks.add(mk(10)), G.unitDecks.add(mk(11)), G.unitDecks.add(mk(12))]);
    const same = await Promise.all([G.unitDecks.add(mk(1)), G.unitDecks.add(mk(1))]);
    return { okCount: both.filter((r) => r.ok).length, refused: both.filter((r) => !r.ok).map((r) => r.stage), n: G.unitDecks.list().length, sameOk: same.every((r) => r.ok && r.replaced), afterSame: G.unitDecks.list().length };
  });
  check(race.okCount === 1 && JSON.stringify(race.refused) === JSON.stringify(["limit", "limit"]) && race.n === 10, "three adds started together at nine decks: exactly one gets the tenth place, the other two are told the limit is reached", () => JSON.stringify(race));
  check(race.sameOk && race.afterSame === 10, "two replacements of the same deck at once are both fine (a replacement never needs a new place)", () => JSON.stringify(race));
  await page.evaluate(async () => { for (const d of G.unitDecks.list()) await G.unitDecks.remove(d.id); });
  check((await keys("unit-deck:")).length === 0, "(and the device is clean again)");
  // On an empty device "constructor" is an ordinary id: nothing is "replaced", and it can be added and removed.
  const proto = await page.evaluate(async () => {
    const pk = { format: "guidon-unit-pack", formatVersion: 1, id: "constructor", name: "Constructor deck", packVersion: "1", packDate: "2026-09-26", cards: [{ id: "tostring", category: "__proto__", q: "constructor", a: "hasOwnProperty" }] };
    const insp = G.unitDecks.inspect(pk);
    const before = { deck: G.unitDecks.deck("constructor"), listed: G.unitDecks.list().length, ids: G.unitDecks.list().map((d) => d.id) };
    const added = await G.unitDecks.add(pk);
    const listed = G.unitDecks.list().map((d) => d.id + ":" + d.cardCount + ":" + d.categoryCount);
    const cards = G.unitDecks.cards().map((c) => c.id + "|" + c.category);
    const again = await G.unitDecks.add(pk);
    const removed = await G.unitDecks.remove("constructor", { deleteHistory: true });
    return { replaces: insp.replaces, ok: insp.ok, before, added: { ok: added.ok, replaced: added.replaced }, listed, cards, again: { ok: again.ok, replaced: again.replaced }, removed: removed.ok, after: G.unitDecks.list().length };
  });
  check(proto.ok && proto.replaces === null && proto.before.deck === null && proto.before.listed === 0, "on an empty device the preview does not claim a deck called \"constructor\" replaces one named \"Object\"", () => JSON.stringify(proto));
  check(proto.added.ok && proto.added.replaced === false && JSON.stringify(proto.listed) === JSON.stringify(["constructor:1:1"]) && JSON.stringify(proto.cards) === JSON.stringify(["unit:constructor:tostring|Unit: __proto__"]), "it is added as a new deck, with card id \"tostring\" and category \"__proto__\" as ordinary names", () => JSON.stringify(proto));
  check(proto.again.ok && proto.again.replaced === true && proto.removed === true && proto.after === 0, "adding it again replaces it (correctly, this time), and it can be removed");
}
{ // A source that would split into more than 8 references is refused when the deck is ADDED - not accepted and then lost at the next start.
  const NINE = "AR 600-8-19, AR 600-20, AR 670-1, AR 350-1, DA PAM 600-25, ADP 6-22, FM 6-22, TC 3-21.5, ATP 3-21.8";
  const EIGHT = "AR 600-8-19, AR 600-20, AR 670-1, AR 350-1, DA PAM 600-25, ADP 6-22, FM 6-22, TC 3-21.5";
  const mk = (source) => ({ format: "guidon-unit-pack", formatVersion: 1, id: "many-pubs", name: "Many publications", packVersion: "1", packDate: "2026-09-26", cards: [{ id: "c1", category: "C", q: "Which publications?", a: "These.", source }] });
  const r9 = await page.evaluate(async (p) => { const r = await G.unitDecks.add(p); return { ok: r.ok, stage: r.stage, messages: r.messages, listed: G.unitDecks.list().length }; }, mk(NINE));
  check(r9.ok === false && r9.stage === "format" && /Card 1 \(c1\): the source lists 9 separate references; the most GUIDON keeps on one card is 8/.test(r9.messages.join(" ")) && r9.listed === 0 && (await keys("unit-deck:many-pubs")).length === 0, "a source naming 9 publications is refused when the deck is added (in plain words, naming the card) and nothing is saved", () => JSON.stringify(r9));
  const r8 = await page.evaluate(async (p) => { const r = await G.unitDecks.add(p); await G.unitDecks.load(); return { ok: r.ok, ids: G.unitDecks.list().map((d) => d.id), cards: G.unitDecks.cards().length }; }, mk(EIGHT));
  check(r8.ok === true && r8.ids.includes("many-pubs") && r8.cards === 1, "one naming 8 is added, and is STILL listed after the start-up read of the device (the same row check that used to drop a 9-source deck)", () => JSON.stringify(r8));
  await page.evaluate(async () => { await G.unitDecks.remove("many-pubs"); });
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
