/**
 * Squad MOI Briefing Tracker (leader.js Phase 2 of the MOI Import overhaul,
 * G.leader's new guidon:leader:roster:moi:v1 snapshot + moiBriefed field)
 * and the one small moi-import.js addition it depends on (build()'s new
 * "Due date (optional)" input, threaded onto plan.dueDate).
 *
 * WHY THIS SUITE EXISTS: this feature resolves a real privacy tension - a
 * naive "let a leader see each Soldier's own MOI coverage gaps" would leak
 * a Soldier's own guidon:moi:plans:v1 data onto a device that belongs to
 * someone else, which GUIDON has no channel for and must never grow one.
 * The shipped design is narrower and privacy-respecting: a leader-entered
 * DATE per Soldier ("has this Soldier been walked through the MOI"),
 * exactly like counseled/aft/wpn/ncoer already work, plus a deliberately
 * tiny 5-scalar snapshot of the attached plan (name/importedAt/dueDate/
 * topicCount/savedAt - never citations, topics or coverage). If any of
 * that regressed - the snapshot grew a citation list, moiBriefed got read
 * from the Soldier's own plan instead of leader-typed, Detach wiped a
 * Soldier's recorded date, or the picker vanished with two saved plans -
 * nothing else in this codebase would notice. Every assertion below is
 * written to actually fail against that broken behaviour, not just against
 * the feature being totally absent.
 *
 * House rules (tools/lint-test-hygiene.mjs holds this suite to all of
 * them): no fixed sleeps - waitForRoute(..., { ready }) / until() /
 * clickWhenStable() wait for real state; one browser (bootApp() once);
 * drive the real screens (#/moi's own textarea/Build, #/leader's own
 * Attach/date-input/Remind-me/Detach buttons), never stub the thing under
 * test; ends with the zero-console-noise check.
 */
import { bootApp, check, finish, waitForRoute, until, untilAsync, clickWhenStable, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

const boot = await bootApp({ profile: PERSONAL_PROFILE });
const { page, noise } = boot;

/* ========================================================================
   1) With no saved MOI plan at all, the "Attach an MOI" panel is
      absent/inert - not just visually collapsed, genuinely empty and
      display:none, no interactive controls a keyboard/screen-reader user
      could stumble into.
   ======================================================================== */
await waitForRoute(page, "#/leader", { ready: page.getByRole("button", { name: "+ Add Soldier" }) });

const emptyMoiState = await page.evaluate(() => {
  const p = document.getElementById("leader-moi-panel");
  if (!p) return { exists: false };
  return {
    exists: true,
    display: getComputedStyle(p).display,
    text: p.textContent.trim(),
    controls: p.querySelectorAll("button, input").length,
    role: p.getAttribute("role"),
  };
});
check(emptyMoiState.exists && emptyMoiState.display === "none" && emptyMoiState.controls === 0 && !emptyMoiState.text,
  "with no saved MOI plan, the Attach-an-MOI panel is absent/inert (display:none, no text, no controls)",
  () => JSON.stringify(emptyMoiState));

/* ---- Seed two Soldiers through the app's own real "+ Add Soldier" /
   field-edit flow (same technique test-leader.mjs and
   test-career-leader-grid.mjs already use), not a synthetic injection. ---- */
async function addSoldier() {
  const before = await page.evaluate(() => document.querySelectorAll('input[aria-label^="Rank for roster entry"]').length);
  await clickWhenStable(page, page.getByRole("button", { name: "+ Add Soldier" }));
  const added = await until(page, (n) => document.querySelectorAll('input[aria-label^="Rank for roster entry"]').length === n + 1, before);
  check(added, "Add Soldier creates roster entry #" + (before + 1));
}
await addSoldier();
await addSoldier();

await page.evaluate(() => {
  const set = (el, val) => { el.value = val; el.dispatchEvent(new Event("change", { bubbles: true })); };
  const ranks = document.querySelectorAll('input[aria-label^="Rank for roster entry"]');
  const names = document.querySelectorAll('input[aria-label^="Initials or roster number"]');
  set(ranks[0], "SPC"); set(names[0], "A.A.");
  set(ranks[1], "SGT"); set(names[1], "B.B.");
});
const rosterSeeded = await untilAsync(page, async () => {
  const r = await window.G.db.get("kv", window.G.leader.KEY);
  return !!(r && r.v && r.v.length === 2 && r.v[0].name === "A.A." && r.v[1].name === "B.B.");
});
check(rosterSeeded, "both Soldiers' rank/initials persisted before the MOI tracker touches the roster");

/* ========================================================================
   2) Import a real MOI plan through #/moi (also exercises the one
      moi-import.js addition under test: the "Due date (optional)" input
      in build()'s Review+Build panel, threaded onto plan.dueDate).
   ======================================================================== */
await waitForRoute(page, "#/moi", { ready: page.getByRole("button", { name: "Import an MOI" }) });
await clickWhenStable(page, page.getByRole("button", { name: "Import an MOI" }));
const captureShown = await until(page, () => !!document.querySelector("textarea"));
check(captureShown, "Capture screen shows a paste textarea");

await page.evaluate((text) => {
  const ta = document.querySelector("textarea");
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, "Study ADP 6-22 before the board.");
await clickWhenStable(page, page.getByRole("button", { name: "Find my topics" }));
const reviewShown = await until(page, () => /Review your matches/.test(document.body.textContent || "") && !!document.getElementById("moi-opt-duedate"));
check(reviewShown, "Review screen renders with the new 'Due date (optional)' input present");

const PLAN_A_DUE = "2026-12-15";
await page.evaluate((d) => {
  const inp = document.getElementById("moi-opt-duedate");
  inp.value = d;
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}, PLAN_A_DUE);

await clickWhenStable(page, page.locator("button", { hasText: /^Build/ }));
const builtOk = await untilAsync(page, async (due) => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return !!(r && Array.isArray(r.v) && r.v.length === 1 && r.v[0].current && r.v[0].current.dueDate === due && r.v[0].current.topics.length > 0);
}, PLAN_A_DUE);
check(builtOk, "Building Plan A persists one plan family with the due date I typed threaded onto plan.dueDate (moi-import.js's own addition)");

const planA = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  const f = r.v[0];
  return { id: f.id, name: f.current.name, dueDate: f.current.dueDate, topicCount: f.current.topics.length };
});

