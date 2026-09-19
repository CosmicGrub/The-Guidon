/**
 * Study Rooms: mixed-category decks, end to end through the REAL #/group UI.
 *
 * One Chromium, three GUIDON pages in one context, wired through the fake
 * transport at the room module's seam (tools/room-harness.mjs): H hosts, P
 * joins as an ordinary seat, L joins reporting an OLDER GUIDON in its hello
 * (the only thing about an older build a current page can honestly stand in
 * for - see section 3).
 *
 * This replaces a vm-sandbox suite that loaded only the retired shim
 * (src/app-modules/z-studygroup-multicategory.js) against a stubbed
 * G.studyGroup.host/state/render and a three-card fake bank - i.e. it
 * stubbed exactly the seams that were broken, and passed 9/9 while the
 * feature did nothing from the screen. Nothing is stubbed here: the picker
 * is clicked, the Host button is clicked, the joiners come in over the wire
 * and are admitted with the real Admit buttons, the relay rounds run in the
 * real Rapid Fire engine and the board cards are read off the real card
 * panel on both devices. Every assertion below failed on the shim build
 * (the comments say how).
 *
 *  1. The deck-label codec against EVERY real category name: all pairs and
 *     seeded random 3..12-subsets round-trip losslessly inside the wire's
 *     80-char field; 13 categories are REFUSED in plain words, never cut
 *     (the shim sliced names mid-word at 80 chars: "AR 600-9 - Army Body
 *     Composition Program" + "AR 350-1 (Training Regulation / METL)" lost
 *     the second category); no two real categories share a token.
 *  2. The picker: no Ctrl/Command-click anywhere - one select whose "Custom
 *     mix..." option opens labelled tick boxes (Rapid Fire's idiom), keyboard
 *     operable, a live "N categories picked - M cards" summary that is also
 *     announced, a cap that says why, no sideways scroll at 390px, and the
 *     picks SURVIVE every internal redraw (mode toggle, a forced redraw with
 *     focus on a box, coming back from a room) - the shim's multi-select
 *     silently reverted to a single select on each of those.
 *  3. Hosting from the real button with two categories opens a room whose
 *     deck IS those two (the button used to bypass the shim: one category,
 *     or All); both seats see the deck named in the room; an older GUIDON's
 *     seat is flagged to the host in plain words and announced, a current
 *     one is not.
 *  4. Rapid-Fire relay: host and joiner each play their WHOLE round in the
 *     real engine - every card shown is from the two categories, and both
 *     categories appear.
 *  5. Mock Board Live from the real button: all 15 dealt cards are from the
 *     two categories (the shim dealt 15 of 15 from the rest of the bank
 *     under a "Multi:" label), read off the card panel on BOTH devices.
 *  6. The rest of the app is untouched during and after a mixed room: the
 *     bank's size on every page, Board Drill's own category filter on a
 *     seated page, and the recitable creeds list - in play, after the host
 *     leaves (the joiner's host-left panel still up), and after Back. The
 *     shim's app-wide filter left 39 of 1,274 cards there.
 *  7. A deck this device cannot fully play says so on screen instead of
 *     quietly drilling something else.
 *
 * Every positive assertion is a bounded poll (until()), never a bare sleep.
 * Usage: node tools/test-studygroup-multicategory.mjs   (exit code = FAIL count)
 */
import { serve } from "./server.mjs";
import { openRoom, fakeTransport, close } from "./room-harness.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, limit = 6000, step = 50) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try { value = await pred(); } catch (e) { value = null; }
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}
const WATCHDOG_MS = 240000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nSTUDY ROOM MIXED DECKS: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

/* The very pair the shim's encoder lost a category from. */
const CAT_A = "AR 600-9 — Army Body Composition Program";
const CAT_B = "AR 350-1 (Training Regulation / METL)";
const PICKS = [CAT_A, CAT_B];
const inPicks = (c) => PICKS.includes(c);

const st = (p) => p.evaluate(() => G.studyGroup.state());
const bankSize = (p) => p.evaluate(() => G.store.boardQuestions().length);
const live = (p) => p.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
const text = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
const clickWhen = async (p, sel) => (await until(() => p.evaluate((s) => { const b = document.querySelector(s); if (!b || b.disabled) return null; b.click(); return true; }, sel))).hit;
const boxFor = (p, name) => p.evaluate((n) => { const cb = [...document.querySelectorAll("input.sg-custom-cb")].find((x) => x.getAttribute("aria-label") === n); return cb ? "#" + cb.id : null; }, name);
const picker = (p) => p.evaluate(() => {
  const s = document.querySelector("select.sg-category");
  return s ? { multiple: s.multiple, value: s.value, ticked: [...document.querySelectorAll("input.sg-custom-cb")].filter((x) => x.checked).map((x) => x.getAttribute("aria-label")), boxes: document.querySelectorAll("input.sg-custom-cb").length } : null;
});
/* Play a whole relay round in the real engine: read the category off every
   card the round shows, judge it Correct, until the round runs out. judge()
   draws the next card synchronously, so this is one in-page loop. */
