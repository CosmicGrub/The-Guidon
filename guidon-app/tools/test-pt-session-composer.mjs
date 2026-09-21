/**
 * PT Planner's custom "Build your own session" composer (ROADMAP 3g,
 * app-modules/pt-planner.js) - Phase 1: plain-button Add/Move up/Move down/
 * Remove, naming, saving, using the result exactly like a built-in session,
 * and deleting one gracefully.
 *
 * WHY THIS SUITE EXISTS: without it, a regression here would go unnoticed by
 * every other suite - test-pt-planner-behaviour.mjs only ever exercises
 * PRESETS ids, never a Soldier-authored session. Nothing else would catch a
 * composer that builds a session no picker ever lists, an Add/Move/Remove
 * that silently drops a block, a save that never reaches storage, or a
 * deleted session that corrupts (rather than gracefully degrades) the day it
 * was assigned to.
 *
 * House rules (tools/lint-test-hygiene.mjs holds this suite to all of them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn),
 *     clickWhenStable(page, target) wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - no literal deck sizes: this suite never assumes a second drill exists -
 *     it only ever adds "pd" (Preparation Drill), today's one real drill,
 *     twice (duplicates are allowed by design);
 *   - one browser: bootApp() once, seeded with a finished profile (a Guest
 *     session saves nothing, and this suite is entirely about what gets
 *     saved);
 *   - drive the real screen, never stub the composer, and end with the
 *     zero-console-noise check.
 */
import { bootApp, ok, bad, check, finish, waitForRoute, clickWhenStable, until, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

const CUSTOM_KEY = "guidon:prt:customSessions:v1";
const SESSION_NAME = "Leg day";

const boot = await bootApp({ viewport: { width: 390, height: 844 }, profile: PERSONAL_PROFILE });
const { page, noise } = boot;

const storedCustom = () => page.evaluate((k) => window.G.db.getSetting(k, []), CUSTOM_KEY);
const storedPlan = () => page.evaluate(() => window.G.db.getSetting("prt:plan:v1", null));
const live = () => page.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
// util.announce() (src/index.html) clears the live region, then writes the
// real message 30ms later via setTimeout - a deliberate re-announcement
// trick for screen readers, but it means a check that only waits for a DOM
// side effect (a redrawn list, a closed panel) can read the region before
// that write lands. This waits for the region to actually match first.
const waitForAnnounce = async (pattern) => {
  await until(page, (src) => new RegExp(src).test((document.getElementById("a11y-live") || {}).textContent || ""), pattern.source);
  return live();
};
const focusDesc = () => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return "BODY";
  const attrs = Array.from(a.attributes).filter((x) => /^data-pt-build/.test(x.name)).map((x) => x.name + "=" + x.value);
  return a.tagName.toLowerCase() + (attrs.length ? "[" + attrs.join(",") + "]" : "") + ":" + (a.textContent || "").trim().slice(0, 30);
});

await waitForRoute(page, "#/pt-plan", { ready: "[data-pt-sessions]" });

/* ---- entry point + palette ------------------------------------------- */
check((await page.locator("[data-pt-build-open]").count()) === 1, "PT Planner shows a \"Build your own session\" entry point", "no [data-pt-build-open] button found on #/pt-plan");
await clickWhenStable(page, "[data-pt-build-open]");
await until(page, () => !!document.querySelector("[data-pt-build-palette]"));
const paletteText = await page.locator("[data-pt-build-palette]").innerText();
check(/Preparation Drill/.test(paletteText) && !/content pending/i.test(paletteText),
  "the palette lists Preparation Drill, not tagged pending (it is the one fully-verified drill)", "palette: " + JSON.stringify(paletteText));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, "the open composer fits 390px with no horizontal scroll", "overflow: " + overflow + "px");

const anyDraggable = await page.evaluate(() => !!document.querySelector('[data-pt-sessions] [draggable="true"]'));
check(!anyDraggable, "no draggable attribute anywhere in the composer - native drag-and-drop is a deliberate Phase 2 follow-up, not built here", "a [draggable=\"true\"] element was found inside the composer");

/* ---- Add: build a 2-block session (duplicates of the one real drill) -- */
await clickWhenStable(page, '[data-pt-build-add="pd"]');
await until(page, () => document.querySelectorAll("[data-pt-build-canvas] li").length === 1);
let spoken = await waitForAnnounce(/^Added Preparation Drill\. 1 item in this session\.$/);
check(/^Added Preparation Drill\. 1 item in this session\.$/.test(spoken), "adding the first block announces the running count", "announced: " + JSON.stringify(spoken));

await clickWhenStable(page, '[data-pt-build-add="pd"]');
await until(page, () => document.querySelectorAll("[data-pt-build-canvas] li").length === 2);
spoken = await waitForAnnounce(/^Added Preparation Drill\. 2 items in this session\.$/);
check(/^Added Preparation Drill\. 2 items in this session\.$/.test(spoken), "adding a second block announces \"2 items\"", "announced: " + JSON.stringify(spoken));