/* ========================================================================
   3) Back on #/leader: with exactly one saved plan family, "Attach an
      MOI" offers a single direct Attach button (no picker needed).
      Attaching creates the roster-level 5-scalar snapshot and swaps the
      panel to "Squad MOI coverage".
   ======================================================================== */
await waitForRoute(page, "#/leader", { fresh: true, ready: "#leader-moi-panel" });

const attachOneState = await page.evaluate(() => {
  const p = document.getElementById("leader-moi-panel");
  return { text: p.textContent, buttons: [...p.querySelectorAll("button")].map((b) => b.textContent.trim()) };
});
check(/Attach an MOI/.test(attachOneState.text), "with one saved MOI plan, the Attach-an-MOI panel appears", () => JSON.stringify(attachOneState));
check(attachOneState.buttons.length === 1 && attachOneState.buttons[0].indexOf("Attach ") === 0,
  "exactly one direct Attach button is offered when only one plan family exists (no picker)", () => JSON.stringify(attachOneState.buttons));

await clickWhenStable(page, page.locator("#leader-moi-panel button", { hasText: /^Attach / }));
const attached = await untilAsync(page, async (planA) => {
  const r = await window.G.db.get("kv", window.G.leader.MOI_KEY);
  return !!(r && r.v && r.v.name === planA.name && r.v.dueDate === planA.dueDate && r.v.topicCount === planA.topicCount && typeof r.v.savedAt === "number");
}, planA);
check(attached, "Attach writes the roster-level snapshot copying exactly name/importedAt/dueDate/topicCount/savedAt from the chosen family");

