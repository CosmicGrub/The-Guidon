/**
 * Accessibility-tree audit: what a screen reader is actually handed.
 *
 * §37 flagged screen-reader usability as the project's hardest gap; §38 did the
 * keyboard and structure work and said plainly that it "cannot prove
 * screen-reader usability - it checks structure, which is necessary but not
 * sufficient". No screen reader is installed on this machine (NVDA and JAWS are
 * absent; Narrator exists but cannot be driven headlessly to capture speech),
 * so this does the next most rigorous thing available: it reads the computed
 * accessibility tree through CDP - the exact data AT consumes - rather than
 * checking rules against the DOM the way axe-core does.
 *
 * The specific class of defect this exists to catch, which axe-core cannot:
 * elements that are perfectly labelled in isolation but USELESS in a screen
 * reader's elements list. Five buttons all announcing "Open" pass every rule
 * and are unusable, because AT users navigate by pulling up a list of controls
 * stripped of their surrounding context.
 *
 * This is still not a substitute for testing with a real screen reader and a
 * real user. It narrows the gap; it does not close it.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0, warns = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const warn = (m) => { warns++; console.log("  WARN  " + m); };

/* Roles that a user can operate, and therefore must be able to identify.
   "Date" is here because Chromium exposes <input type="date"> under that role
   rather than as a textbox - omitting it meant the calendar's seven date fields
   were never name-checked at all, while the browser's own sub-parts were. */
const INTERACTIVE = new Set([
  "button", "link", "textbox", "checkbox", "combobox", "radio", "slider",
  "switch", "menuitem", "tab", "searchbox", "spinbutton", "listbox", "Date",
]);

/* Chromium builds these inside every <input type="date">. They are not authored
   by the app, cannot be renamed, and are identical in every date field on the
   page by construction - so counting them as duplicate control names says
   nothing about this app. The date inputs themselves ARE checked, above. */
const BROWSER_INTERNAL = /^(Show date picker|Month Month|Day Day|Year Year|Hour Hour|Minute Minute|AM\/PM AM\/PM)$/;

/* Names so generic they identify nothing once removed from their surroundings. */
const VAGUE = /^(open|open →|open ->|go|view|more|details|click here|read more|here|link|button|show|next|back|edit|remove|delete|close|submit|ok|yes|no)$/i;

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(900);
// Roadmap-week audit (3rd pass), following the #app-inert fix: a fresh
// profile-less context boots straight into onboarding, which now correctly
// marks #app inert while it's open (see util._pushModalInert's own
// comment) - so every section's landmarks/heading genuinely disappear from
// the accessibility tree behind it, exactly like a real screen-reader user
// would find, and every route below failed with "found 0" until this
// seeded a completed profile first. A real Soldier auditing these routes
// has already finished onboarding; this fixture now matches that.
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    displayName: "SGT AXTREE", lastName: "AXTREE", anonymous: false,
    studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
  } });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(900);
await cdp.send("Accessibility.enable");

const routes = await page.evaluate(() => window.G.routes.map((r) => r.hash));
console.log(`  auditing ${routes.length} sections through the computed AX tree\n`);

/** Flattens the CDP AX tree into the ignorable/interesting nodes we care about. */
async function axNodes() {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  return nodes
    .filter((n) => !n.ignored)
    .map((n) => ({
      role: n.role && n.role.value,
      name: ((n.name && n.name.value) || "").trim(),
      desc: ((n.description && n.description.value) || "").trim(),
      // CDP wraps every property in an AXValue: { type, value }. Reading .value
      // once yields that wrapper, not the number - which made every heading
      // level NaN and reported "0 level-1 headings" on 24 sections that were
      // in fact fine. Unwrap twice.
      level: (() => {
        const p = (n.properties || []).find((x) => x.name === "level");
        return p && p.value ? Number(p.value.value) : 0;
      })(),
      disabled: !!(n.properties || []).find((p) => p.name === "disabled" && p.value && p.value.value),
    }));
}

const unnamed = [];        // interactive, no accessible name at all
const vagueByRoute = [];   // interactive, name that identifies nothing
const dupByRoute = [];     // several controls sharing one name in a single view
let headingProblems = 0;
let landmarkProblems = 0;