/* ---- Move up/down: edges disabled, reordering announced and refocused - */
let edges = await page.evaluate(() => ({
  up0: document.querySelector('[data-pt-build-up="0"]').getAttribute("aria-disabled"),
  down1: document.querySelector('[data-pt-build-down="1"]').getAttribute("aria-disabled"),
  up1: document.querySelector('[data-pt-build-up="1"]').getAttribute("aria-disabled"),
  down0: document.querySelector('[data-pt-build-down="0"]').getAttribute("aria-disabled"),
}));
check(edges.up0 === "true" && edges.down1 === "true" && edges.up1 !== "true" && edges.down0 !== "true",
  "Move up is disabled on the first item, Move down on the last, and neither elsewhere", "edge states: " + JSON.stringify(edges));

await clickWhenStable(page, '[data-pt-build-down="0"]');
spoken = await waitForAnnounce(/^Moved Preparation Drill down\. Now last\.$/);
check(/^Moved Preparation Drill down\. Now last\.$/.test(spoken), "moving the first item down announces its new position", "announced: " + JSON.stringify(spoken));
let f = await focusDesc();
check(f.indexOf("data-pt-build-down=1") !== -1, "focus lands on that item's own Move-down button at its new (last) position, not <body>", "focus after the move: " + f);

await clickWhenStable(page, '[data-pt-build-up="1"]');
spoken = await waitForAnnounce(/^Moved Preparation Drill up\. Now first\.$/);
check(/^Moved Preparation Drill up\. Now first\.$/.test(spoken), "moving it back up announces \"Now first.\"", "announced: " + JSON.stringify(spoken));
f = await focusDesc();
check(f.indexOf("data-pt-build-up=0") !== -1, "...and focus follows it back to index 0's own Move-up button", "focus after the move: " + f);

/* ---- Remove one, leaving a single block ------------------------------- */
await clickWhenStable(page, '[data-pt-build-remove="1"]');
await until(page, () => document.querySelectorAll("[data-pt-build-canvas] li").length === 1);
spoken = await waitForAnnounce(/^Removed Preparation Drill\. 1 item in this session\.$/);
check(/^Removed Preparation Drill\. 1 item in this session\.$/.test(spoken), "removing a block announces the new count", "announced: " + JSON.stringify(spoken));
f = await focusDesc();
check(f !== "BODY", "focus is not dropped to <body> after Remove (" + f + ")", "focus fell to <body> after Remove");

/* ---- Name it, set an effort, and save --------------------------------- */
const saveDisabledBeforeName = await page.locator("[data-pt-build-save]").getAttribute("aria-disabled");
check(saveDisabledBeforeName === "true", "Save stays disabled while the session has no name yet", "aria-disabled=" + JSON.stringify(saveDisabledBeforeName));
await page.locator("[data-pt-build-name]").fill(SESSION_NAME);
await until(page, () => document.querySelector("[data-pt-build-save]").getAttribute("aria-disabled") !== "true");
await page.locator("[data-pt-build-effort]").selectOption("hard");
await clickWhenStable(page, "[data-pt-build-save]");
await until(page, () => !document.querySelector("[data-pt-build-palette]"));
const savedAnnouncePattern = new RegExp("^Saved \"" + SESSION_NAME + "\"\\. Available for any day this week\\.$");
spoken = await waitForAnnounce(savedAnnouncePattern);
check(savedAnnouncePattern.test(spoken), "saving announces the session by name", "announced: " + JSON.stringify(spoken));

const saved = await storedCustom();
check(Array.isArray(saved) && saved.length === 1, "exactly one custom session is stored", "stored: " + JSON.stringify(saved));
const rec = saved[0];
check(!!rec && rec.label === SESSION_NAME && rec.effort === "hard" && Array.isArray(rec.blocks) && rec.blocks.length === 1 && rec.blocks[0].drillId === "pd",
  "the stored record has the real name, effort and block the composer built - not a placeholder", "stored record: " + JSON.stringify(rec));
const customId = rec.id;

/* ---- It appears in the day-assignment picker and can be assigned ------ */
const mondayOptions = await page.locator('select[data-pt-session="mon"] option').allTextContents();
check(mondayOptions.includes(SESSION_NAME), "the day-assignment picker lists the new custom session, by name, alongside the built-in ones", "Monday's options: " + JSON.stringify(mondayOptions));

await page.locator('select[data-pt-session="mon"]').selectOption(customId);
await until(page, (id) => window.G.db.getSetting("prt:plan:v1", null).then((pl) => !!(pl && pl.days && pl.days.mon && pl.days.mon.id === id)), customId);
const plan1 = await storedPlan();
check(plan1.days.mon.id === customId && plan1.days.mon.title === SESSION_NAME && plan1.days.mon.effort === "hard",
  "assigning it to Monday stores the custom session's id, title and effort", "Monday entry: " + JSON.stringify(plan1.days.mon));

/* ---- The assigned day's summary shows the real blocks - the SAME code
   path a built-in session's "Session blocks:" line already uses --------- */