// The snapshot is deliberately small - never a citation list, topic names or
// coverage. A raw one-shot G.db.get() here (no retry) crashed under heavy CI
// load with "Cannot read properties of undefined (reading 'v')" - the row
// the until() above just confirmed exists became transiently unreadable on
// the very next call under contention. Wait for a settled, readable row
// (same two-step wait-then-read shape as `attached` above) before reading
// its shape, instead of trusting a single call to observe it immediately.
const snapshotReadable = await untilAsync(page, async () => {
  const r = await window.G.db.get("kv", window.G.leader.MOI_KEY);
  return !!(r && r.v);
});
check(snapshotReadable, "the snapshot row is settled and readable before inspecting its shape");
const snapshotShape = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.leader.MOI_KEY);
  return (r && r.v) ? Object.keys(r.v).sort() : null;
});
check(JSON.stringify(snapshotShape) === JSON.stringify(["dueDate", "importedAt", "name", "savedAt", "topicCount"].sort()),
  "the snapshot holds exactly the 5 documented scalar fields, nothing more", () => JSON.stringify(snapshotShape));

const coverageShown = await until(page, () => /Squad MOI coverage/.test((document.getElementById("leader-moi-panel") || {}).textContent || ""));
check(coverageShown, "the panel swaps to 'Squad MOI coverage' once the snapshot exists");

const coverage1 = await page.evaluate(() => {
  const p = document.getElementById("leader-moi-panel");
  return { text: p.textContent, role: p.getAttribute("role"), live: p.getAttribute("aria-live"), rows: p.querySelectorAll("[data-moi-row-idx]").length };
});
check(coverage1.role === "status" && coverage1.live === "polite",
  "the coverage panel is a live region (role=status aria-live=polite), matching buildSummary()'s own established convention", () => JSON.stringify(coverage1));
check(/0 of 2 Soldiers briefed/.test(coverage1.text), "the tally reads '0 of 2 briefed' before anyone is marked", () => coverage1.text);
check(coverage1.rows === 2, "one moiBriefed date row is rendered per Soldier on the roster", () => coverage1.rows);

/* ========================================================================
   4) Marking one Soldier's moiBriefed date updates the tally correctly,
      persists on the roster entry itself, and the row's own hint updates
      in place (the exact date-input + persist() + hint-refresh shape
      counseled/aft/wpn/ncoer already use).
   ======================================================================== */
const BRIEFED_DATE = "2026-11-01"; // before PLAN_A_DUE
await page.evaluate(({ idx, val }) => {
  const row = document.querySelector('[data-moi-row-idx="' + idx + '"]');
  const inp = row.querySelector('input[type="date"]');
  inp.value = val;
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}, { idx: 0, val: BRIEFED_DATE });

const tallyUpdated = await until(page, () => /1 of 2 Soldiers briefed/.test((document.getElementById("leader-moi-panel") || {}).textContent || ""));
check(tallyUpdated, "marking Soldier 0's moiBriefed date updates the tally to '1 of 2 briefed'");

const rosterAfterMark = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.leader.KEY);
  return r.v.map((s) => s.moiBriefed);
});
check(rosterAfterMark[0] === BRIEFED_DATE && rosterAfterMark[1] === "",
  "moiBriefed is stored inline on the roster entry itself, exactly like counseled/aft/wpn/ncoer", () => JSON.stringify(rosterAfterMark));

const hint0 = await page.evaluate(() => document.querySelector('[data-moi-row-idx="0"] .hint').textContent);
check(hint0.indexOf(BRIEFED_DATE) !== -1 && /On time/.test(hint0), "the briefed Soldier's own hint reflects the date and that it was before the due date", () => hint0);

/* ========================================================================
   5) "Remind me" per Soldier: hidden once briefed (nothing left to remind
      about), offered while not yet briefed, and creates a real reminder
      stamped with a PER-SOLDIER source ("leader-moi:" + roster index).
   ======================================================================== */
const remindVisibility = await page.evaluate(() => {
  function remindBtn(idx) {
    const row = document.querySelector('[data-moi-row-idx="' + idx + '"]');
    return [...row.querySelectorAll("button")].find((b) => /Remind/.test(b.textContent));
  }
  const b0 = remindBtn(0), b1 = remindBtn(1);
  return {
    briefedHidden: !b0 || getComputedStyle(b0).display === "none",
    unbriefedShown: !!b1 && getComputedStyle(b1).display !== "none",
  };
});
check(remindVisibility.briefedHidden, "the already-briefed Soldier's Remind-me button is hidden", () => JSON.stringify(remindVisibility));
check(remindVisibility.unbriefedShown, "the not-yet-briefed Soldier still offers a working Remind-me button", () => JSON.stringify(remindVisibility));

