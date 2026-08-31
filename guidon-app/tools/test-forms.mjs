/**
 * Forms Trainer (#/forms, G.forms): the generic route sweep only confirms
 * the catalog list renders - it never clicks into a real form, types into
 * the (just-debounced) search box, fills a real field, saves a real draft,
 * or checks that a saved draft survives a reload. None of that had
 * interactive coverage before this.
 *
 * This exercises: the catalog list (34 real DA/DD forms) and its "Search
 * forms" box narrowing to (and showing the real zero-result empty message
 * for) a real query; opening a real form (DA Form 31, Request and Authority
 * for Leave) and switching to its "Fill" tab; filling a real text field and
 * a real <select> field; the real "Save draft" flow, which persists into kv
 * "forms:saved" (note: that row's array is stored under `.value`, not the
 * `.v` every other kv row uses - see forms.js's own sanitizeSaved()/
 * loadSaved() comments) with the real typed values; the saved-drafts card
 * appearing in the catalog list; that draft surviving a REAL page reload
 * (not just an in-memory re-render); and re-opening the reloaded draft to
 * confirm its real field values round-trip back into the Fill tab.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

async function openGuestSession() {
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await openGuestSession();

// Clean slate: forms:saved is a special-shaped kv row ({k, value: [...]}, not
// the {k, v} every other row uses) - see forms.js's own loadSaved() comment.
await page.evaluate(async () => { await window.G.db.put("kv", { k: "forms:saved", value: [] }); });
await page.evaluate(() => { location.hash = "#/forms"; });
await page.waitForTimeout(600);

// ---- catalog list ----
const totalForms = await page.evaluate(() => (window.G.store.forms().forms || []).length);
totalForms > 1 ? ok("fixture sanity: the forms catalog has " + totalForms + " real forms") : bad("forms catalog unexpectedly small: " + totalForms);

const heading = await page.evaluate(() => document.querySelector(".section-title h2")?.textContent);
heading === "Forms Trainer" ? ok("#/forms renders the Forms Trainer heading") : bad("heading: " + heading);

const initialCardCount = await page.evaluate(() => document.querySelectorAll(".form-card").length);
initialCardCount === totalForms ? ok("catalog list renders one card per real form (" + totalForms + ")") : bad("initial form-card count: " + initialCardCount);

// ---- search box: debounced, narrows to a real single match ----
await page.fill('input[aria-label="Search forms"]', "authority for leave");
await page.waitForTimeout(300);
const afterSearch = await page.evaluate(() => ({
  cards: document.querySelectorAll(".form-card").length,
  title: document.querySelector(".form-title")?.textContent,
  meta: Array.from(document.querySelectorAll(".meta")).map((e) => e.textContent).find((t) => /match/.test(t)),
}));
afterSearch.cards === 1 && afterSearch.title === "Request and Authority for Leave"
  ? ok("searching 'authority for leave' narrows the debounced search to DA Form 31 alone")
  : bad("search result: " + JSON.stringify(afterSearch));
afterSearch.meta === "1 match" ? ok("result-count line reads '1 match' for a single hit") : bad("meta text: " + JSON.stringify(afterSearch.meta));

// ---- search box: real empty state for a non-matching query ----
await page.fill('input[aria-label="Search forms"]', "zzzznonexistentxyz");
await page.waitForTimeout(300);
const emptyState = await page.evaluate(() => ({
  cards: document.querySelectorAll(".form-card").length,
  msg: document.querySelector(".empty")?.textContent || "",
}));
// Roadmap audit round 4, "UX: copy and label polish" bucket: this message
// used to be the bare "No forms match: <term>" with no quoting and no
// suggestion; now it quotes the term and offers "Try a different term."
// like every sibling empty-search state in the app.
emptyState.cards === 0 && emptyState.msg === "No forms match “zzzznonexistentxyz”. Try a different term."
  ? ok("a non-matching search shows the real zero-result empty message naming the query")
  : bad("empty-search state: " + JSON.stringify(emptyState));

// ---- open a real form ----
await page.fill('input[aria-label="Search forms"]', "authority for leave");
await page.waitForTimeout(300);
await page.locator(".form-card").first().click();
await page.waitForTimeout(300);

const detail = await page.evaluate(() => ({
  sectionTitle: document.querySelector(".forms-view .section-title")?.textContent,
  activeTab: document.querySelector(".segmented button.active")?.textContent,
  tabs: Array.from(document.querySelectorAll(".segmented button")).map((b) => b.textContent),
}));
detail.sectionTitle === "DA Form 31  —  Request and Authority for Leave"
  ? ok("opening the card navigates to the real form's detail view")
  : bad("detail section title: " + JSON.stringify(detail.sectionTitle));
detail.activeTab === "Form" ? ok("the detail view opens on the 'Form' (replica) tab by default") : bad("default active tab: " + detail.activeTab);
JSON.stringify(detail.tabs) === JSON.stringify(["Guided", "Form", "Fill", "Check"])
  ? ok("tab bar shows Guided/Form/Fill/Check for a form with no bullet libraries but with checks")
  : bad("tabs: " + JSON.stringify(detail.tabs));

// ---- switch to Fill, fill a real text field + a real select field ----
await page.locator(".segmented button", { hasText: /^Fill$/ }).click();
await page.waitForTimeout(200);

const fillFields = await page.evaluate(() => Array.from(document.querySelectorAll(".field")).map((f) => f.getAttribute("data-fid")));
JSON.stringify(fillFields) === JSON.stringify(["name", "type", "leaveaddr", "days", "dates"])
  ? ok("Fill tab renders one real field row per authored field, in order")
  : bad("fill field ids: " + JSON.stringify(fillFields));

const MARKER_NAME = "RIVERA, JORDAN A. / SPC — QA " + Date.now();
await page.fill('.field[data-fid="name"] input.in', MARKER_NAME);
await page.locator('.field[data-fid="type"] select.in').selectOption("Emergency");
await page.waitForTimeout(200);

const liveInputs = await page.evaluate(() => ({
  name: document.querySelector('.field[data-fid="name"] input.in')?.value,
  type: document.querySelector('.field[data-fid="type"] select.in')?.value,
}));
liveInputs.name === MARKER_NAME && liveInputs.type === "Emergency"
  ? ok("typed text field and selected <select> field hold the real entered values")
  : bad("live input values: " + JSON.stringify(liveInputs));

// ---- Save draft: real persistence into kv "forms:saved" (.value, not .v) ----
await page.locator("button", { hasText: /^Save draft$/ }).click();
await page.waitForTimeout(400);

const toastText = await page.evaluate(() => document.getElementById("toast")?.textContent || "");
toastText === "Draft saved" ? ok("Save draft shows the real 'Draft saved' toast") : bad("toast text: " + JSON.stringify(toastText));

const kvAfterSave = await page.evaluate(async () => await window.G.db.get("kv", "forms:saved"));
const savedRows = (kvAfterSave && kvAfterSave.value) || [];
savedRows.length === 1 ? ok("Save draft persists exactly one row to kv 'forms:saved'") : bad("forms:saved row count: " + savedRows.length);
const savedEntry = savedRows[0];
savedEntry && savedEntry.formId === "da31" && savedEntry.values?.name === MARKER_NAME && savedEntry.values?.type === "Emergency"
  ? ok("the persisted draft's formId and real field values match what was typed")
  : bad("persisted draft: " + JSON.stringify(savedEntry));
typeof savedEntry?.sid === "string" && savedEntry.sid.length > 0
  ? ok("the persisted draft carries a real sid for later deletion")
  : bad("persisted draft sid: " + JSON.stringify(savedEntry?.sid));

// ---- saved-drafts card appears in the catalog list ----
await page.locator("button", { hasText: /All forms/ }).click();
await page.waitForTimeout(400);

function draftsSection() {
  return page.locator(".section-title.sub", { hasText: /Saved practice drafts/ });
}
const draftsHeaderCount = await draftsSection().count();
draftsHeaderCount === 1 ? ok("'Saved practice drafts' section appears in the catalog list") : bad("drafts section header count: " + draftsHeaderCount);

const draftCardTitle = await page.evaluate(() => {
  const hdr = Array.from(document.querySelectorAll(".section-title.sub")).find((h) => /Saved practice drafts/.test(h.textContent || ""));
  return hdr?.nextElementSibling?.querySelector(".form-num")?.textContent || null;
});
draftCardTitle && draftCardTitle.startsWith("DA Form 31 — ")
  ? ok("the saved draft's card shows the real form number + save date (" + draftCardTitle + ")")
  : bad("draft card title: " + JSON.stringify(draftCardTitle));

// ---- the draft survives a REAL page reload, not just an in-memory render ----
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
// Guest/Kiosk profiles are deliberately kept in-memory only (never written
// to IndexedDB - see the app's own onboarding comments), so a real reload
// legitimately re-shows the onboarding overlay; re-pick guest to get back in.
await openGuestSession();
await page.evaluate(() => { location.hash = "#/forms"; });
await page.waitForTimeout(600);

const afterReload = await page.evaluate(() => {
  const hdr = Array.from(document.querySelectorAll(".section-title.sub")).find((h) => /Saved practice drafts/.test(h.textContent || ""));
  return {
    found: !!hdr,
    cardTitle: hdr?.nextElementSibling?.querySelector(".form-num")?.textContent || null,
  };
});
afterReload.found && afterReload.cardTitle === draftCardTitle
  ? ok("the saved draft is still listed after a real page reload (real IndexedDB persistence)")
  : bad("drafts section after reload: " + JSON.stringify(afterReload));

const kvAfterReload = await page.evaluate(async () => await window.G.db.get("kv", "forms:saved"));
const rowsAfterReload = (kvAfterReload && kvAfterReload.value) || [];
rowsAfterReload.length === 1 && rowsAfterReload[0].values?.name === MARKER_NAME
  ? ok("kv 'forms:saved' still holds the exact typed values after reload")
  : bad("forms:saved after reload: " + JSON.stringify(rowsAfterReload));

// ---- re-opening the draft round-trips its real values back into Fill ----
const draftsGrid = draftsSection().locator("xpath=following-sibling::div[1]");
await draftsGrid.locator("button", { hasText: /^Open$/ }).click();
await page.waitForTimeout(300);

const reopened = await page.evaluate(() => ({
  activeTab: document.querySelector(".segmented button.active")?.textContent,
  name: document.querySelector('.field[data-fid="name"] input.in')?.value,
  type: document.querySelector('.field[data-fid="type"] select.in')?.value,
}));
reopened.activeTab === "Fill" ? ok("'Open' on a saved draft jumps straight to its Fill tab") : bad("re-opened active tab: " + reopened.activeTab);
reopened.name === MARKER_NAME && reopened.type === "Emergency"
  ? ok("the reloaded draft's real values round-trip back into the Fill tab's inputs")
  : bad("re-opened field values: " + JSON.stringify(reopened));

// ---- Delete removes the draft ----
await page.locator("button", { hasText: /All forms/ }).click();
await page.waitForTimeout(400);
await draftsGrid.locator("button", { hasText: /^Delete$/ }).click();
await page.waitForTimeout(400);
const afterDelete = await page.evaluate(async () => {
  const kv = await window.G.db.get("kv", "forms:saved");
  return {
    rows: (kv && kv.value) || [],
    headerPresent: Array.from(document.querySelectorAll(".section-title.sub")).some((h) => /Saved practice drafts/.test(h.textContent || "")),
  };
});
afterDelete.rows.length === 0 ? ok("Delete removes the draft from kv 'forms:saved'") : bad("forms:saved rows after delete: " + JSON.stringify(afterDelete.rows));
afterDelete.headerPresent === false ? ok("'Saved practice drafts' section disappears once the last draft is deleted") : bad("drafts section still present after delete");

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `FORMS: ${fails} FAILURE(S)` : "FORMS: all passed"));
process.exit(fails ? 1 : 0);