await until(page, (id) => !!document.querySelector('[data-pt-session-blocks="' + id + '"]'), customId);
const summaryText = await page.locator('[data-pt-session-blocks="' + customId + '"]').innerText();
check(/Preparation Drill/.test(summaryText), "Monday's card shows \"Session blocks: Preparation Drill\", exactly like a built-in session would", "summary line: " + JSON.stringify(summaryText));

/* ---- Manage custom sessions: listed, deletable with confirmation ------ */
const manageText = await page.locator("[data-pt-sessions]").innerText();
check(new RegExp(SESSION_NAME).test(manageText) && /Manage custom sessions/.test(manageText), "the saved session appears under \"Manage custom sessions\"", "sessions panel: " + JSON.stringify(manageText));

await clickWhenStable(page, '[data-pt-build-delete="' + customId + '"]');
const dlg = page.locator(".gm-box");
await dlg.waitFor({ state: "visible", timeout: 5000 });
const dlgText = await dlg.innerText();
check(new RegExp(SESSION_NAME).test(dlgText), "deleting asks for confirmation, naming the session", "dialog text: " + JSON.stringify(dlgText));
await dlg.locator("button", { hasText: /^Delete$/ }).click();
// Wait for the dialog to actually finish closing (its own confirm() Promise
// only resolves once the close animation/fallback timer completes - see
// util.modalTrap) before polling storage; polling storage immediately after
// the click can race the handler, which has not started its own await chain
// yet.
await until(page, () => !document.querySelector(".gm-box"));
await until(page, (k) => window.G.db.getSetting(k, []).then((list) => list.length === 0), CUSTOM_KEY);
check((await storedCustom()).length === 0, "confirming removes the stored custom session", "custom sessions after delete: " + JSON.stringify(await storedCustom()));
spoken = await waitForAnnounce(/^Deleted "/);
check(/^Deleted "/.test(spoken), "deleting announces which session was removed", "announced: " + JSON.stringify(spoken));

/* ---- The day that had it assigned degrades gracefully, not brokenly --- */
const plan2 = await storedPlan();
check(plan2.days.mon.id === "custom" && plan2.days.mon.title === SESSION_NAME && plan2.days.mon.effort === "hard" && plan2.days.mon.sessionId === "",
  "Monday degrades to a plain custom PT entry that keeps the old name and effort - the same fallback an unrecognized id already got before this feature existed",
  "Monday entry after delete: " + JSON.stringify(plan2.days.mon));
const mondayOptionsAfter = await page.locator('select[data-pt-session="mon"] option').allTextContents();
check(mondayOptionsAfter.filter((t) => t === SESSION_NAME).length === 0, "the deleted session no longer appears in the day-assignment picker", "Monday's options after delete: " + JSON.stringify(mondayOptionsAfter));
check(!(await page.locator('[data-pt-session-blocks="' + customId + '"]').count()), "...and the now-gone \"Session blocks:\" line is gone too, not left dangling", "the session-blocks line for the deleted session is still on screen");

/* ---- Cancel: confirms before discarding real (unsaved) work ----------- */
await clickWhenStable(page, "[data-pt-build-open]");
await until(page, () => !!document.querySelector("[data-pt-build-palette]"));
await clickWhenStable(page, '[data-pt-build-add="pd"]');
await until(page, () => document.querySelectorAll("[data-pt-build-canvas] li").length === 1);
await clickWhenStable(page, "[data-pt-build-cancel]");
const dlg2 = page.locator(".gm-box");
await dlg2.waitFor({ state: "visible", timeout: 5000 });
await dlg2.locator("button", { hasText: /^Cancel$/ }).click();
await until(page, () => !document.querySelector(".gm-box"));
check(!!(await page.locator("[data-pt-build-palette]").count()), "canceling the confirmation keeps the in-progress builder open (nothing was lost)", "the builder closed even though discarding it was itself canceled");
await clickWhenStable(page, "[data-pt-build-cancel]");
await dlg2.waitFor({ state: "visible", timeout: 5000 });
await dlg2.locator("button", { hasText: /^Discard$/ }).click();
await until(page, () => !document.querySelector("[data-pt-build-palette]"));
check((await storedCustom()).length === 0, "discarding really discards - nothing new reached storage", "custom sessions: " + JSON.stringify(await storedCustom()));

/* ---- A blank build never gets asked about (nothing to lose) ----------- */
await clickWhenStable(page, "[data-pt-build-open]");
await until(page, () => !!document.querySelector("[data-pt-build-palette]"));
await clickWhenStable(page, "[data-pt-build-cancel]");
await until(page, () => !document.querySelector("[data-pt-build-palette]"));
check((await page.locator(".gm-box").count()) === 0, "canceling an empty, untouched builder (no blocks added) does not ask for confirmation", "a confirmation dialog appeared for an empty builder with nothing to lose");

expectNoConsoleNoise(noise);
await finish("PT SESSION COMPOSER");