await page.evaluate(() => {
  const row = document.querySelector('[data-moi-row-idx="1"]');
  const btn = [...row.querySelectorAll("button")].find((b) => /^Remind me$/.test(b.textContent.trim()));
  btn.click();
});
const reminded = await untilAsync(page, async () => (await window.G.reminders.load()).some((r) => r.source === "leader-moi:1"));
check(reminded, "clicking Remind me on the un-briefed Soldier creates a real reminder stamped source:\"leader-moi:1\"");

const reminderRow = await page.evaluate(async () => (await window.G.reminders.load()).find((r) => r.source === "leader-moi:1"));
check(!!reminderRow && reminderRow.kind === "other" && reminderRow.date === PLAN_A_DUE && /B\.B\./.test(reminderRow.label || ""),
  "the reminder carries kind \"other\" (this file's own no-dedicated-kind fallback, same as NCOER), the MOI's real due date, and names the Soldier",
  () => JSON.stringify(reminderRow));

/* ========================================================================
   6) With TWO saved plan families, attaching (via "Replace shared MOI",
      since one is already attached) lets the leader pick which one -
      the same card-results-grid picker convention moi-import.js's own
      menu() already uses for "pick one of several saved plans".
   ======================================================================== */
await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  const families = (r && r.v) || [];
  families.push({
    id: "moi-test-planB",
    createdAt: Date.now(),
    current: {
      name: "Plan B Test MOI",
      importedAt: Date.now(),
      dueDate: "2027-01-10",
      topics: ["Topic One", "Topic Two", "Topic Three"],
      topicCoverage: {}, topicLinks: {}, topicTiers: {},
      groups: null, generatedDrillCategories: [],
    },
    history: [],
  });
  await window.G.db.put("kv", { k: window.G.moiImport.PLANS_KEY, v: families });
});

await waitForRoute(page, "#/leader", { fresh: true, ready: "#leader-moi-panel" });
const stillCoverage = await until(page, () => /Squad MOI coverage/.test((document.getElementById("leader-moi-panel") || {}).textContent || ""));
check(stillCoverage, "re-opening the roster with a snapshot already attached shows the coverage panel again (the snapshot persists across visits)");

await clickWhenStable(page, page.locator("#leader-moi-panel button", { hasText: "Replace shared MOI" }));
const pickerShown = await until(page, () => {
  const p = document.getElementById("leader-moi-panel");
  return /Attach an MOI/.test(p.textContent) && /Pick which one/.test(p.textContent);
});
check(pickerShown, "with two saved plan families, Replace opens the multi-family picker instead of a single direct Attach button");

const pickerNames = await page.evaluate(() => [...document.querySelectorAll("#leader-moi-panel .card-results-grid button")].map((b) => b.textContent));
check(pickerNames.length === 2 && pickerNames.some((t) => t.indexOf("Plan B Test MOI") !== -1) && pickerNames.some((t) => t.indexOf(planA.name) !== -1),
  "the picker lists both saved plan families by name and import date", () => JSON.stringify(pickerNames));

await clickWhenStable(page, page.locator("#leader-moi-panel .card-results-grid button", { hasText: "Plan B Test MOI" }));
const switched = await untilAsync(page, async () => {
  const r = await window.G.db.get("kv", window.G.leader.MOI_KEY);
  return !!(r && r.v && r.v.name === "Plan B Test MOI" && r.v.topicCount === 3 && r.v.dueDate === "2027-01-10");
});
check(switched, "picking Plan B overwrites the snapshot with Plan B's own name/dueDate/topicCount");