for (const hash of routes) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(220);
  const nodes = await axNodes();

  // --- interactive elements must be identifiable ---
  const controls = nodes.filter((n) => INTERACTIVE.has(n.role));
  controls.forEach((c) => {
    if (!c.name && !c.desc) unnamed.push(`${hash} <${c.role}>`);
  });

  const vague = controls.filter((c) => c.name && VAGUE.test(c.name) && !c.desc);
  if (vague.length) {
    vagueByRoute.push({ hash, names: [...new Set(vague.map((v) => v.name))], count: vague.length });
  }

  // Duplicate names within one view: the elements-list problem.
  const byName = {};
  controls.forEach((c) => {
    if (!c.name || BROWSER_INTERNAL.test(c.name)) return;
    (byName[c.name] = byName[c.name] || []).push(c.role);
  });
  const dups = Object.entries(byName).filter(([n, list]) => list.length > 1 && n.length < 40);
  if (dups.length) dupByRoute.push({ hash, dups: dups.map(([n, l]) => `${l.length}x "${n}"`) });

  // --- the view must have a heading the router can focus ---
  //
  // This is the check that would have caught Forms. It rendered its title as
  // bare text in a <div class="section-title"> while every other view wrapped
  // it in an <h2>. The router focuses "h1, h2" inside #route after each render
  // to announce the new view; with no heading it found nothing, focus never
  // moved, and navigating to Forms announced NOTHING AT ALL in NVDA.
  //
  // The existing checks all passed: the topbar <h1> satisfied "exactly one
  // level-1 heading", and a MISSING h2 is not a level SKIP. Only walking the
  // flow with a real screen reader exposed it.
  const viewHasHeading = await page.evaluate(() => {
    const v = document.querySelector("#route");
    return !!(v && v.querySelector("h1, h2"));
  });
  if (!viewHasHeading) {
    headingProblems++;
    bad(`${hash}: view has no h1/h2 for the router to focus - navigating here announces nothing`);
  }

  // --- heading outline ---
  const headings = nodes.filter((n) => n.role === "heading").map((n) => Number(n.level) || 0);
  const h1s = headings.filter((l) => l === 1).length;
  if (h1s !== 1) { headingProblems++; bad(`${hash}: expected exactly one level-1 heading, found ${h1s}`); }
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) {
      headingProblems++;
      bad(`${hash}: heading level jumps ${headings[i - 1]} -> ${headings[i]}`);
      break;
    }
  }

  // --- landmarks ---
  const banner = nodes.filter((n) => n.role === "banner").length;
  const main = nodes.filter((n) => n.role === "main").length;
  const nav = nodes.filter((n) => n.role === "navigation").length;
  if (main !== 1) { landmarkProblems++; bad(`${hash}: expected one main landmark, found ${main}`); }
  if (banner !== 1) { landmarkProblems++; bad(`${hash}: expected one banner landmark, found ${banner}`); }
  if (nav < 1) { landmarkProblems++; bad(`${hash}: no navigation landmark`); }
}

if (!headingProblems) ok(`heading outline valid on all ${routes.length} sections (one h1, no level skips)`);
if (!landmarkProblems) ok(`landmarks correct on all ${routes.length} sections (banner / navigation / main)`);

unnamed.length === 0
  ? ok("every interactive element has a computed accessible name")
  : bad(`${unnamed.length} interactive elements with NO accessible name; first: ${unnamed.slice(0, 3).join(", ")}`);

/* Vague names are the headline finding this tool exists for. Reported as a
   failure rather than a warning: "Open" in an elements list is not usable. */
if (vagueByRoute.length === 0) {
  ok("no interactive element relies on a context-free name like \"Open\" or \"View\"");
} else {
  const total = vagueByRoute.reduce((n, v) => n + v.count, 0);
  bad(`${total} controls across ${vagueByRoute.length} sections announce a context-free name`);
  vagueByRoute.slice(0, 8).forEach((v) => console.log(`         ${v.hash}: ${v.count}x ${v.names.map((n) => `"${n}"`).join(", ")}`));
}

/* Duplicates are reported but not failed: repeated "Prev"/"Next" inside one
   widget is normal and legible in context. Surfaced so it stays visible. */
if (dupByRoute.length === 0) ok("no duplicate control names within a single view");
else {
  warn(`${dupByRoute.length} sections repeat a control name (often legitimate within one widget)`);
  dupByRoute.slice(0, 5).forEach((d) => console.log(`         ${d.hash}: ${d.dups.slice(0, 4).join(", ")}`));
}

/* Live regions: the app announces route changes and toasts. */
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
const live = await page.evaluate(() =>
  [...document.querySelectorAll("[aria-live]")].map((e) => ({
    politeness: e.getAttribute("aria-live"), role: e.getAttribute("role"), id: e.id || null,
    textLen: (e.textContent || "").length,
    childCount: e.children.length,
    // A live region that contains the view heading is, by definition, wrapping
    // the whole view rather than announcing a status.
    wrapsView: !!e.querySelector("h1, h2"),
  })));
live.length > 0
  ? ok(`${live.length} live region(s) present: ${live.map((l) => l.politeness + (l.id ? "#" + l.id : "")).join(", ")}`)
  : bad("no aria-live region - toasts and status changes would be silent");

/* A live region must announce a STATUS, never contain a view.
 *
 * This check exists because #route - the entire main view container - carried
 * aria-live="polite". Every navigation therefore pushed the whole rendered
 * section into a live region and NVDA read the complete page aloud; on the
 * doctrine corpus or the 3,629-term dictionary that is thousands of words of
 * unstoppable speech.
 *
 * Nothing caught it. It is valid markup, so axe-core passed. This very file
 * previously counted the region's EXISTENCE as a PASS. It surfaced only by
 * installing NVDA and reading what it actually said - which is the whole
 * argument for doing that at least once. Presence is not correctness. */
const oversized = live.filter((l) => l.wrapsView || l.textLen > 400 || l.childCount > 3);
oversized.length === 0
  ? ok("no live region wraps a view (they announce status, not content)")
  : bad(`${oversized.length} oversized live region(s) - a navigation would read the whole page aloud: ` +
        oversized.map((l) => `${l.politeness}#${l.id || "?"} (${l.textLen} chars, ${l.childCount} children` +
                             `${l.wrapsView ? ", contains a heading" : ""})`).join("; "));

await browser.close();
server.close();
console.log("\n" + (fails ? `A11Y TREE: ${fails} FAILURE(S), ${warns} warning(s)` : `A11Y TREE: all passed, ${warns} warning(s)`));
process.exit(fails ? 1 : 0);