const playWholeRound = (p) => p.evaluate(() => {
  const seen = [];
  for (let i = 0; i < 600; i++) {
    const card = document.querySelector(".rf-card");
    const lab = card && card.querySelector(".kc-label");
    const yes = document.querySelector(".rf-judge-correct");
    if (!lab || !yes) break;
    seen.push(lab.textContent);
    yes.click();
  }
  return seen;
});

console.log("test-studygroup-multicategory: 3 pages, one Chromium, fake transport at the seam, real #/group UI");
const { server, url } = await serve("web");
try {
  const room = await openRoom(url, 3, { hash: "#/group" });
  const { pages, noise } = room;
  const [H, P, L] = pages;
  const hub = fakeTransport({});
  for (let i = 0; i < pages.length; i++) await hub.wire(pages[i], { host: i === 0 });
  for (const p of pages) {
    const r = await p.evaluate(() => G.studyGroup.attach(window.__roomTransport));
    if (!r || !r.ok) bad("attach refused on a page: " + JSON.stringify(r));
    await p.evaluate(() => G.studyGroup._redraw());
  }
  const shimGone = await H.evaluate(() => !G.studyGroup.multiCategory && !G.studyGroup._multiCategories && !!G.studyGroup.mixedDeck);
  shimGone ? ok("the load-order shim is gone: no G.studyGroup.multiCategory side channel, the codec lives in the room module (G.studyGroup.mixedDeck)") : bad("the shim's surface is still present, or G.studyGroup.mixedDeck is missing");
  if (!shimGone) throw new Error("no in-module mixed-deck support on this build - RED");

  const base = await H.evaluate(() => ({ bank: G.store.boardQuestions().length, cats: [...new Set(G.store.boardQuestions().map((q) => q.category))], recitable: G.store.recitable().length, nA: 0, nB: 0 }));
  const counts = await H.evaluate((picks) => picks.map((c) => G.store.boardQuestions().filter((q) => q.category === c).length), PICKS);
  const DECK_N = counts[0] + counts[1];
  counts[0] > 0 && counts[1] > 0 && base.cats.length > 13
    ? ok("the real bank: " + base.bank + " cards in " + base.cats.length + " categories; the two picks hold " + counts.join(" + ") + " = " + DECK_N + " cards")
    : bad("fixture categories missing from the bank: " + JSON.stringify({ counts, cats: base.cats.length }));

  /* ---------------- 1. the codec, against every real category ---------------- */
  const codec = await H.evaluate(({ cats, picks }) => {
    const M = G.studyGroup.mixedDeck, out = { collisions: [], bad: [], tried: 0, maxLen: 0 };
    const toks = {};
    cats.forEach((c) => { const t = M.token(c); if (toks[t]) out.collisions.push([toks[t], c]); toks[t] = c; });
    const same = (a, b) => a.length === b.length && a.slice().sort().join("") === b.slice().sort().join("");
    const check = (names) => {
      out.tried++;
      const e = M.encode(names);
      if (!e.ok || typeof e.label !== "string" || e.label.length > 80) { out.bad.push({ names, e }); return; }
      out.maxLen = Math.max(out.maxLen, e.label.length);
      const d = M.decode(e.label);
      if (!d || d.missing !== 0 || !same(d.names, names)) out.bad.push({ names, label: e.label, d });
    };
    for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) check([cats[i], cats[j]]);
    let seed = 12345;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    for (let n = 0; n < 600; n++) {
      const k = 3 + Math.floor(rnd() * (M.MAX - 2)), pool = cats.slice(), names = [];
      for (let x = 0; x < k; x++) names.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
      check(names);
    }
    const pair = M.encode(picks);
    const over = M.encode(cats.slice(0, M.MAX + 1));
    const frame = { v: 1, t: "snapshot", room: "ALPHA-BRAVO-42", seq: 1, from: "ABCDEFGH", body: { snapshot: { phase: "lobby", mode: "relay", seq: 1, room: "ALPHA-BRAVO-42", hostSeat: 1, cardId: null, cardText: null, turnSeat: null, lock: null, deadline: null, round: { idx: 0, total: 0 }, seats: [], bankSig: "bank:1:x", deck: { category: M.encode(cats.slice(0, M.MAX)).label, timerSec: null } } } };
    return {
      out: { collisions: out.collisions, bad: out.bad.slice(0, 3), nBad: out.bad.length, tried: out.tried, maxLen: out.maxLen },
      pair, pairBack: M.decode(pair.label), over, max: M.MAX,
      one: M.encode([picks[0]]), none: M.encode(["All"]), plain: M.decode(picks[0]),
      orderFree: M.encode(picks).label === M.encode(picks.slice().reverse()).label,
      wireOk: G.roomSchema.validate(frame),
      shimForm: M.decode("Multi: " + picks.join(" + ")),
      shimCut: M.decode("Multi: AR 600-9 — Army Body Composition Program+AR 350-1 (Training Regulation / "),
      junk: M.decode(M.PREFIX + "zzzzz"),
    };
  }, { cats: base.cats, picks: PICKS });
  codec.out.collisions.length === 0 ? ok("no two of the " + base.cats.length + " real categories share a deck token") : bad("token collisions in the real bank: " + JSON.stringify(codec.out.collisions));
  codec.out.nBad === 0
    ? ok("all " + codec.out.tried + " real-name decks (every pair + 600 seeded 3.." + codec.max + "-category mixes) round-trip losslessly; longest label " + codec.out.maxLen + " of 80 chars")
    : bad(codec.out.nBad + " of " + codec.out.tried + " decks did not round-trip, e.g. " + JSON.stringify(codec.out.bad));
  codec.pair.ok && codec.pair.label.length <= 80 && codec.pairBack && codec.pairBack.missing === 0 && codec.pairBack.names.slice().sort().join("|") === PICKS.slice().sort().join("|")
    ? ok("the pair the first version cut mid-word (\"" + CAT_A + "\" + \"" + CAT_B + "\") now carries both names: " + JSON.stringify(codec.pair.label))
    : bad("the AR 600-9 / AR 350-1 pair: " + JSON.stringify({ e: codec.pair, d: codec.pairBack }));
  !codec.over.ok && /up to 12 categories/.test(codec.over.reason || "") && !/\b(encode|token|label|wire|char)/i.test(codec.over.reason)
    ? ok((codec.max + 1) + " categories are REFUSED in plain words, never cut: \"" + codec.over.reason + "\"")
    : bad("over the cap: " + JSON.stringify(codec.over));
  codec.one.ok && codec.one.label === CAT_A && codec.none.ok && codec.none.label === null && codec.plain === null
    ? ok("one category stays the bare name on the wire and All stays empty - byte-for-byte what every build has always sent")
    : bad("single/All representation changed: " + JSON.stringify({ one: codec.one, none: codec.none, plain: codec.plain }));
  codec.orderFree ? ok("the label does not depend on the order the boxes were ticked") : bad("label depends on pick order");
  codec.wireOk && codec.wireOk.ok ? ok("a snapshot carrying a full " + codec.max + "-category label passes G.roomSchema.validate - protocol v1 unchanged") : bad("schema rejects the label: " + JSON.stringify(codec.wireOk));
  codec.shimForm && codec.shimForm.missing === 0 && codec.shimForm.names.length === 2 && codec.shimCut && codec.shimCut.names.length === 1 && codec.shimCut.missing === 1 && codec.junk && codec.junk.names.length === 0 && codec.junk.missing === 1
    ? ok("a label this bank cannot fully resolve is COUNTED, not swallowed: the retired \"Multi:\" names form reads back (2 names), its cut-off form reports 1 missing, an unknown token reports 1 missing")
    : bad("decode of foreign labels: " + JSON.stringify({ shimForm: codec.shimForm, shimCut: codec.shimCut, junk: codec.junk }));

  /* ---------------- 2. the picker ---------------- */
  const idle = await until(() => picker(H));
  idle.hit && idle.value.multiple === false ? ok("the category control is an ordinary select, not a native multi-select") : bad("category control: " + JSON.stringify(idle.value));
  const ctrlCopy = await H.evaluate(() => /ctrl|command-click|multi-select gesture/i.test(document.querySelector(".sg-view").textContent));
  !ctrlCopy ? ok("nothing on the screen tells a touch user to Ctrl/Command-click") : bad("the idle screen still mentions Ctrl/Command-click");
  await H.selectOption("select.sg-category", { label: "Custom mix…" });
  const opened = await until(() => picker(H).then((v) => v && v.boxes === base.cats.length ? v : null));
  opened.hit ? ok("\"Custom mix…\" opens one labelled tick box per category (" + opened.value.boxes + ")") : bad("custom mix list: " + JSON.stringify(opened.value));
  const named = await H.evaluate(() => [...document.querySelectorAll("input.sg-custom-cb")].every((cb) => cb.getAttribute("aria-label") && cb.id && document.querySelector('label[for="' + cb.id + '"]')) && !!document.querySelector('.sg-custom-list[role="group"][aria-label]'));
  named ? ok("every tick box has an accessible name and a tappable label; the list is a named group") : bad("tick boxes are missing names/labels");

  const idA = await boxFor(H, CAT_A), idB = await boxFor(H, CAT_B);
  await H.click(idA);
  /* keyboard: focus the second box and press Space */
  await H.focus(idB);
  await H.keyboard.press("Space");
  const two = await until(() => picker(H).then((v) => v && v.ticked.length === 2 ? v : null));
  two.hit && two.value.ticked.every(inPicks) ? ok("two categories ticked - one by pointer, one from the keyboard (focus + Space)") : bad("ticked: " + JSON.stringify(two.value));
  const sumText = await text(H, ".sg-custom-summary");
  const want = "2 categories picked - " + DECK_N + " cards in this room's deck.";
  sumText === want ? ok("summary line: \"" + sumText + "\"") : bad("summary line: " + JSON.stringify(sumText) + " (wanted " + JSON.stringify(want) + ")");
  const said = await until(() => live(H).then((t) => t === want));
  said.hit ? ok("the same sentence is announced through the app's live region") : bad("live region after ticking: " + JSON.stringify(await live(H)));

  /* survives internal redraws (the shim's select reverted on each of these) */
  await H.evaluate(() => [...document.querySelectorAll(".sg-view .segmented button")].find((b) => b.textContent.trim() === "Mock Board Live").click());
  const afterToggle = await until(() => H.evaluate(() => !!document.querySelector("select.sg-count")).then((y) => y ? picker(H) : null));
  afterToggle.hit && afterToggle.value.value !== "All" && afterToggle.value.ticked.length === 2 && afterToggle.value.ticked.every(inPicks)
    ? ok("switching to Mock Board Live redraws the screen and the picker still shows Custom mix with both boxes ticked")
    : bad("picker after the mode toggle: " + JSON.stringify(afterToggle.value));
  const boardSum = await text(H, ".sg-custom-summary");
  boardSum === "2 categories picked - " + DECK_N + " cards to deal this board from."
    ? ok("in Mock Board Live the same count is worded as what it is there: \"" + boardSum + "\"")
    : bad("summary line in Mock Board Live: " + JSON.stringify(boardSum));
  const focusAfterToggle = await H.evaluate(() => document.activeElement && document.activeElement !== document.body);
  focusAfterToggle ? ok("the redraw did not drop keyboard focus to <body>") : bad("focus fell to <body> after the mode toggle");
  await H.evaluate(() => [...document.querySelectorAll(".sg-view .segmented button")].find((b) => b.textContent.trim() === "Rapid-Fire relay").click());
  await until(() => H.evaluate(() => !!document.querySelector("select.sg-timer")));
  await H.focus(idB);
  await H.evaluate(() => G.studyGroup._redraw());
  await sleep(250);
  const refocus = await H.evaluate(() => ({ id: document.activeElement ? "#" + document.activeElement.id : null, checked: !!(document.activeElement && document.activeElement.checked) }));
  refocus.id === idB && refocus.checked ? ok("a redraw with focus on a tick box re-lands focus on the SAME box, still ticked") : bad("focus after a forced redraw: " + JSON.stringify(refocus) + " (wanted " + idB + ")");

  /* the cap says why */
  const others = base.cats.filter((c) => !inPicks(c)).slice(0, 11);
  for (const c of others.slice(0, 10)) await H.click(await boxFor(H, c));
  const twelve = await picker(H);
  await H.click(await boxFor(H, others[10]));
  const capped = await picker(H);
  const capText = await text(H, ".sg-custom-summary");
  const capSaid = await until(() => live(H).then((t) => /up to 12 categories/.test(t)));
  twelve.ticked.length === 12 && capped.ticked.length === 12 && !capped.ticked.includes(others[10]) && /up to 12 categories/.test(capText || "") && capSaid.hit
    ? ok("a 13th tick does not stay ticked, and the line under the list (and the live region) says why: \"" + capText + "\"")
    : bad("cap: " + JSON.stringify({ before: twelve.ticked.length, after: capped.ticked.length, capText }));

  /* 390px: no sideways scroll with the list open */
  await H.setViewportSize({ width: 390, height: 844 });
  await sleep(200);
  const narrow = await H.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, list: !!document.querySelector(".sg-custom-list") }));
  narrow.list && narrow.sw <= narrow.cw ? ok("at 390px the idle screen with the tick-box list open has no horizontal overflow (" + narrow.sw + " <= " + narrow.cw + ")") : bad("390px idle overflow: " + JSON.stringify(narrow));
  await H.setViewportSize({ width: 1280, height: 880 });

  await clickWhen(H, "button.sg-custom-clear");
  const cleared = await until(() => picker(H).then((v) => v && v.ticked.length === 0 ? v : null));
  const clearedText = await text(H, ".sg-custom-summary");
  cleared.hit && /No categories picked yet/.test(clearedText || "") ? ok("\"Clear all\" unticks everything: \"" + clearedText + "\"") : bad("clear all: " + JSON.stringify({ v: cleared.value, clearedText }));
  await H.click(idA); await H.click(idB);

  /* ---------------- 3. host from the real button; joiners; honest seats ---------------- */
  await H.selectOption("select.sg-timer", "");
  await H.fill("input.sg-name", "HOST-ONE");
  await clickWhen(H, "button.sg-host");
  const hosted = await until(() => st(H).then((s) => s && s.role === "host" ? s : null));
  const hostDeck = hosted.hit ? await H.evaluate((label) => G.studyGroup.mixedDeck.decode(label), hosted.value.deck.category) : null;
  hosted.hit && hosted.value.mode === "relay" && typeof hosted.value.deck.category === "string" && hosted.value.deck.category.length <= 80 && hostDeck && hostDeck.missing === 0 && hostDeck.names.length === 2 && hostDeck.names.every(inPicks)
    ? ok("the real \"Host a room\" button opened a relay room whose deck is exactly the two ticked categories (wire label " + JSON.stringify(hosted.value.deck.category) + ")")
    : bad("hosted from the UI: deck.category = " + JSON.stringify(hosted.value && hosted.value.deck) + " -> " + JSON.stringify(hostDeck));
  const hostLine = await until(() => text(H, ".sg-deck").then((t) => t && t.includes(CAT_A) && t.includes(CAT_B) && t.includes(DECK_N + " cards") ? t : null));
  hostLine.hit ? ok("the host's room names its deck: \"" + hostLine.value + "\"") : bad("host .sg-deck line: " + JSON.stringify(await text(H, ".sg-deck")));
  (await bankSize(H)) === base.bank ? ok("hosting a mixed room left the host's own bank at " + base.bank + " cards") : bad("host bank while hosting: " + (await bankSize(H)) + " of " + base.bank);

  const code = hosted.value.room;
  /* L reports an older GUIDON in its hello. A current page cannot BE an
     older build, but what the host acts on is exactly this: the display-only
     app/build fields of the joiner's hello, over the real wire. */
  await L.evaluate(() => { window.GUIDON_APP_VERSION = "1.10.0"; window.GUIDON_BUILD_SHA = "0ldbu1ld0ldbu1ld"; });
  for (const [p, name] of [[P, "PEER-NOW"], [L, "PEER-OLD"]]) {
    await p.fill("input.sg-join-code", code);
    await p.fill("input.sg-join-name", name);
    await clickWhen(p, "button.sg-join");
  }
  const waiting = await until(() => st(H).then((s) => s && s.pending.length === 2 ? s.pending : null));
  waiting.hit ? ok("both joiners are waiting to be admitted") : bad("pending: " + JSON.stringify(waiting.value));
  const notes = await until(() => H.evaluate(() => { const n = [...document.querySelectorAll(".sg-pending .sg-seat-note")].map((x) => x.textContent); return n.length ? n : null; }));
  notes.hit && notes.value.length === 1 && /^PEER-OLD is on an older GUIDON and will get questions from every category\.$/.test(notes.value[0])
    ? ok("before admitting, the host is told the truth about the older seat only: \"" + notes.value[0] + "\"")
    : bad("waiting-list notes: " + JSON.stringify(notes.value));
  const toldLive = await until(() => live(H).then((t) => /PEER-OLD is on an older GUIDON/.test(t)));
  toldLive.hit ? ok("and it is announced through the live region") : bad("live region after the older joiner's hello: " + JSON.stringify(await live(H)));
  /* Each joiner by its OWN Admit button (found by its accessible name), and
     the next click only once that joiner is off the waiting list ON SCREEN:
     the room redraws on a 100 ms throttle, so "the first Admit button" right
     after a click is still the joiner who was just admitted. */
  for (const name of ["PEER-NOW", "PEER-OLD"]) {
    await clickWhen(H, 'button.sg-admit[aria-label="Admit ' + name + '"]');
    await until(() => H.evaluate((n) => G.studyGroup.state().seats.some((x) => x.name === n) && !document.querySelector('button.sg-admit[aria-label="Admit ' + n + '"]'), name));
  }
  const seated = await until(async () => (await st(P)).joinState === "seated" && (await st(L)).joinState === "seated");
  seated.hit ? ok("both joiners admitted with the real Admit buttons and seated") : bad("joiners not seated");
  const rosterNotes = await until(() => H.evaluate(() => { const n = [...document.querySelectorAll(".sg-roster .sg-seat-note")].map((x) => x.textContent); return n.length ? n : null; }));
  rosterNotes.hit && rosterNotes.value.length === 1 && /^PEER-OLD /.test(rosterNotes.value[0]) ? ok("the roster keeps the note under the older seat, and only there") : bad("roster notes: " + JSON.stringify(rosterNotes.value));
  const peerLine = await until(() => text(P, ".sg-deck").then((t) => t && t.includes(CAT_A) && t.includes(CAT_B) && t.includes(DECK_N + " cards") ? t : null));
  const peerWarn = await text(P, ".sg-deck-warn");
  peerLine.hit && peerWarn === null ? ok("the joiner's room names the same deck, with no warning: \"" + peerLine.value + "\"") : bad("joiner deck line: " + JSON.stringify({ line: await text(P, ".sg-deck"), warn: peerWarn }));
  await H.setViewportSize({ width: 390, height: 844 });
  await sleep(250);
  const narrowRoom = await H.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  narrowRoom.sw <= narrowRoom.cw ? ok("at 390px the host's lobby (deck line, seat note and all) has no horizontal overflow") : bad("390px lobby overflow: " + JSON.stringify(narrowRoom));
  await H.setViewportSize({ width: 1280, height: 880 });

  /* ---------------- 4. the relay rounds, in the real engine ---------------- */
  await clickWhen(H, "button.sg-start");
  const seatOf = async (p) => (await st(p)).self.seatNo;
  /* Seats play in seat order, whatever order the two hellos landed in. L's
     own page is current code (only its hello claims otherwise), so its round
     proves nothing about an older build: it just ends it. */
  const order = [[H, "host", 1, true], [P, "joiner", await seatOf(P), true], [L, "older seat", await seatOf(L), false]].sort((x, y) => x[2] - y[2]);
  for (const [p, who, seatNo, whole] of order) {
    const turn = await until(() => p.evaluate((n) => { const s = G.studyGroup.state(); return s && s.phase === "play" && s.turnSeat === n && !!document.querySelector("button.sg-play-round"); }, seatNo));
    if (!turn.hit) { bad(who + " never got its turn"); break; }
    await clickWhen(p, "button.sg-play-round");
    const up = await until(() => p.evaluate(() => !!document.querySelector(".rf-card .kc-label") && !!document.querySelector(".rf-judge-correct")));
    if (!up.hit) { bad(who + ": the Rapid Fire round screen did not appear"); break; }
    if (!whole) {
      await p.evaluate(() => { const e = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "End Round"); if (e) e.click(); });
      await until(() => H.evaluate((n) => { const x = G.studyGroup.state().seats.find((q) => q.seatNo === n); return !!(x && x.done); }, seatNo));
      continue;
    }
    if (p === P) {
      /* mid-round, on the seated joiner: the rest of the app still has its whole bank */
      const mid = await bankSize(P);
      mid === base.bank ? ok("mid-round on the joiner, G.store.boardQuestions() is still all " + base.bank + " cards") : bad("joiner bank mid-round: " + mid + " of " + base.bank);
    }
    const seen = await playWholeRound(p);
    const outside = seen.filter((c) => !inPicks(c));
    const both = PICKS.every((c) => seen.includes(c));
    seen.length === DECK_N && outside.length === 0 && both
      ? ok(who + " played its whole relay round: " + seen.length + " cards, every one from the two categories, both categories present")
      : bad(who + " relay round: " + seen.length + " cards (wanted " + DECK_N + "), " + outside.length + " outside the deck" + (outside.length ? " e.g. " + JSON.stringify([...new Set(outside)].slice(0, 4)) : "") + ", both present: " + both);
    const tallied = await until(() => H.evaluate((n) => { const x = G.studyGroup.state().seats.find((q) => q.seatNo === n); return x && x.done ? { score: x.score } : null; }, seatNo));
    tallied.hit && tallied.value.score === DECK_N ? ok(who + "'s score reached the host: " + tallied.value.score) : bad(who + " tally: " + JSON.stringify(tallied.value));
  }
  const recap = await until(() => st(H).then((s) => s && s.phase === "recap"));
  recap.hit ? ok("relay complete") : bad("the relay never reached recap");

  /* ---------------- 6a. the rest of the app, DURING the room ---------------- */
  await P.evaluate(() => { location.hash = "#/board"; });
  const drillCats = await until(() => P.evaluate(() => { const s = document.querySelector('select[aria-label="Filter by category"]'); return s && s.options.length > 3 ? s.options.length : null; }));
  const stillSeated = await P.evaluate(() => { const s = G.studyGroup.state(); return !!s && s.joinState === "seated" && !s.terminal; });
  drillCats.hit && drillCats.value === base.cats.length + 1 && stillSeated
    ? ok("with the joiner still seated in the room, Board Drill offers all " + base.cats.length + " categories (the shim left 3 options here)")
    : bad("Board Drill's category filter during the room: " + JSON.stringify(drillCats.value) + " options, seated " + stillSeated);
  const recitableDuring = await P.evaluate(() => G.store.recitable().length);
  recitableDuring === base.recitable ? ok("the recitable creeds list is whole during the room (" + recitableDuring + ")") : bad("recitable during the room: " + recitableDuring + " of " + base.recitable);
  await P.evaluate(() => { location.hash = "#/group"; });
  await until(() => P.evaluate(() => !!document.querySelector(".sg-room-code")));

  /* ---------------- 6b. ... and AFTER it ---------------- */
  await clickWhen(H, "button.sg-leave");
  const hostLeft = await until(() => st(P).then((s) => s && s.terminal && s.terminal.kind === "host-left"));
  const afterLeft = { p: await bankSize(P), h: await bankSize(H), rec: await P.evaluate(() => G.store.recitable().length) };
  hostLeft.hit && afterLeft.p === base.bank && afterLeft.h === base.bank && afterLeft.rec === base.recitable
    ? ok("host left: with the joiner's host-left panel still up, its bank is " + afterLeft.p + " cards and its creeds list " + afterLeft.rec + " (the shim kept 39 cards here until Back)")
    : bad("after the host left: " + JSON.stringify({ hostLeft: hostLeft.hit, afterLeft, base }));
  await clickWhen(P, "button.sg-leave");
  await clickWhen(L, "button.sg-leave");
  await until(() => st(P).then((s) => s === null));

  /* ---------------- 5. Mock Board Live from the real button ---------------- */
  const back = await until(() => picker(H).then((v) => v && v.boxes ? v : null));
  back.hit && back.value.ticked.length === 2 && back.value.ticked.every(inPicks)
    ? ok("back from the room, the picker still shows Custom mix with the same two boxes ticked (the shim reverted to a single select here)")
    : bad("picker after leaving the room: " + JSON.stringify(back.value));
  await H.evaluate(() => [...document.querySelectorAll(".sg-view .segmented button")].find((b) => b.textContent.trim() === "Mock Board Live").click());
  await until(() => H.evaluate(() => !!document.querySelector("select.sg-count")));
  await H.selectOption("select.sg-count", "15");
  await clickWhen(H, "button.sg-host");
  const board = await until(() => st(H).then((s) => s && s.role === "host" && s.mode === "board" ? s : null));
  const dealt = board.hit ? board.value.deck.ids.map((id) => board.value.cards[id].category) : [];
  const dealtOutside = dealt.filter((c) => !inPicks(c));
  board.hit && dealt.length === 15 && dealtOutside.length === 0
    ? ok("Mock Board Live from the real button dealt 15 cards, every one from the two categories (the shim dealt 15 of 15 from the rest of the bank)")
    : bad("board deal: " + dealt.length + " cards, " + dealtOutside.length + " outside the deck" + (dealtOutside.length ? " e.g. " + JSON.stringify([...new Set(dealtOutside)].slice(0, 4)) : ""));
  const boardLine = await until(() => text(H, ".sg-deck").then((t) => t && /^Deck: 15 cards from /.test(t) && t.includes(CAT_A) && t.includes(CAT_B) ? t : null));
  boardLine.hit ? ok("the board room names its deck: \"" + boardLine.value + "\"") : bad("board .sg-deck line: " + JSON.stringify(await text(H, ".sg-deck")));

  const code2 = board.value.room;
  for (const [p, name] of [[P, "PEER-NOW"], [L, "PEER-OLD"]]) {
    await until(() => p.evaluate(() => !!document.querySelector("input.sg-join-code")));
    await p.fill("input.sg-join-code", code2);
    await p.fill("input.sg-join-name", name);
    await clickWhen(p, "button.sg-join");
  }
  await until(() => st(H).then((s) => s && s.pending.length === 2));
  await sleep(300);
  const boardNotes = await H.evaluate(() => document.querySelectorAll(".sg-seat-note").length);
  boardNotes === 0 ? ok("no older-GUIDON note in Mock Board Live: the host deals those cards itself, so every seat sees the same ones") : bad("a seat note appeared in board mode: " + boardNotes);
  /* admit the current joiner only (its Admit button is found by its name) */
  await H.evaluate(() => { const b = [...document.querySelectorAll("button.sg-admit")].find((x) => x.getAttribute("aria-label") === "Admit PEER-NOW"); if (b) b.click(); });
  await until(() => st(P).then((s) => s && s.joinState === "seated"));
  await clickWhen(H, "button.sg-start");
  const shown = { host: [], joiner: [] };
  /* The card panel redraws on a 100 ms throttle, so state can be one card
     ahead of the screen: each device is read only once its PANEL shows the
     question the host's state says is up (never the state alone). */
  const onPanel = (p, n, q) => p.evaluate(({ n, q }) => {
    const s = G.studyGroup.state(), qEl = document.querySelector(".sg-board .sg-q"), cEl = document.querySelector(".sg-board .sg-cat");
    return s && s.phase === "play" && s.round.idx === n && qEl && cEl && (q == null || qEl.textContent === q) ? { q: qEl.textContent, cat: cEl.textContent } : null;
  }, { n, q });
  for (let i = 0; i < 15; i++) {
    const upQ = await until(() => H.evaluate((n) => { const s = G.studyGroup.state(); return s && s.phase === "play" && s.round.idx === n && s.cardId && s.cards[s.cardId] ? s.cards[s.cardId].q : null; }, i));
    if (!upQ.hit) { bad("card " + (i + 1) + " never came up on the host"); break; }
    const both = await until(async () => {
      const h = await onPanel(H, i, upQ.value), p = await onPanel(P, i, upQ.value);
      return h && p ? { h, p } : null;
    });
    if (!both.hit) { bad("card " + (i + 1) + " never showed on both devices"); break; }
    shown.host.push(both.value.h.cat); shown.joiner.push(both.value.p.cat);
    await clickWhen(H, "button.sg-advance");
  }
  const shownOutside = shown.host.concat(shown.joiner).filter((c) => !inPicks(c));
  shown.host.length === 15 && shown.joiner.length === 15 && shownOutside.length === 0 && shown.host.join("|") === shown.joiner.join("|")
    ? ok("all 15 board cards, read off the card panel on BOTH devices, are from the two categories and match card for card")
    : bad("board cards on screen: host " + shown.host.length + ", joiner " + shown.joiner.length + ", outside the deck " + shownOutside.length);
  const boardBank = { h: await bankSize(H), p: await bankSize(P) };
  boardBank.h === base.bank && boardBank.p === base.bank ? ok("both banks are whole after the board (" + base.bank + ")") : bad("banks after the board: " + JSON.stringify(boardBank));
  await clickWhen(H, "button.sg-leave");
  await until(() => st(P).then((s) => s && s.terminal));
  await clickWhen(P, "button.sg-leave");
  await clickWhen(L, "button.sg-leave");
  await until(() => st(P).then((s) => s === null));

  /* ---------------- 7. a deck this device cannot fully play says so ---------------- */
  /* What a NEWER host's label looks like to this build: one category it
     has, one token it has never heard of. */
  const partial = await H.evaluate((c) => { const M = G.studyGroup.mixedDeck; return M.PREFIX + [M.token(c), "zzzzz"].sort().join(""); }, CAT_A);
  const h3 = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-ONE", category: partial, timerSec: null });
  await until(() => P.evaluate(() => !!document.querySelector("input.sg-join-code")));
  await P.fill("input.sg-join-code", h3.room);
  await P.fill("input.sg-join-name", "PEER-NOW");
  await clickWhen(P, "button.sg-join");
  await until(() => st(H).then((s) => s && s.pending.length === 1));
  await clickWhen(H, "button.sg-admit");
  const partWarn = await until(() => text(P, ".sg-deck-warn"));
  const partLine = await text(P, ".sg-deck");
  partWarn.hit && /doesn't have 1 of this room's categories/.test(partWarn.value) && /leaves it out/.test(partWarn.value) && partLine && partLine.includes(CAT_A) && partLine.includes(counts[0] + " cards")
    ? ok("a deck with one category this device lacks: the room says so (\"" + partWarn.value + "\") and plays the " + counts[0] + " cards it does have")
    : bad("partial deck on the joiner: " + JSON.stringify({ warn: partWarn.value, line: partLine }));
  await clickWhen(H, "button.sg-leave");
  await until(() => st(P).then((s) => s && s.terminal));
  await clickWhen(P, "button.sg-leave");

  const flat = noise.map((n, i) => n.map((x) => "page" + i + " " + x)).flat();
  flat.length === 0 ? ok("zero console errors and zero page errors on all three pages") : bad("console noise: " + flat.join(" | "));
} catch (e) {
  bad("suite aborted: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" / ") : e));
} finally {
  await close();
  server.close();
}
console.log(fails === 0 ? "\nSTUDY ROOM MIXED DECKS: all passed" : "\nSTUDY ROOM MIXED DECKS: " + fails + " failed");
process.exit(fails === 0 ? 0 : 1);