// The snapshot write above and the old-reminder sweep are two separate
// effects of the same replace action - waiting only for the snapshot (above)
// does not guarantee the sweep has ALSO landed yet, so this needs its own
// real wait rather than a single unguarded read right after.
const sweepSettled = await untilAsync(page, async () => !(await window.G.reminders.load()).some((r) => r.source === "leader-moi:1"));
const sweptOnReplace = !sweepSettled;
check(!sweptOnReplace, "replacing the attached MOI sweeps the OLD snapshot's per-soldier reminders first (leader-moi:1 is gone)");

const rosterAfterReplace = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.leader.KEY);
  return r.v.map((s) => s.moiBriefed);
});
check(rosterAfterReplace[0] === BRIEFED_DATE && rosterAfterReplace[1] === "",
  "replacing the shared MOI leaves every Soldier's own moiBriefed date exactly as recorded", () => JSON.stringify(rosterAfterReplace));

/* ========================================================================
   7) Detach removes ONLY the roster-level snapshot. Every Soldier's own
      moiBriefed date stays exactly as recorded - it is the leader's own
      completed-action record, not a live sync flag.
   ======================================================================== */
await clickWhenStable(page, page.locator("#leader-moi-panel button", { hasText: "Detach shared MOI" }));
const modalUp = await until(page, () => !!document.querySelector(".gm-back"));
check(modalUp, "Detach opens a confirm dialog before deleting anything (this file's own danger:true confirm pattern)");

await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-back button")].find((x) => /detach/i.test(x.textContent || ""));
  if (b) b.click();
});
const detached = await untilAsync(page, async () => {
  const r = await window.G.db.get("kv", window.G.leader.MOI_KEY);
  return !r;
});
check(detached, "confirming Detach deletes the guidon:leader:roster:moi:v1 row entirely");

const rosterAfterDetach = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.leader.KEY);
  return r.v.map((s) => s.moiBriefed);
});
check(rosterAfterDetach[0] === BRIEFED_DATE && rosterAfterDetach[1] === "",
  "Detach leaves every Soldier's moiBriefed date intact", () => JSON.stringify(rosterAfterDetach));

// buildMoiPanel() runs synchronously right after the snapshot delete, but
// that whole chain sits behind G.modal.confirm's own animation-gated
// promise (util.modalTrap's close() waits for a transitionend or a 400ms
// fallback before resolving - the same delay every other G.modal.confirm
// action in this app already has) - so wait for the real state, not just
// for the kv row to disappear.
const panelSwappedBack = await until(page, () => /Attach an MOI/.test((document.getElementById("leader-moi-panel") || {}).textContent || ""));
check(panelSwappedBack, "after Detach the panel swaps back to offering Attach");
const panelAfterDetach = await page.evaluate(() => {
  const p = document.getElementById("leader-moi-panel");
  return { display: getComputedStyle(p).display, text: p.textContent };
});
check(panelAfterDetach.display !== "none",
  "...and it is genuinely visible (both saved plan families are still available to pick from)", () => JSON.stringify(panelAfterDetach));

/* ========================================================================
   8) Re-attaching a different MOI afterward works cleanly.
   ======================================================================== */
const reattachOptions = await page.evaluate(() => [...document.querySelectorAll("#leader-moi-panel .card-results-grid button")].map((b) => b.textContent));
check(reattachOptions.length === 2, "post-Detach re-attach still offers a pick between both saved plan families", () => JSON.stringify(reattachOptions));

await clickWhenStable(page, page.locator("#leader-moi-panel .card-results-grid button", { hasText: planA.name }));
const reattached = await untilAsync(page, async (planA) => {
  const r = await window.G.db.get("kv", window.G.leader.MOI_KEY);
  return !!(r && r.v && r.v.name === planA.name && r.v.dueDate === planA.dueDate);
}, planA);
check(reattached, "re-attaching a different MOI (back to Plan A) after Detach works cleanly");

const tallyAfterReattach = await until(page, () => /1 of 2 Soldiers briefed/.test((document.getElementById("leader-moi-panel") || {}).textContent || ""));
check(tallyAfterReattach, "after re-attaching, the coverage tally still reflects the Soldier's earlier-recorded moiBriefed date (1 of 2 briefed)");

/* ---- 9) Zero console noise across the entire run. ---- */
expectNoConsoleNoise(noise);

await finish("LEADER MOI TRACKER");
