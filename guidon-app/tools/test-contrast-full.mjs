/**
 * Colour-contrast GATE, exhaustive edition: every screen x every theme, and
 * every tab of every screen, judged by a real axe-core colour-contrast pass
 * plus a resolver for what axe cannot decide. It FAILS (exit 1) on a single
 * piece of text a Soldier could not read.
 *
 * WHAT IT MEASURES IS TEXT CONTRAST ONLY: the colour of a piece of text
 * against what is behind it (4.5:1, or 3:1 for large text). That includes the
 * text in a form control (its value) and a placeholder. It does NOT measure
 * non-text contrast (WCAG 1.4.11): the focus ring, input borders, icons and
 * chart marks are outside it. See "Known limits" in the PR / design system.
 *
 * This is the exhaustive counterpart of tools/test-contrast.mjs (a handful of
 * hand-picked trouble spots) and tools/test-contrast-forms.mjs (every form and
 * tab in three themes). CI runs it as TWO suites in separate chunks:
 *   --suite=screens   every screen (default tab), the interaction states, the
 *                     guest pass, the first-run welcome screens
 *   --suite=tabs      every tab, segment and chip of every screen
 * (no flag runs both, one after the other: what you want locally).
 *
 * WHY THE FIRST VERSION OF THIS FILE COULD NOT FAIL (2026-11 audit). It
 * reported "Color-contrast violations: 0" over 1500 combinations while the
 * default theme had real misses. Four causes, each measured, each fixed here:
 *   1. It switched themes with `setAttribute("data-theme", t)` alone. The
 *      app's real switch is G.theme.applyTheme(id), which also toggles the
 *      html `light` class, so every `html.light ...` rule was OFF during the
 *      sweep. Now: applyTheme, and the sweep checks the attribute and the
 *      class agree with the theme registry on every single measurement.
 *   2. It ran as a GUEST. Surfaces that only draw for a Soldier with a
 *      profile (promotion points, "you are here", the readiness legend, the
 *      development pathway) were never on screen. Now the main pass boots a
 *      finished profile, and a second pass runs as a guest on the screens
 *      whose guest rendering differs (measured at run time, not assumed).
 *   3. axe cannot decide text over a gradient or a background image, files it
 *      under `incomplete` (messageKey bgGradient / bgImage), and the old
 *      sweep counted only `violations`: on many screens that was most of the
 *      text. Now every such node is resolved here (see RESOLVER below), and
 *      every OTHER kind of incomplete result is counted per pass and printed,
 *      so nothing is dropped silently.
 *   4. It ended in `process.exit(0)` whatever it found, and tried to write its
 *      report into the tracked repo tree. Now it exits 1 on any miss and the
 *      report goes to the OS temp folder (or $GUIDON_CONTRAST_REPORT).
 * And a fifth, found by the first review of that fix: it drew each screen only
 * in its DEFAULT TAB. Money, Health, Transition, Board, Counsel, Develop and
 * Write hide most of their surfaces behind tabs (Field Manual, the default
 * theme, had seven misses there), and chips filter long lists. See THE TAB
 * WALK.
 *
 * WHAT IT MEASURES
 *   - Themes: read live from G.theme.THEMES (not a copied list), so a theme
 *     added tomorrow is covered tomorrow. Switched with G.theme.applyTheme.
 *   - Screens: read live from G.routes. Each is drawn once, then every theme
 *     is applied and measured on that same drawing (the app bakes no theme
 *     colour into its markup - colours are CSS variables - so this equals a
 *     redraw per theme, at a fraction of the cost). Every closed <details> is
 *     opened first, because a Soldier opens them and axe cannot see inside.
 *   - The window is made as tall as the screen: axe judges only the text that
 *     is inside the viewport (measured: 15 nodes at 900px, 104 at 9000px), and
 *     Doctrine draws more entries the taller its window is (about 42,000px
 *     today; the cap is 120,000px). A screen that is still scrolling at the
 *     largest window is a FAILURE, not a quiet gap.
 *   - Interaction states that make real surfaces appear: Board Drill flipped
 *     (the answer face is `inert` until a card is flipped, and axe skips an
 *     inert subtree), a live Rapid Fire round, the promotion-points calculator
 *     filled in (goal not met / goal met), and the "backed up recently"
 *     state of the backup line (it is a different colour from the warning).
 *   - The first-run welcome screens (choose how to start; the Personal Account
 *     step) in a fresh session: the first thing every new install shows, and a
 *     modal, so the rest of the app is inert behind it.
 *   - A guest pass on the screens whose guest drawing differs from the profile
 *     drawing. That is decided at run time by comparing the screens' markup
 *     (tag, class and style of every element): in this build 2-3 of the 48
 *     differ, so the other 45 are not swept twice.
 *   - FORM CONTROLS: the text of an <input>, <textarea>, <select> or button
 *     input is its VALUE, which has no text node. It is read and resolved like
 *     any other text. PLACEHOLDERS are drawn by the browser in ::placeholder,
 *     which axe never looks at: the pseudo-element's computed colour (at its
 *     own opacity) is judged against what the field sits on, on every
 *     measurement, in every theme.
 *
 * THE TAB WALK (--suite=tabs)
 *   For every screen (Settings excepted, see NO_TAB_WALK) it presses every
 *   tab, segmented-control button, chip, aria-pressed / aria-selected button
 *   and master-detail row it finds in the running DOM (TAB_SEL names the
 *   conventions the app uses, not screens or labels), one and two levels deep:
 *   a tab, and the tabs inside what that tab shows. Each state is reached from
 *   a fresh drawing of the screen by replaying the presses. A control that
 *   deletes, resets, signs out, sends, downloads, shares or imports is never
 *   pressed (TAB_RISKY); one that leaves the screen is noted and skipped; one
 *   that changes a setting on <html> / <body> fails the run (a preference is
 *   not a tab).
 *   Long groups (the 26 dictionary letters, the 40 topic chips, 150 doctrine
 *   entries) cannot all be measured in 30 themes within a CI chunk, and need
 *   not be: every element is reduced to its KIND (tag, class, inline style
 *   without its lengths, the state attributes CSS keys on, chained to the kinds
 *   of all its ancestors), and two elements of one kind have the same computed
 *   colours and the same backdrop in every theme. So a tab state is judged on
 *   the elements whose kind this screen has not shown yet (axe is told to look
 *   at just those, plus the canaries), a state with no new kind is only walked,
 *   and a group is left after TAB_PATIENCE presses in a row that showed
 *   nothing new. Position (first, last, odd, even) is left out of a kind on
 *   purpose: the stylesheet's :first-child / :last-child / :nth-child rules
 *   only ever move borders, margins and animation delays. Checked: the same
 *   seven misses in the default theme from a crawl that measured every state
 *   in full as from this walk (GUIDON_CONTRAST_TABS_ALL=1 measures every state
 *   in full, for checking the shortcut again).
 *   Floors: the number of tab states reached overall and PER SCREEN, the texts
 *   evaluated, and the placeholders seen must not fall below about half of what
 *   a run reached, so a walk that stops finding its controls fails.
 *
 * RESOLVER (for what axe files as incomplete: bgGradient / bgImage / fgAlpha /
 *   equalRatio / overlap kinds)
 *   Walks up from the text to the nearest opaque colour and composites every
 *   layer in between, each layer over every candidate beneath it (so a stack of
 *   translucent layers is exact). A layer that does not paint the whole box of
 *   the element (a smaller background-size that is not repeated, a position
 *   slid by a length, `space` repeat gaps, background-clip: text) leaves the
 *   colour BENEATH it showing, so those candidates are kept as well; only a
 *   layer that covers the whole box hides what is under it. (The first
 *   revision dropped them: white text on white with an opaque black gradient
 *   over a 4px bar of its box passed. Anything the resolver cannot read for
 *   certain counts as "does not cover" - the safe side.)
 *   A gradient is sampled DENSELY along every segment between two stops (32
 *   steps, premultiplied alpha, as CSS interpolates): checking only the stops
 *   passed 30px #777 over black-to-white, which is 4.7:1 and 4.5:1 at the ends
 *   and 1:1 in the middle. Radial, conic and repeating gradients paint the same
 *   colour set and are sampled the same way; a hard stop (two stops at one
 *   position) is not interpolated; a colour hint adds no colour. The verdict is
 *   the worst candidate. The text colour is composited at its own alpha times
 *   its ancestors' opacity. Large text (24px, or 18.66px bold) needs 3:1, the
 *   rest 4.5:1. Text the same colour as its backdrop (axe's equalRatio, which
 *   it files as incomplete) is 1:1, a miss: intent is never inferred from a
 *   ratio of 1, only the ALLOWLIST can excuse it.
 *   A background IMAGE (the paper-noise texture) cannot be sampled from the
 *   DOM; it is judged against the solid colour under it, which is what the
 *   forms gate does too. That is an approximation and is stated as one.
 *   Kinds this sweep does NOT measure are listed in KIND_POLICY, each with
 *   the reason; every kind except three that cannot hide a failure (an icon
 *   glyph, an emoji, the text of an <svg> chart) has a cap of ZERO.
 *
 * NON-VACUITY (so a harness regression fails loudly instead of going green)
 *   - CANARIES are injected into the page for EVERY measurement: a row at the
 *     top and a row at the very bottom of the screen (so a window that is too
 *     short is caught), covering the paths axe decides, the gradient path, the
 *     image path, the large-text rule both ways, an equal-colour label, 30px
 *     #777 over black-to-white (linear, radial, conic, repeating, transparent
 *     over a base colour, and under a see-through layer), six opaque gradients
 *     that cover only PART of their box (all must be caught), typed values in
 *     inputs / a button / a textarea (equal-colour, over a gradient), four
 *     placeholders (pale, over a gradient, washed out by opacity), a closed
 *     <details> holding low-contrast text, plus honest controls that must NOT
 *     be flagged (text just outside a gradient's luminance range, a hard
 *     black/white edge, an opaque upper layer hiding a pale one, an opaque
 *     gradient or tiled gradient that really covers the whole box, a readable
 *     value and a readable placeholder). Every expected canary must be
 *     reported, and every control must stay clean, on every single measurement.
 *   - FLOORS: each pass must have evaluated at least FLOORS.<pass> pieces of
 *     text in total, every theme at least FLOORS.profilePerTheme, and EVERY
 *     SINGLE screen and state its own floor in ROUTE_FLOORS (about half of its
 *     thinnest theme's count), so one screen cannot collapse unseen.
 *   - The two sessions must be what they claim (G.profile.isGuest() false for
 *     the main pass, true for the guest pass), and the surfaces the audit named
 *     (promotion points, "you are here", readiness legend, development summaries,
 *     backup line) must really be on screen in the main pass.
 *
 * tools/test-contrast-full-gate.mjs runs THIS file as a child process against a
 * scratch copy of the app with defects planted (and against copies of this
 * file with one behaviour cut out) and expects exit 1 (and exit 0 on the real
 * app), so turning the exit code back into a constant, or any one path off,
 * fails there.
 *
 * ALLOWLIST (below) is for a miss that genuinely cannot be fixed. Adding to it
 * NEEDS THE OWNER'S SIGN-OFF - do not add an entry to make this go green. Each
 * entry names a theme, a SCREEN and a selector and carries a written reason; an
 * entry that no longer matches anything fails the run, so the list cannot rot.
 * It is EMPTY and the aim is to keep it that way.
 *
 * ENV (for working on this file; none of them is set in CI, and CI refuses them)
 *   GUIDON_WEB_DIR            built folder to serve (default "web"); lets a planted
 *                             violation be proven against a scratch copy
 *   GUIDON_CONTRAST_REPORT    where the full JSON report goes (default: OS temp dir)
 *   GUIDON_CONTRAST_THEMES    comma list of theme ids  -> PARTIAL run
 *   GUIDON_CONTRAST_ROUTES    comma list of hashes     -> PARTIAL run
 *   GUIDON_CONTRAST_STATES    comma list of substrings of a state's label, or "none" -> PARTIAL run
 *   GUIDON_CONTRAST_TABS_ALL  "1": measure every tab state in full  -> PARTIAL run
 *   A PARTIAL run still exits 1 on any miss, but skips the whole-pass coverage
 *   floors and says so; it can never stand in for the full gate. (The per-screen
 *   tab floors still apply to the screens it walks.)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootApp, waitForRoute, until, check, ok, bad, finish, PERSONAL_PROFILE } from "./testkit.mjs";

/* ---------------------------------------------------------------------
   Allowlist - OWNER'S SIGN-OFF REQUIRED to add anything. Empty on purpose.
   { theme: "night-vision", route: "#/settings", selector: ".some-class", reason: "why this cannot be fixed" }
   An entry excuses ONE selector on ONE screen in ONE theme, so a generic selector
   such as `span` can never excuse everything: `route` is required and must be a
   real screen (or "welcome").
   --------------------------------------------------------------------- */
const ALLOWLIST = [];

/* ---------------------------------------------------------------------
   Floors, from measured runs on 2026-11-07 (30 themes, 48 screens). Each is
   roughly half of what the app gave then, so ordinary content growth or a
   tidy-up never trips one, while a blinded sweep (a 900px window, a handful of
   the 48 screens, violations only, tabs not found) lands far below them.
   "measured" is the whole-pass total across every theme.
   --------------------------------------------------------------------- */
const FLOORS = {
  themes: 30,              // the registry holds 30; fewer means the list was cut
  routes: 40,              // G.routes holds 48
  profileTotal: 104000,    // measured 208037 over 48 screens x 30 themes
  profilePerTheme: 3400,   // measured 6929..6936 for each single theme
  stateTotal: 10000,       // measured 20040 over 6 states x 30 themes
  guestTotal: 3000,        // measured 6990 (2 screens) to 11610 (3 screens) x 30 themes: #/progress, #/selftest, and #/board when its random card differs
  welcomeTotal: 690,       // measured 1380 over 2 first-run screens x 30 themes
  guestOtherScreen: 40,    // a screen that differs for a guest in some future build and has no row below yet
  placeholdersProfile: 190, // measured 390 placeholders (13 per theme)
  tabStatesTotal: 147,     // measured 295 tab states reached on 19 screens
  tabsMeasured: 33,        // measured 66 tab states with a kind of element the screen had not shown
  tabsTotal: 18500,        // measured 37458 texts over 66 states x 30 themes
  tabsPerTheme: 620,       // measured 1243..1249 for each single theme
  tabStateMin: 1,          // a tab state is judged on the elements new to it (a handful), so only "at least one" can be asked of each
  placeholdersTabs: 930,   // measured 1860 placeholders
};

/* Texts evaluated on each single screen / state in its THINNEST theme: the floor is about half of
   what a run measured, per screen (the old single floor of 15 for all of them was far below the
   real 40 to 1,274, so one screen could collapse unseen). */
const ROUTE_FLOORS = {
  profile: { "#/home": 29, "#/train": 201, "#/learn": 54, "#/forms": 73, "#/counsel": 26, "#/develop": 41, "#/blc": 39, "#/alc": 36, "#/slc": 34, "#/mlc": 35, "#/drills": 54, "#/channels": 72, "#/career": 49, "#/write": 72, "#/money": 79, "#/health": 36, "#/fitness": 84, "#/records": 51, "#/calendar": 41, "#/assignments": 44, "#/leader": 30, "#/currency": 83, "#/transition": 86, "#/resources": 193, "#/doctrine": 637, "#/creeds": 43, "#/prt": 40, "#/recite": 31, "#/dictionary": 162, "#/library": 57, "#/moi": 26, "#/cyber-opsec": 44, "#/board": 77, "#/group": 28, "#/risk": 65, "#/progress": 65, "#/author": 30, "#/share": 56, "#/selftest": 45, "#/storage": 38, "#/settings": 69, "#/search": 35, "#/profile": 58, "#/kiosk": 74, "#/privacy": 58, "#/board-sim": 40, "#/team": 66, "#/pt-plan": 66 },
  state: { "#/board (card flipped, .qz-back visible)": 82, "#/board (Rapid Fire live round)": 4, "#/profile (promotion points filled, goal not met)": 59, "#/profile (promotion points filled, goal met)": 59, "#/settings (backed up today)": 69, "#/profile (backed up today)": 59 },
  guest: { "#/board": 77, "#/progress": 72, "#/selftest": 44 },
  welcome: { "welcome screen (choose how to start)": 8, "welcome screen (Personal Account step)": 14 },
};

/* Tab states reached per screen by the tab walk, about half of what a run reached. */
const TAB_FLOORS = { "#/train": 1, "#/learn": 3, "#/counsel": 5, "#/develop": 2, "#/write": 1, "#/money": 12, "#/health": 3, "#/transition": 3, "#/resources": 6, "#/doctrine": 14, "#/creeds": 5, "#/prt": 3, "#/recite": 5, "#/dictionary": 29, "#/cyber-opsec": 3, "#/board": 39, "#/search": 5, "#/team": 1, "#/pt-plan": 1 };

/* Screens the tab walk does not walk, each with the reason. */
const NO_TAB_WALK = {
  "#/settings": "its buttons are app-wide preferences (text size, density, motion): pressing one changes every later measurement, and the screen shows all of its sections without any tab",
};
const TAB_DEPTH = 2;              // a tab, and the tabs inside what that tab shows
/* A group of sibling controls (the 26 dictionary letters, the 40 topic chips) is pressed one after another until this many presses
   IN A ROW show no kind of element the screen has not already shown; then the rest of that group is left (they draw the same
   components with other data). A group this size or smaller is always pressed in full. GUIDON_CONTRAST_TABS_ALL=1 turns this off. */
const TAB_PATIENCE = 6;
const TAB_CAP_PER_ROUTE = 150;    // states reached per screen; hitting it fails the run rather than quietly stopping

/* Kinds of axe `incomplete` result, and what this sweep does with each. A kind
   marked "resolved" is judged by this sweep; every other kind is only COUNTED,
   and (see KIND_CAP) must stay at zero except the three that cannot hide a failure. */
const RESOLVABLE = ["bgImage", "bgGradient", "fgAlpha", "equalRatio", "bgOverlap", "elmPartiallyObscured", "elmPartiallyObscuring"];
const KIND_POLICY = {
  bgImage: "resolved",
  bgGradient: "resolved (every point of every gradient: dense samples between the stops; a layer that leaves part of the box bare keeps the colour beneath it as well)",
  fgAlpha: "resolved",
  shortTextContent: "axe skips text of fewer than 2 characters by design (icon glyphs, bullets, close marks)",
  nonBmp: "axe skips astral-plane characters by design (emoji), which draw in their own colours",
  imgNode: "text inside an <svg> chart (axis labels, bar values) or over an <img>: the shapes and pixels behind it are not CSS backgrounds, so they cannot be measured here",
  bgOverlap: "resolved, best effort: axe could not hit-test the text (the Board Drill and Rapid Fire cards are 3D-transformed), so the backdrop is read from the text's own ancestors",
  elmPartiallyObscured: "resolved, best effort: same - judged against the text's own ancestors' backdrop",
  elmPartiallyObscuring: "resolved, best effort: same - judged against the text's own ancestors' backdrop",
  pseudoContent: "axe could not decide the backdrop because a ::before / ::after layer is drawn behind or over the text, so a colour may sit under the text that no element's own background shows. NOT measured here, so any occurrence fails the run (cap 0)",
  nonBgContent: "the text sits on a replaced element (canvas, video), not on a colour. NOT measured here (cap 0)",
  equalRatio: "resolved: text the same colour as its backdrop is ratio 1:1, a MISS. It is never read as deliberately hidden; genuinely intentional hidden text goes through the ALLOWLIST (theme + screen + selector + reason)",
  outsideViewport: "NOT acceptable: the window did not cover this node (treated as a coverage failure)",
  noText: "a node axe flagged that shows no text this sweep can read (a form control is read through its value; this is a bare box). NOT measured (cap 0)",
  placeholderUnparsed: "a placeholder over a background this sweep could not parse. NOT measured (cap 0)",
  unknown: "an incomplete result with no reason attached. NOT measured (cap 0)",
};
/* How many nodes of each unmeasured kind a pass may contain. Zero unless listed: the three below
   cannot hide a failure (an icon glyph of one character, an emoji that draws in its own colours,
   the text of an <svg> chart). Anything else - an unparsed gradient, a pseudo-element layer, a
   control with no readable text - is a hole in the sweep and fails the run, naming where. */
const KIND_CAP = { shortTextContent: Infinity, nonBmp: Infinity, imgNode: Infinity };
/* On top of the per-kind caps: the share of everything seen in a pass that was not measurable. Measured 0.9%
   (profile), 1.8% (states) and 4.5% (guest); about double the worst. */
const MAX_UNMEASURED_SHARE = 0.10;

const BASE_W = 1280;
const BASE_H = 900;
const MAX_H = 120000;         // tallest window we will ask Chromium for (Doctrine needs about 41,500px today; a screen still scrolling here is a failure)
const CANARY_ROOM = 1700;     // px of window reserved for the injected canary rows (about 1,100px of them at the top, plus the bottom row and the closed-details one)
const WATCHDOG_MS = (+process.env.GUIDON_CONTRAST_WATCHDOG_MIN || 45) * 60 * 1000;

/* SUITES: the gate is two suites that CI runs in separate chunks (the tab walk roughly doubles the time).
   `--suite=screens`  every screen, the interaction states, the guest pass and the first-run screens
   `--suite=tabs`     every tab, segment and chip of every screen
   no flag            both, one after the other (what you want locally)
   `--list-suites` prints the names and exits, so tools/test-contrast-full-gate.mjs can check that package.json runs them all. */
const SUITE_NAMES = ["screens", "tabs"];
if (process.argv.includes("--list-suites")) { console.log(JSON.stringify(SUITE_NAMES)); process.exit(0); }
const suiteArg = (process.argv.find((a) => a.startsWith("--suite=")) || "").slice(8);
const SUITE = suiteArg || "all";
if (SUITE !== "all" && SUITE_NAMES.indexOf(SUITE) === -1) {
  console.log(`  FAIL  unknown suite "${SUITE}" (one of ${SUITE_NAMES.join(", ")}, or no --suite flag for both)`);
  console.log("\n1 FAILURE(S)");
  process.exit(1);
}
const RUN_SCREENS = SUITE === "all" || SUITE === "screens";
const RUN_TABS = SUITE === "all" || SUITE === "tabs";
const csv = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
const ONLY_THEMES = csv(process.env.GUIDON_CONTRAST_THEMES);
const ONLY_ROUTES = csv(process.env.GUIDON_CONTRAST_ROUTES);
const ONLY_STATES = csv(process.env.GUIDON_CONTRAST_STATES);   // substrings of a state's label, or "none"
const TAB_ALL = process.env.GUIDON_CONTRAST_TABS_ALL === "1";  // measure EVERY tab state, not only those that show a new kind of element (for checking the shortcut)
const PARTIAL = !!(ONLY_THEMES || ONLY_ROUTES || ONLY_STATES || TAB_ALL);
const TAB_CAP = TAB_ALL ? 700 : TAB_CAP_PER_ROUTE;        // measuring every state in full has no patience to stop it, so it gets a larger cap
const REPORT_PATH = process.env.GUIDON_CONTRAST_REPORT || path.join(os.tmpdir(), "guidon-contrast-full-report.json");
const WEB_DIR = process.env.GUIDON_WEB_DIR || "web";

if (PARTIAL && process.env.CI) {
  console.log("  FAIL  GUIDON_CONTRAST_THEMES / ROUTES / STATES / TABS_ALL narrow or change the sweep and are not allowed in CI");
  console.log("\n1 FAILURE(S)");
  process.exit(1);
}

const axeSrc = fs.readFileSync(new URL(import.meta.resolve("axe-core/axe.min.js")), "utf8");

/* =====================================================================
   IN THE PAGE
   ===================================================================== */

/* Resolves once the DOM has stopped changing for `quiet` ms (views load their
   data asynchronously and draw when it lands), or after `max` ms. Returns why. */
const SETTLE = ({ quiet, max }) => new Promise((resolve) => {
  let timer = null;
  const t0 = performance.now();
  const done = (why) => { obs.disconnect(); clearTimeout(timer); resolve(why); };
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => done("quiet"), quiet); };
  const obs = new MutationObserver(() => { if (performance.now() - t0 > max) done("deadline"); else arm(); });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  arm();
});

/* Opens every closed <details> in the screen, returns how many, and a
   structural signature of the screen (tag | class | style of every element),
   which is what decides whether the guest and profile drawings differ.
   With `canary` it first plants a CLOSED <details> holding low-contrast text,
   so that a sweep which stops opening them is caught on the spot (axe cannot
   see inside a closed <details>, so the canary is only reported if this
   function really opened it). The canary is left out of the signature. */
const PREPARE = ({ canary }) => {
  const route = document.getElementById("route");
  if (route && canary) {
    const d = document.createElement("details");
    d.setAttribute("data-cg-canary", "details");
    d.innerHTML = "<summary id=\"cg-canary-details-summary\" style=\"color:#000;background:#fff;padding:2px 6px;font:14px/1.35 sans-serif\">Canary: a closed details</summary>" +
      "<p id=\"cg-canary-details-text\" style=\"margin:0;padding:2px 6px;font:14px/1.35 sans-serif;color:#8f8f8f;background:#9a9a9a\">Canary: low-contrast text inside a details element that the sweep must open</p>";
    route.appendChild(d);
  }
  let opened = 0;
  if (route) route.querySelectorAll("details:not([open])").forEach((d) => { d.open = true; if (!d.hasAttribute("data-cg-canary")) opened++; });
  const sig = new Set();
  if (route) route.querySelectorAll("*").forEach((e) => { if (!e.closest("[data-cg-canary]")) sig.add(e.tagName + "|" + (e.getAttribute("class") || "") + "|" + (e.getAttribute("style") || "")); });
  return { opened, sig: [...sig].sort().join("\n") };
};

/* How tall must the window be so that nothing in the screen scrolls? While
   the scroller overflows, its scrollHeight is the content; once it does not,
   scrollHeight just echoes the window, so the bottom of #route is used. */
const FIT = () => {
  const route = document.getElementById("route");
  let scroller = null;
  for (let n = route && route.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") { scroller = n; break; }
  }
  if (!scroller) return { need: document.documentElement.scrollHeight, ih: innerHeight, scrolling: false };
  const chrome = innerHeight - scroller.clientHeight;
  const scrolling = scroller.scrollHeight > scroller.clientHeight + 1;
  const sr = scroller.getBoundingClientRect(), rr = route.getBoundingClientRect();
  const routeBottom = rr.bottom - sr.top + scroller.scrollTop + parseFloat(getComputedStyle(scroller).paddingBottom || "0");
  return { need: (scrolling ? scroller.scrollHeight : routeBottom) + chrome, ih: innerHeight, scrolling };
};

/* =====================================================================
   THE TAB WALK (in the page): finding and pressing the controls that switch
   what a screen shows. A screen is drawn in its default tab; every other tab,
   segment, chip and master-detail row is a different surface that a Soldier
   opens, and the default-tab sweep never sees it.
   ===================================================================== */

/* The controls. This is a list of CONVENTIONS the app uses for "switch the view" (tab, segmented control, chip, aria-pressed /
   aria-selected button, master-detail row), not a list of screens or labels: which controls exist on a screen is read from the
   running DOM, so a tab added tomorrow is walked tomorrow. A pin button is not a view switch. */
const TAB_SEL = "[role=\"tab\"], .tabbar .tab, .segmented button, button[aria-pressed], button[aria-selected], .chip, .list-detail-row";
/* A control that deletes, resets, signs out, sends, downloads or otherwise does more than switch a view is never pressed. */
const TAB_RISKY = "delete|remove|reset|clear|erase|wipe|sign.?out|log.?out|download|export|import|upload|share|print|back.?up|restore|send|submit|publish|buy|purchase|install|quit|discard|forget|revoke|archive";

/* Lists the visible, enabled controls in the screen and, with `press`, presses the one named by { i, key } (its position in the
   list, confirmed by its key; if the order moved, the first with that key). `key` is tag + class (without the selected-state class)
   + label, so "the Budget tab" is the same control in every drawing. */
const TAB_ACT = ({ sel, risky, press }) => {
  const root = document.getElementById("route");
  const bad = new RegExp(risky, "i");
  const list = [], els = [];
  if (root) root.querySelectorAll(sel).forEach((b) => {
    if (b.matches(".nav-pin-btn") || b.closest("[inert], [hidden]") || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(b).visibility === "hidden") return;
    const label = (b.getAttribute("aria-label") || b.textContent || b.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const cls = (b.getAttribute("class") || "").split(/\s+/).filter((c) => c && !/^(?:active|on|selected|current)$/.test(c)).join(".");
    const selected = b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-pressed") === "true" || /(?:^|\s)(?:active|on|selected|current)(?:\s|$)/.test(b.getAttribute("class") || "");
    /* the group: controls of one kind in containers of one kind (every entry's toggle in a long list is one group, not one group each) */
    const group = b.tagName + "." + cls + "<" + (b.parentElement ? b.parentElement.tagName + "." + (b.parentElement.getAttribute("class") || "") : "");
    list.push({ i: list.length, label, group, key: b.tagName + "." + cls + "|" + label, selected, risky: bad.test(label) || b.tagName === "A" || b.type === "submit" });
    els.push(b);
  });
  let pressed = false;
  if (press) {
    const hit = list.find((x) => x.i === press.i && x.key === press.key) || list.find((x) => x.key === press.key);
    if (hit) { els[hit.i].click(); pressed = true; }
  }
  return { list, pressed, hash: location.hash };
};

/* Settings that live on <html> / <body> (text size, density, motion, contrast mode): pressing a tab must never change one, or
   every later measurement would be taken in a different app. The theme (data-theme, the `light` class) is the sweep's own. */
const APP_FLAGS = () => {
  const h = document.documentElement;
  return [...h.attributes].filter((a) => !/^(?:data-theme|class|style)$/.test(a.name)).map((a) => a.name + "=" + a.value).sort().join(" ") + " | " +
    [...h.classList].filter((c) => c !== "light").sort().join(" ") + " | " + (document.body.getAttribute("class") || "") + " | " + getComputedStyle(h).fontSize;
};

/* Which KINDS of text-bearing element are on screen? Each element is reduced to its own kind (tag, class, inline style, the state
   attributes that CSS keys on, the names of its data-* attributes) chained to the kinds of all its ancestors; two elements of
   one kind have the same computed colours and the same backdrop in every theme. (Position - first, last, odd, even - is left
   out on purpose: the stylesheet's :first-child / :last-child / :nth-child rules only ever move borders, margins and animation
   delays, never a text or background colour. Lengths in an inline style - a bar's width - are left out too; its colours stay.) Returns how many
   kinds there are and how many are NEW to the set kept for this screen (`reset` starts a new set; `commit` adds the new ones).
   A tab state with no new kind is the same surface again, so it is walked but not measured twice. */
const STRUCT = ({ reset, commit }) => {
  const seen = reset || !window.__cgSeen ? (window.__cgSeen = new Set()) : window.__cgSeen;
  const H = (str) => {
    let a = 0xdeadbeef ^ str.length, b = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (b >>> 0).toString(36) + (a >>> 0).toString(36);
  };
  const STATE = ["aria-pressed", "aria-selected", "aria-expanded", "aria-checked", "aria-current", "aria-disabled", "data-state", "data-tone", "data-kind", "data-status", "data-variant", "data-level", "role", "type", "open", "disabled", "checked", "hidden"];
  const cur = new Set();
  const novel = [], perKind = new Map();   // up to 6 elements of each kind that is new: the ones a tab state still has to have measured
  const walk = (e, chain) => {
    if (e.hasAttribute("data-cg-canary") || e.tagName === "svg") return;
    const own = e.tagName + "." + (e.getAttribute("class") || "") + "|" + (e.getAttribute("style") || "").replace(/(?<![#\w-])-?\d*\.?\d+(?:px|%|em|rem|s|ms|deg|vh|vw|ch)\b/g, "#") + "|" + STATE.map((k) => (e.hasAttribute(k) ? k + "=" + e.getAttribute(k) : "")).join(",") + "|" +
      [...e.attributes].filter((a) => /^data-/.test(a.name)).map((a) => a.name).sort().join(",");
    const here = H(chain + ">" + own);
    const texty = /^(?:INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || [...e.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
    if (texty) {
      cur.add(here);
      if (!seen.has(here)) { const n = perKind.get(here) || 0; if (n < 6) { novel.push(e); perKind.set(here, n + 1); } }
    }
    const kids = e.children;
    for (let k = 0; k < kids.length; k++) walk(kids[k], here);
  };
  const root = document.getElementById("route");
  if (root) walk(root, "");
  let fresh = 0;
  cur.forEach((h) => { if (!seen.has(h)) fresh++; });
  if (commit) { cur.forEach((h) => seen.add(h)); window.__cgNovel = novel; }
  return { total: cur.size, fresh, novel: novel.length };
};

/* Applies the theme through the app's own path, injects the canaries, runs
   axe, resolves what axe could not decide, measures the placeholders (which
   axe never looks at), removes the canaries.
   Returns { applied, evaluated, placeholders, misses, kinds, unmeasured, canary }. */
const MEASURE = async ({ id, withCanary, RESOLVABLE, host, only }) => {
  window.G.theme.applyTheme(id);

  /* ---- canaries: colours are fixed, so they must be caught in EVERY theme ---- */
  const SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6'%3E%3Crect width='6' height='6' fill='%23d8d8d8' fill-opacity='.55'/%3E%3C/svg%3E\")";
  const GRAD_PALE = "background-image:linear-gradient(90deg,#fff,#fdfdfd)";
  const BW = "background-image:linear-gradient(90deg,#000,#fff)";
  const rows = (where, full) => {
    const p = (name, style, text) => `<p id="cg-canary-${where}-${name}" style="margin:0;padding:2px 6px;font:14px/1.35 sans-serif;${style}">${text}</p>`;
    let h = p("solid", "color:#8f8f8f;background:#9a9a9a", "Canary: low-contrast text on a solid colour (axe decides this one)") +
            p("gradient", "color:#dcdcdc;background-image:linear-gradient(90deg,#e6e6e6,#f0f0f0)", "Canary: low-contrast text over a gradient (axe cannot decide; the sweep resolves it)");
    if (full) {
      h += p("image", "color:#cfcfcf;background-color:#d8d8d8;background-image:" + SVG, "Canary: low-contrast text over a background image") +
           p("small-bad", "color:#7a7a7a;" + GRAD_PALE, "Canary: 4.3:1 small text over a gradient (needs 4.5, must be caught)") +
           p("large-bad", "font-size:30px;line-height:1.2;color:#a8a8a8;" + GRAD_PALE, "Canary: 2.4:1 large text (needs 3, must be caught)") +
           p("large-ok", "font-size:30px;line-height:1.2;color:#7a7a7a;" + GRAD_PALE, "Canary: 4.3:1 large text (needs only 3, must pass)") +
           p("honest", "color:var(--text);background:var(--panel-2)", "Canary: the theme's own text colour on its own panel (must pass)") +
           p("honest-gradient", "color:var(--text);background-image:linear-gradient(90deg,var(--panel),var(--panel-2))", "Canary: the theme's own text colour over a panel gradient (must pass)") +
           /* text the same colour as its background: axe files it as 'incomplete / equalRatio'; it is 1:1, a miss */
           p("equal", "color:#8a8a8a;background:#8a8a8a", "Canary: text the same colour as its background (an invisible label)") +
           /* #777 is 4.7:1 on black and 4.5:1 on white, so both ends of a black-to-white gradient clear the 3:1 large-text bar,
              yet it is 1:1 where the gradient passes through #777. Only sampling BETWEEN the stops sees it. */
           p("gradient-mid", "font-size:30px;line-height:1.1;color:#777;" + BW, "Canary: 30px #777 over black-to-white (fine at both ends, unreadable in the middle)") +
           p("radial-mid", "font-size:30px;line-height:1.1;color:#777;background-image:radial-gradient(circle,#000,#fff)", "Canary: the same over a radial gradient") +
           p("conic-mid", "font-size:30px;line-height:1.1;color:#777;background-image:conic-gradient(#000,#fff)", "Canary: the same over a conic gradient") +
           p("repeating-mid", "font-size:30px;line-height:1.1;color:#777;background-image:repeating-linear-gradient(90deg,#000 0,#fff 40px)", "Canary: the same over a repeating gradient") +
           p("alpha-mid", "font-size:30px;line-height:1.1;color:#777;background-color:#000;background-image:linear-gradient(90deg,transparent,#fff)", "Canary: the same over a transparent-to-white gradient on a black base") +
           p("layers-mid", "font-size:30px;line-height:1.1;color:#777;background-image:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0)),linear-gradient(90deg,#000,#fff)", "Canary: the same under a see-through top layer") +
           /* the clean counterparts: the sweep must not cry wolf */
           p("gradient-outside", "font-size:30px;line-height:1.1;color:#999;background-image:linear-gradient(90deg,#000,#444)", "Canary: 30px #999 just outside the gradient's luminance range (3.4:1 at worst, must pass)") +
           p("hard-ok", "font-size:30px;line-height:1.1;color:#777;background-image:linear-gradient(90deg,#000 0 50%,#fff 50% 100%)", "Canary: a hard black/white edge paints no grey, so #777 clears both halves (must pass)") +
           p("layers-ok", "font-size:30px;line-height:1.1;color:#999;background-image:linear-gradient(90deg,#000,#444),linear-gradient(90deg,#000,#fff)", "Canary: an opaque top layer hides the white one beneath it (must pass)") +
           /* PARTIAL COVERAGE. White text on a white base. An opaque black gradient that paints only PART of the box leaves the text
              1:1 white-on-white where it is absent, so the white beneath must stay a candidate. (The first revision of the resolver
              dropped it: an opaque layer replaced everything below it, whatever its size, repeat or position.) */
           p("partial-half", "color:#fff;background:#fff linear-gradient(#000,#000) no-repeat 0 0/50% 100%", "Canary: white on white, an opaque gradient over the left half only") +
           p("partial-bar", "color:#fff;background:#fff linear-gradient(#000,#000) no-repeat 0 100%/100% 4px", "Canary: white on white, an opaque gradient as a 4px bar at the bottom") +
           p("partial-tile", "color:#fff;background:#fff linear-gradient(#000,#000) no-repeat 0 0/20px 20px", "Canary: white on white, one 20px opaque gradient tile") +
           p("partial-shift", "color:#fff;background:#fff linear-gradient(#000,#000) no-repeat 60px 0/100% 100%", "Canary: white on white, a full-size opaque gradient slid 60px to the right") +
           p("partial-xbar", "color:#fff;background:#fff linear-gradient(#000,#000) repeat-x 0 0/20px 4px", "Canary: white on white, a 4px opaque gradient strip repeated across only") +
           p("partial-space", "color:#fff;background:#fff linear-gradient(#000,#000) space 0 0/30px 30px", "Canary: white on white, opaque gradient tiles spaced apart") +
           p("full-ok", "color:#fff;background:#fff linear-gradient(#000,#000)", "Canary: white on an opaque gradient that covers the whole box (must pass)") +
           p("tile-ok", "color:#fff;background:#fff linear-gradient(#000,#000) 0 0/20px 20px", "Canary: white on opaque gradient tiles that repeat to fill the whole box (must pass)");
      /* FORM CONTROLS: the text is the control's VALUE (it has no text node), and placeholders are drawn by the browser */
      const field = "display:block;box-sizing:border-box;width:100%;margin:0;border:0;padding:2px 6px;font:14px/1.35 sans-serif;";
      h += `<input id="cg-canary-${where}-input-eq" value="Canary: typed text the colour of its own field" style="${field}color:#fff;background:#fff">` +
           `<input id="cg-canary-${where}-input-grad" value="Canary: low-contrast typed text over a gradient" style="${field}color:#dcdcdc;background-image:linear-gradient(90deg,#e6e6e6,#f0f0f0)">` +
           `<input type="button" id="cg-canary-${where}-btn-grad" value="Canary: low-contrast button label over a gradient" style="${field}color:#dcdcdc;background-image:linear-gradient(90deg,#e6e6e6,#f0f0f0)">` +
           `<textarea id="cg-canary-${where}-textarea-grad" rows="1" style="${field}color:#dcdcdc;background-image:linear-gradient(90deg,#e6e6e6,#f0f0f0)">Canary: low-contrast text in a textarea over a gradient</textarea>` +
           `<input id="cg-canary-${where}-input-ok" value="Canary: readable typed text (must pass)" style="${field}color:#000;background:#fff">` +
           `<style>#cg-canary-${where}-ph::placeholder{color:#a8a8a8;opacity:1}#cg-canary-${where}-ph-grad::placeholder{color:#8f8f8f;opacity:1}#cg-canary-${where}-ph-wash::placeholder{color:#222;opacity:.3}#cg-canary-${where}-ph-ok::placeholder{color:#595959;opacity:1}</style>` +
           `<input id="cg-canary-${where}-ph" placeholder="Canary: a placeholder at 2.4:1" style="${field}color:#000;background:#fff">` +
           `<input id="cg-canary-${where}-ph-grad" placeholder="Canary: a low-contrast placeholder over a gradient" style="${field}color:#000;background-image:linear-gradient(90deg,#e6e6e6,#f0f0f0)">` +
           `<input id="cg-canary-${where}-ph-wash" placeholder="Canary: a dark placeholder washed out by opacity" style="${field}color:#000;background:#fff">` +
           `<input id="cg-canary-${where}-ph-ok" placeholder="Canary: a readable placeholder (must pass)" style="${field}color:#000;background:#fff">`;
    }
    return h;
  };
  const made = [];
  if (withCanary) {
    const route = document.getElementById("route");
    let scroller = host ? document.querySelector(host) : null;   // a modal (the welcome screen) is judged on its own
    for (let n = !scroller && route && route.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === "auto" || oy === "scroll") { scroller = n; break; }
    }
    scroller = scroller || document.body;
    const top = document.createElement("div");
    top.setAttribute("data-cg-canary", "top");
    top.innerHTML = rows("top", true);
    scroller.insertBefore(top, scroller.firstChild);
    const bottom = document.createElement("div");
    bottom.setAttribute("data-cg-canary", "bottom");
    bottom.innerHTML = rows("bottom", false);
    scroller.appendChild(bottom);
    made.push(top, bottom);
  }

  /* `only`: a tab state is judged on the elements of a kind the screen has not shown before (see STRUCT: a repeat of a measured kind
     has the same colours and backdrop in every theme), plus the canaries. axe is told to look at just those nodes; it still reads
     the whole page to find what is behind them. */
  const context = only ? { include: (window.__cgNovel || []).filter((n) => n.isConnected).concat([...document.querySelectorAll("[data-cg-canary]")]) } : document;
  const res = await axe.run(context, { runOnly: ["color-contrast"], resultTypes: ["violations", "incomplete", "passes"], elementRef: true });

  /* ---- colour arithmetic ---- */
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat([1]); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratioOf = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const rgbStr = (c) => "rgb(" + c.slice(0, 3).map(Math.round).join(",") + ")";
  /* ---- backdrops: every colour the text could sit on ----
     A background is a stack: the element's own colour, then its image layers
     (background-image lists them TOP first, so the last one is painted first).
     Each ancestor is the same, down to the nearest opaque colour (or white).
     A gradient is not a handful of stops: the colour at every point BETWEEN two
     stops is on screen too, and text can match one of those (30px #777 over
     black->white clears both ends at 4.7:1 / 4.5:1 and is unreadable in the
     grey middle). So each segment between two stops is sampled densely, in
     premultiplied alpha as CSS interpolates it. Radial, conic and repeating
     gradients paint the same colour set along a different path, so they are
     sampled identically; a HARD stop (two stops at one position) paints no
     colour between them and is not interpolated; a colour hint only moves the
     midpoint, so it adds no colour. Each layer is composited over every
     candidate beneath it, so translucent layers and layer stacks are exact,
     and an opaque upper layer rightly hides the ones below it. */
  const GRAD_STEPS = 32;       // samples inside each segment between two stops
  const MAX_CANDIDATES = 96;   // kept, spread evenly by luminance, whatever the stack multiplies out to
  const splitTop = (str, sep) => {
    const out = [];
    let depth = 0, quote = null, cur = "";
    for (const ch of str) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === "\"" || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  const colorOf = (tok) => {   // null when `tok` is not a colour (canvas keeps the previous value for an invalid one)
    cx.fillStyle = "#010203"; cx.fillStyle = tok; const a = cx.fillStyle;
    cx.fillStyle = "#040506"; cx.fillStyle = tok; const b = cx.fillStyle;
    return a === b ? rgba(tok) : null;
  };
  const mix = (a, b, t) => {   // premultiplied-alpha interpolation, as CSS gradients do
    const al = a[3] + (b[3] - a[3]) * t;
    if (al <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (a[i] * a[3] + (b[i] * b[3] - a[i] * a[3]) * t) / al).concat([al]);
  };
  const isHard = (p, q) => {   // two stops at one place (or the second one before the first, which clamps to it)
    const pm = p && /^(-?[\d.]+)([a-z%]*)$/.exec(p), qm = q && /^(-?[\d.]+)([a-z%]*)$/.exec(q);
    return !!(pm && qm && pm[2] === qm[2] && parseFloat(qm[1]) <= parseFloat(pm[1]));
  };
  const layerCache = (window.__cgLayerCache = window.__cgLayerCache || new Map());
  const parseLayer = (text) => {
    if (layerCache.has(text)) return layerCache.get(text);
    let out;
    const m = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(([\s\S]*)\)$/.exec(text);
    if (!m) out = { kind: "image" };      // url(...), image-set(...), element(...): pixels, not colours
    else {
      const stops = [];
      let bad = false;
      splitTop(m[1], ",").forEach((item, i) => {
        const toks = splitTop(item, " ");
        const c = colorOf(toks[0]);
        if (c) {
          const pos = toks.slice(1);
          if (!pos.length) stops.push({ c, pos: null });
          else pos.forEach((p) => stops.push({ c, pos: p }));
        } else if (i === 0 && !stops.length) { /* the direction / shape / "in oklab" / "from 45deg at ..." prelude: paints nothing */ }
        else if (toks.length === 1 && /^(?:[-+]?[\d.]+[a-z%]*|calc\(.*\))$/.test(toks[0])) { /* a colour hint: moves a midpoint, adds no colour */ }
        else bad = true;
      });
      if (bad || !stops.length) out = { kind: "bad" };
      else {
        const samples = [];
        stops.forEach((st, i) => {
          samples.push(st.c);
          const nx = stops[i + 1];
          if (nx && !isHard(st.pos, nx.pos)) for (let k = 1; k < GRAD_STEPS; k++) samples.push(mix(st.c, nx.c, k / GRAD_STEPS));
        });
        out = { kind: "gradient", samples };
      }
    }
    layerCache.set(text, out);
    return out;
  };
  const prune = (list) => {
    const seen = new Map();
    for (const c of list) seen.set(Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]), c);
    let out = [...seen.values()];
    if (out.length > MAX_CANDIDATES) {
      out.sort((x, y) => lum(x) - lum(y));
      out = Array.from({ length: MAX_CANDIDATES }, (_, i) => out[Math.round(i * (out.length - 1) / (MAX_CANDIDATES - 1))]);
    }
    return out;
  };
  /* Does ONE background layer paint every pixel of the element's box? A gradient
     with no size is as big as the box, so it does. One that is smaller than the
     box and not repeated (a half, a 4px bar, a 20px tile), one that is slid
     aside by a length, one whose repeat leaves gaps (`space`), and one clipped
     to the glyphs (`background-clip: text`) does not: where it is absent the
     colour BENEATH it shows, so that colour has to stay a candidate. Anything
     this cannot read for certain counts as "does not cover" - the safe side. */
  const axisFull = (size, rep, pos) => {
    if (rep === "repeat" || rep === "round") return true;      // tiles that reach the edge on this axis, each one the whole gradient
    const m = /^(-?[\d.]+)%$/.exec(size);
    const fills = size === "auto" || size === "cover" || size === "contain" || (m && parseFloat(m[1]) >= 100);
    if (!fills || rep === "space") return false;               // smaller than the box, or spread out with gaps
    return /^-?[\d.]+%$/.test(pos) || /^0(?:px)?$/.test(pos);  // a box-sized image only leaves the box if a length slides it
  };
  const coversBox = (size, repeat, pos, clip) => {
    if (clip === "text") return false;
    const sz = splitTop(size || "auto", " "), ps = splitTop(pos || "0% 0%", " ");
    const rp = repeat === "repeat-x" ? ["repeat", "no-repeat"] : repeat === "repeat-y" ? ["no-repeat", "repeat"] : splitTop(repeat || "repeat", " ");
    const one = (a) => (a.length === 1 ? [a[0], a[0]] : a);
    const [rx, ry] = one(rp);
    const sx = sz[0], sy = sz.length > 1 ? sz[1] : (sz[0] === "cover" || sz[0] === "contain" ? sz[0] : "auto");   // `100%` alone is 100% by auto (a gradient has no ratio, so auto is the box)
    if (ps.length !== 2) return false;   // a computed position is always a pair; anything else is not understood
    return axisFull(sx, rx, ps[0]) && axisFull(sy, ry, ps[1]);
  };
  const memo = new Map();   // element -> backdrop state; one theme's computed styles only, so it lives for one measurement
  const backdropOf = (n) => {
    if (memo.has(n)) return memo.get(n);
    const cs = getComputedStyle(n);
    const col = rgba(cs.backgroundColor);
    const under = (col[3] >= 1 || !n.parentElement) ? { cands: [[255, 255, 255, 1]], texture: false, unparsed: false } : backdropOf(n.parentElement);
    let cands = under.cands, texture = under.texture, unparsed = under.unparsed;
    if (col[3] > 0) cands = cands.map((c) => over(col, c));
    const layers = cs.backgroundImage && cs.backgroundImage !== "none" ? splitTop(cs.backgroundImage, ",") : [];
    /* background-size / -repeat / -position / -clip are lists, cycled over the layers (the first belongs to the TOP layer) */
    const each = (v) => splitTop(v || "", ",");
    const sizes = each(cs.backgroundSize), repeats = each(cs.backgroundRepeat), poss = each(cs.backgroundPosition), clips = each(cs.backgroundClip);
    const pick = (list, i, dflt) => (list.length ? list[i % list.length] : dflt);
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = parseLayer(layers[i]);
      if (L.kind === "image") { texture = true; continue; }
      if (L.kind === "bad") { unparsed = true; continue; }
      const next = [];
      for (const c of cands) for (const smp of L.samples) next.push(over(smp, c));
      const whole = coversBox(pick(sizes, i, "auto"), pick(repeats, i, "repeat"), pick(poss, i, "0% 0%"), pick(clips, i, "border-box"));
      cands = prune(whole ? next : cands.concat(next));   // a layer that leaves part of the box bare does not hide what is under it
    }
    const st = { cands, texture, unparsed };
    memo.set(n, st);
    return st;
  };
  const backdrops = (el) => backdropOf(el);

  const misses = [];
  const kinds = {};
  const unmeasured = {};
  let evaluated = 0;
  /* The text a Soldier reads in a node. A form control has no text node: its text is its VALUE (a typed entry, a button
     label) or, for a <select>, the chosen option. Reading textContent for those found nothing and so never measured them. */
  const textOf = (el) => {
    const t = el.tagName;
    if (t === "INPUT" || t === "TEXTAREA") return String(el.value || "").trim();
    if (t === "SELECT") return [...el.selectedOptions].map((o) => o.textContent).join(" ").trim();
    return (el.textContent || "").trim();
  };
  const isCanary = (n) => /cg-canary/.test(n.target.join(" "));
  const seenCanary = { passed: [], missed: [] };
  const note = (n, how) => { if (isCanary(n)) (how === "miss" ? seenCanary.missed : seenCanary.passed).push(n.target.join(" ")); };

  for (const p of res.passes) for (const n of p.nodes) { if (isCanary(n)) note(n, "pass"); else evaluated++; }
  for (const v of res.violations) for (const n of v.nodes) {
    const d = (n.any[0] && n.any[0].data) || {};
    if (isCanary(n)) { note(n, "miss"); continue; }
    evaluated++;
    misses.push({ sel: n.target.join(" "), ratio: d.contrastRatio, need: d.expectedContrastRatio ? parseFloat(d.expectedContrastRatio) : 4.5, fg: d.fgColor, bg: d.bgColor, via: "axe", text: textOf(n.element).slice(0, 48) });
  }
  const unmeasure = (key, n) => {
    if (isCanary(n)) return;
    kinds[key] = (kinds[key] || 0) + 1;
    (unmeasured[key] = unmeasured[key] || []).push(n.target.join(" ").slice(0, 120));
  };
  for (const v of res.incomplete) for (const n of v.nodes) {
    const key = [].concat(n.any, n.all, n.none).map((c) => c && c.data && c.data.messageKey).find(Boolean) || "unknown";
    const el = n.element;
    const resolvable = RESOLVABLE.indexOf(key) !== -1;
    if (!resolvable) { unmeasure(key, n); continue; }
    const shown = textOf(el);
    if (!shown) { unmeasure("noText", n); continue; }
    const cs = getComputedStyle(el);
    let fg = rgba(cs.color);
    fg[3] = fg[3] * opacityOf(el);
    // Fully transparent text and text the same colour as its backdrop are ratio 1:1, a miss: a 1:1 ratio is never read as
    // "meant to be hidden". Text that really is meant to be invisible goes through the ALLOWLIST, by theme + selector + reason.
    const bd = backdrops(el);
    if (bd.unparsed) { unmeasure(key, n); continue; }
    let worst = null;
    for (const b of bd.cands) {
      const f = over(fg, b);
      const r = ratioOf(f, b);
      if (!worst || r < worst.r) worst = { r, f, b };
    }
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (isCanary(n)) { note(n, worst.r < need ? "miss" : "pass"); continue; }
    evaluated++;
    kinds["resolved:" + key] = (kinds["resolved:" + key] || 0) + 1;
    if (worst.r < need) misses.push({ sel: n.target.join(" "), ratio: Math.round(worst.r * 100) / 100, need, fg: rgbStr(worst.f), bg: rgbStr(worst.b), via: "resolved:" + key + (bd.texture ? "+texture" : ""), text: shown.slice(0, 48) });
  }

  /* ---- placeholders: drawn by the browser in ::placeholder, which axe never looks at ----
     The colour is the pseudo-element's own computed colour, at its own opacity and the field's ancestors', judged
     against whatever the FIELD sits on (its own colour and image layers, then its ancestors'). */
  let placeholders = 0;
  document.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((el) => {
    if (el.value || !el.getAttribute("placeholder").trim()) return;
    if (el.tagName === "INPUT" && !/^(?:text|search|url|tel|email|password|number)$/.test(el.type)) return;
    const box = el.getBoundingClientRect(), fcs = getComputedStyle(el);
    if (box.width < 1 || box.height < 1 || fcs.visibility === "hidden" || el.closest("[hidden]")) return;
    const ph = getComputedStyle(el, "::placeholder");
    const fg = rgba(ph.color);
    fg[3] = fg[3] * (parseFloat(ph.opacity) || 0) * opacityOf(el);
    const bd = backdrops(el);
    let worst = null;
    for (const b of bd.cands) { const f = over(fg, b), r = ratioOf(f, b); if (!worst || r < worst.r) worst = { r, f, b }; }
    const px = parseFloat(ph.fontSize), bold = parseInt(ph.fontWeight, 10) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (el.id.indexOf("cg-canary") === 0) { (worst.r < need ? seenCanary.missed : seenCanary.passed).push("#" + el.id); return; }
    placeholders++;
    evaluated++;
    kinds["resolved:placeholder"] = (kinds["resolved:placeholder"] || 0) + 1;
    if (bd.unparsed) { kinds.placeholderUnparsed = (kinds.placeholderUnparsed || 0) + 1; (unmeasured.placeholderUnparsed = unmeasured.placeholderUnparsed || []).push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")); return; }
    if (worst.r < need) {
      const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
      misses.push({ sel: (el.id ? "#" + el.id : el.tagName.toLowerCase() + cls) + "::placeholder", ratio: Math.round(worst.r * 100) / 100, need, fg: rgbStr(worst.f), bg: rgbStr(worst.b), via: "placeholder" + (bd.texture ? "+texture" : ""), text: el.getAttribute("placeholder").trim().slice(0, 48) });
    }
  });

  const html = document.documentElement;
  const applied = { attr: html.getAttribute("data-theme"), light: html.classList.contains("light") };
  for (const m of made) m.remove();
  for (const k of Object.keys(unmeasured)) unmeasured[k] = unmeasured[k].slice(0, 4);
  return { applied, evaluated, placeholders, misses, kinds, unmeasured, canary: seenCanary };
};

const CANARY_EXPECT = {
  caught: ["cg-canary-top-solid", "cg-canary-top-gradient", "cg-canary-top-image", "cg-canary-top-small-bad", "cg-canary-top-large-bad", "cg-canary-bottom-solid", "cg-canary-bottom-gradient",
    "cg-canary-top-equal", "cg-canary-top-gradient-mid", "cg-canary-top-radial-mid", "cg-canary-top-conic-mid", "cg-canary-top-repeating-mid", "cg-canary-top-alpha-mid", "cg-canary-top-layers-mid",
    /* an opaque gradient over only PART of the box must not hide the colour under it */
    "cg-canary-top-partial-half", "cg-canary-top-partial-bar", "cg-canary-top-partial-tile", "cg-canary-top-partial-shift", "cg-canary-top-partial-xbar", "cg-canary-top-partial-space",
    /* form controls: the value is the text; the placeholder is drawn by the browser */
    "cg-canary-top-input-eq", "cg-canary-top-input-grad", "cg-canary-top-btn-grad", "cg-canary-top-textarea-grad",
    "cg-canary-top-ph", "cg-canary-top-ph-grad", "cg-canary-top-ph-wash"],
  clean: ["cg-canary-top-large-ok", "cg-canary-top-honest", "cg-canary-top-honest-gradient", "cg-canary-top-gradient-outside", "cg-canary-top-hard-ok", "cg-canary-top-layers-ok",
    "cg-canary-top-full-ok", "cg-canary-top-tile-ok", "cg-canary-top-input-ok", "cg-canary-top-ph-ok"],
  /* planted CLOSED in the screen before it is opened; reported only if the sweep really opens every <details> */
  details: ["cg-canary-details-text"],
};

/* =====================================================================
   THE RUN
   ===================================================================== */
const T0 = Date.now();
const fmtS = (ms) => (ms / 1000).toFixed(1) + "s";

const boot = await bootApp({ dir: WEB_DIR, viewport: { width: BASE_W, height: BASE_H }, profile: { ...PERSONAL_PROFILE } });
const watchdog = setTimeout(async () => {
  console.log(`  FAIL  the sweep was still running after ${WATCHDOG_MS / 60000} minutes and was stopped`);
  try { await Promise.race([boot.close(), new Promise((r) => setTimeout(r, 10000))]); } catch (e) { /* already closing */ }
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

async function prepPage(page) {
  // Colours must be steady-state, not mid-fade (the app crossfades on theme change).
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }" });
  await page.addScriptTag({ content: axeSrc });
}
const profilePage = boot.page;
await prepPage(profilePage);

const { themes, routes } = await profilePage.evaluate(() => ({
  themes: window.G.theme.THEMES.map((t) => ({ id: t.id, kind: t.kind })),
  routes: window.G.routes.map((r) => r.hash),
}));
const THEME_LIST = ONLY_THEMES ? themes.filter((t) => ONLY_THEMES.includes(t.id)) : themes;
const ROUTE_LIST = ONLY_ROUTES ? routes.filter((h) => ONLY_ROUTES.includes(h)) : routes;
console.log(`  SUITE ${SUITE}: ${[RUN_SCREENS && "screens (every screen, interaction states, guest, first-run)", RUN_TABS && "tabs (every tab, segment and chip of every screen)"].filter(Boolean).join(" + ")}`);
if (PARTIAL) console.log(`  NOTE  PARTIAL RUN (${THEME_LIST.length} of ${themes.length} themes, ${ROUTE_LIST.length} of ${routes.length} routes: ${ROUTE_LIST.join(" ")}${ONLY_STATES ? ", states: " + ONLY_STATES.join("|") : ""}${TAB_ALL ? ", every tab state measured" : ""}): the coverage floors are skipped, so this is not the gate`);
if (!THEME_LIST.length || !ROUTE_LIST.length) { bad("the partial selection matched no theme or no route"); await finish("CONTRAST-FULL"); }

check(themes.length >= FLOORS.themes, `the theme registry lists ${themes.length} themes (floor ${FLOORS.themes})`, `only ${themes.length} themes registered - the list was cut, the sweep would no longer cover every theme`);
check(routes.length >= FLOORS.routes, `G.routes lists ${routes.length} screens (floor ${FLOORS.routes})`, `only ${routes.length} screens in G.routes - the sweep would no longer cover every screen`);

/* ---------------- bookkeeping ---------------- */
const misses = new Map();          // theme|route|selector|via -> aggregate
const stats = {};                  // pass -> { evaluated, placeholders, combos, kinds, unmeasured, byTheme, byLabel, thinnest, states, unreached }
const harness = { appliedWrong: [], canaryWrong: [], pageHeights: [], deadlines: 0, truncated: [] };
const statOf = (pass) => (stats[pass] = stats[pass] || { evaluated: 0, placeholders: 0, combos: 0, states: 0, kinds: {}, unmeasured: {}, byTheme: {}, byLabel: {}, thinnest: { n: Infinity, at: "" }, unreached: [] });
const statesOf = (pass) => (stats[pass] ? stats[pass].states : 0);
const normSel = (s) => s.replace(/:nth-(?:child|of-type)\(\d+\)/g, "").replace(/\[data-[a-z-]+="[^"]*"\]/g, "[data-*]");

function record(pass, stateLabel, themeId, r, route) {
  const s = statOf(pass);
  s.combos++;
  s.evaluated += r.evaluated;
  s.placeholders += r.placeholders;
  s.byTheme[themeId] = (s.byTheme[themeId] || 0) + r.evaluated;
  s.byLabel[stateLabel] = Math.min(s.byLabel[stateLabel] === undefined ? Infinity : s.byLabel[stateLabel], r.evaluated);
  if (r.evaluated < s.thinnest.n) s.thinnest = { n: r.evaluated, at: stateLabel + " / " + themeId };
  for (const [k, n] of Object.entries(r.kinds)) s.kinds[k] = (s.kinds[k] || 0) + n;
  for (const [k, list] of Object.entries(r.unmeasured)) if (!(s.unmeasured[k] && s.unmeasured[k].length >= 6)) s.unmeasured[k] = (s.unmeasured[k] || []).concat(list.map((x) => stateLabel + " :: " + x)).slice(0, 6);
  for (const m of r.misses) {
    const sel = normSel(m.sel);
    const key = themeId + "|" + route + "|" + sel + "|" + m.via;
    const e = misses.get(key) || { theme: themeId, route, selector: sel, via: m.via, n: 0, ratio: Infinity, need: m.need, fg: "", bg: "", text: "", where: new Set() };
    e.n++;
    e.where.add(pass + ":" + stateLabel);
    if (m.ratio < e.ratio) { e.ratio = m.ratio; e.need = m.need; e.fg = m.fg; e.bg = m.bg; e.text = m.text; }
    misses.set(key, e);
  }
}

/* page.setViewportSize, tolerant of one browser quirk: while a screen is in
   its fullscreen "theater" layout (the Rapid Fire round), the protocol call
   that moves the OS window answers "restore it to normal state first" even
   though the page viewport itself did change. Trust what the page reports. */
async function resizeTo(page, height) {
  try {
    await page.setViewportSize({ width: BASE_W, height });
  } catch (e) {
    const ih = await page.evaluate(() => innerHeight);
    if (!/setWindowBounds/.test(String(e.message)) || Math.abs(ih - height) > 1) throw e;
  }
}

/* ---------------- one screen / state, every theme ---------------- */
async function fitWindow(page, label) {
  let h = BASE_H;
  for (let i = 0; i < 6; i++) {
    const f = await page.evaluate(FIT);
    const want = Math.min(MAX_H, Math.max(BASE_H, Math.ceil(f.need) + CANARY_ROOM));
    h = f.ih;
    if (f.scrolling && f.ih >= MAX_H) { harness.truncated.push(label + " (" + Math.ceil(f.need) + "px needed, window " + f.ih + "px)"); break; }
    if (want <= f.ih && !f.scrolling) break;
    await resizeTo(page, Math.max(want, f.ih + (f.scrolling ? 1000 : 0)));
    h = want;
    const why = await page.evaluate(SETTLE, { quiet: 120, max: 4000 });
    if (why === "deadline") harness.deadlines++;
  }
  harness.pageHeights.push(h);
  return h;
}

/* `route` is the screen this state belongs to (the allowlist and the per-screen floors are keyed by it);
   `detailsCanary` says the screen was prepared with the closed-<details> canary (see PREPARE). */
async function measureState(page, pass, label, themeList, { host = null, height = 0, route = label.split(" ")[0], detailsCanary = false, only = false } = {}) {
  const s = statOf(pass);
  s.states++;
  if (height) { await resizeTo(page, height); harness.pageHeights.push(height); } else await fitWindow(page, pass + ":" + label);
  const wantCaught = CANARY_EXPECT.caught.concat(detailsCanary ? CANARY_EXPECT.details : []);
  let evaluatedHere = 0, hits = 0;
  for (const t of themeList) {
    const r = await page.evaluate(MEASURE, { id: t.id, withCanary: true, RESOLVABLE, host, only });
    evaluatedHere += r.evaluated;
    hits += r.misses.length;
    const lightOk = r.applied.light === (t.kind === "light");
    if (r.applied.attr !== t.id || !lightOk) harness.appliedWrong.push(`${pass}:${label} ${t.id}: data-theme="${r.applied.attr}" light=${r.applied.light} (registry says ${t.kind})`);
    const flagged = (id) => r.canary.missed.some((x) => x === "#" + id);
    const cleared = (id) => r.canary.passed.some((x) => x === "#" + id);
    const caught = wantCaught.filter((id) => !flagged(id));
    const cried = CANARY_EXPECT.clean.filter((id) => flagged(id));
    const absent = CANARY_EXPECT.clean.filter((id) => !cleared(id) && !flagged(id));
    if (caught.length || cried.length || absent.length) harness.canaryWrong.push(`${pass}:${label} ${t.id}: not reported [${caught.join(", ")}]; wrongly flagged [${cried.join(", ")}]; never evaluated [${absent.join(", ")}]`);
    record(pass, label, t.id, r, route);
  }
  await page.evaluate(() => document.querySelectorAll("[data-cg-canary=\"details\"]").forEach((n) => n.remove()));
  await resizeTo(page, BASE_H);
  console.log(`    ${("[" + pass + "] " + label).padEnd(62)} ${String(Math.round(evaluatedHere / Math.max(1, themeList.length))).padStart(5)} texts/theme  ${hits ? hits + " miss(es)" : "clean"}`);
  return evaluatedHere;
}

async function settleAndPrepare(page, { canary = true } = {}) {
  const why = await page.evaluate(SETTLE, { quiet: 150, max: 4000 });
  if (why === "deadline") harness.deadlines++;
  const prep = await page.evaluate(PREPARE, { canary });
  if (prep.opened || canary) {
    const why2 = await page.evaluate(SETTLE, { quiet: 100, max: 3000 });
    if (why2 === "deadline") harness.deadlines++;
  }
  return prep;
}

const signatures = { profile: new Map() };
const surfaceSeen = new Map();
const SURFACES = [
  { route: "#/profile", sel: ".promo-cat-val", why: "promotion points (needs a profile)" },
  { route: "#/career", sel: ".tag.you-are-here", why: "the \"you are here\" tag (needs a rank)" },
  { route: "#/progress", sel: ".readiness-legend", why: "the readiness legend" },
  { route: "#/develop", sel: "details > summary", why: "the development pathway summaries" },
  { route: "#/settings", sel: ".last-backup-status", why: "the backup line" },
];

const profileIsGuest = await profilePage.evaluate(() => window.G.profile.isGuest());
const guestRoutes = [];
const guestSame = [];
let guestIsGuest = null;
const STATES = [];
let STATE_LIST = [];
const WELCOME = [
  { label: "welcome screen (choose how to start)", setup: async () => {} },
  { label: "welcome screen (Personal Account step)", setup: async (page) => {
    await page.evaluate(() => { const c = [...document.querySelectorAll("#ob-overlay .ob-mode-card")].find((b) => /Personal/i.test(b.textContent)); if (c) c.click(); });
    if (!(await until(page, () => !!document.querySelector("#ob-overlay .ob-rank-btn")))) throw new Error("the Personal Account step never showed its rank buttons");
  } },
];

if (RUN_SCREENS) {
  /* ---------------- 1) the profile pass: every screen ---------------- */
  console.log(`\n  [profile] ${ROUTE_LIST.length} screens x ${THEME_LIST.length} themes (${fmtS(Date.now() - T0)} in)`);
  for (const hash of ROUTE_LIST) {
    const label = hash;
    try {
      await waitForRoute(profilePage, hash);
      const prep = await settleAndPrepare(profilePage);
      signatures.profile.set(hash, prep.sig);
      const want = SURFACES.filter((x) => x.route === hash);
      for (const w of want) surfaceSeen.set(w.route + " " + w.sel, await profilePage.evaluate((sel) => !!document.querySelector("#route " + sel), w.sel));
      await measureState(profilePage, "profile", label, THEME_LIST, { route: hash, detailsCanary: true });
    } catch (e) {
      statOf("profile").unreached.push(label + ": " + String(e.message).split("\n")[0].slice(0, 200));
      await resizeTo(profilePage, BASE_H).catch(() => {});
    }
  }

  /* ---------------- 2) interaction states (profile session) ---------------- */
  const stateOf = (label, setup) => STATES.push({ label, setup });

  stateOf("#/board (card flipped, .qz-back visible)", async (page) => {
    await waitForRoute(page, "#/board", { fresh: true, ready: ".qz-nav-flip" });
    await page.evaluate(() => document.querySelector(".qz-nav-flip").click());
    if (!(await until(page, () => !!document.querySelector(".qz-card.flipped")))) throw new Error("the Board Drill card did not flip");
  });

  stateOf("#/board (Rapid Fire live round)", async (page) => {
    await waitForRoute(page, "#/board", { fresh: true, ready: ".segmented button" });
    const click = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll(".segmented button, button")].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }, text);
    if (!(await until(page, () => [...document.querySelectorAll(".segmented button")].some((b) => b.textContent.trim() === "Rapid Fire")))) throw new Error("no Rapid Fire tab");
    await click("Rapid Fire");
    if (!(await until(page, () => [...document.querySelectorAll(".segmented button")].some((b) => b.textContent.trim() === "Solo")))) throw new Error("no Solo mode button");
    await click("Solo");
    if (!(await until(page, () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Start Round")))) throw new Error("no Start Round button");
    await click("Start Round");
    if (!(await until(page, () => !!document.querySelector(".rf-judge-correct") && !!document.querySelector(".rf-judge-pass")))) throw new Error("the round never showed its judge buttons");
  });

  const promoFill = (goal) => async (page) => {
    await waitForRoute(page, "#/profile", { fresh: true, ready: ".promo-cat-val" });
    await page.evaluate((g) => {
      document.querySelectorAll(".promo-range").forEach((r) => { r.value = String(Math.round(+r.max / 2 / (+r.step || 5)) * (+r.step || 5)); r.dispatchEvent(new Event("input", { bubbles: true })); });
      const gi = document.getElementById("promo-goal");
      gi.value = String(g); gi.dispatchEvent(new Event("input", { bubbles: true })); gi.dispatchEvent(new Event("change", { bubbles: true }));
    }, goal);
    if (!(await until(page, () => /goal/.test((document.querySelector(".promo-gap") || {}).textContent || "")))) throw new Error("the promotion-points gap line stayed empty");
  };
  stateOf("#/profile (promotion points filled, goal not met)", promoFill(790));
  stateOf("#/profile (promotion points filled, goal met)", promoFill(1));

  const backupFresh = (hash) => async (page) => {
    await page.evaluate(() => window.G.db.setSetting("backup:lastExportAt", new Date().toISOString()));
    await waitForRoute(page, hash, { fresh: true, ready: ".last-backup-status" });
    if (!(await until(page, () => { const e = document.querySelector(".last-backup-status"); return !!e && /Last backed up/.test(e.textContent); }))) throw new Error("the backup line never showed a recent backup");
  };
  stateOf("#/settings (backed up today)", backupFresh("#/settings"));
  stateOf("#/profile (backed up today)", backupFresh("#/profile"));

  STATE_LIST = ONLY_STATES ? STATES.filter((st) => ONLY_STATES.some((k) => st.label.indexOf(k) !== -1)) : STATES;
  if (STATE_LIST.length) {
    console.log(`  [profile] ${STATE_LIST.length} interaction states x ${THEME_LIST.length} themes (${fmtS(Date.now() - T0)} in)`);
    for (const st of STATE_LIST) {
      try {
        await st.setup(profilePage);
        await settleAndPrepare(profilePage);
        await measureState(profilePage, "state", st.label, THEME_LIST, { detailsCanary: true });
      } catch (e) {
        statOf("state").unreached.push(st.label + ": " + String(e.message).split("\n")[0].slice(0, 200));
        await resizeTo(profilePage, BASE_H).catch(() => {});
      }
    }
  }
  await profilePage.evaluate(() => window.G.db.setSetting("backup:lastExportAt", null)).catch(() => {});

  /* ---------------- 3) the guest pass: screens whose guest drawing differs ---------------- */
  console.log(`  [guest] drawing ${ROUTE_LIST.length} screens as a guest to find the ones that differ (${fmtS(Date.now() - T0)} in)`);
  const guest = await boot.openSession({ viewport: { width: BASE_W, height: BASE_H }, profile: "guest", noise: boot.noise });
  const guestPage = guest.page;
  await prepPage(guestPage);
  guestIsGuest = await guestPage.evaluate(() => window.G.profile.isGuest());
  for (const hash of ROUTE_LIST) {
    try {
      await waitForRoute(guestPage, hash);
      const prep = await settleAndPrepare(guestPage);
      if (prep.sig !== signatures.profile.get(hash)) {
        guestRoutes.push(hash);
        await measureState(guestPage, "guest", hash, THEME_LIST, { route: hash, detailsCanary: true });
      } else guestSame.push(hash);
    } catch (e) {
      statOf("guest").unreached.push(hash + ": " + String(e.message).split("\n")[0].slice(0, 200));
      await resizeTo(guestPage, BASE_H).catch(() => {});
    }
  }
  console.log(`  [guest] ${guestRoutes.length} of ${ROUTE_LIST.length} screens draw differently for a guest and were swept in every theme; ${guestSame.length} are identical to the profile drawing (already swept)`);

  /* ---------------- 4) the welcome screen: the first thing every new install shows ---------------- */
  if (!ONLY_ROUTES) {
    console.log(`  [welcome] ${WELCOME.length} first-run screens x ${THEME_LIST.length} themes (${fmtS(Date.now() - T0)} in)`);
    const first = await boot.openSession({ viewport: { width: BASE_W, height: BASE_H }, profile: null, noise: boot.noise });
    const wp = first.page;
    try {
      await prepPage(wp);
      if (!(await until(wp, () => !!document.querySelector("#ob-overlay")))) throw new Error("the welcome screen never opened");
      for (const w of WELCOME) {
        try {
          await w.setup(wp);
          await wp.evaluate(SETTLE, { quiet: 150, max: 4000 });
          await measureState(wp, "welcome", w.label, THEME_LIST, { host: "#ob-overlay", height: 2400, route: "welcome" });
        } catch (e) {
          statOf("welcome").unreached.push(w.label + ": " + String(e.message).split("\n")[0].slice(0, 200));
        }
      }
    } catch (e) {
      statOf("welcome").unreached.push("the welcome screen: " + String(e.message).split("\n")[0].slice(0, 200));
    }
  }
}

/* ---------------- 5) the tab walk: every tab, segment and chip of every screen ---------------- */
const tabInfo = {};      // route -> { visited, measured, same, risky, left, capped }
if (RUN_TABS) {
  console.log(`\n  [tabs] walking the tabs, segments and chips of ${ROUTE_LIST.length} screens (${fmtS(Date.now() - T0)} in)`);
  const SETTLE_TAB = { quiet: 100, max: 3000 };
  const sameScreen = (h, hash) => h === hash || h.indexOf(hash + "/") === 0 || h.indexOf(hash + "?") === 0;
  for (const hash of ROUTE_LIST) {
    const info = (tabInfo[hash] = { visited: 0, measured: 0, same: 0, stopped: 0, risky: [], left: [], capped: false });
    if (NO_TAB_WALK[hash]) { info.skipped = NO_TAB_WALK[hash]; continue; }
    try {
      /* the default tab: already swept by the screens suite; it seeds the set of element kinds this screen has shown */
      await waitForRoute(profilePage, hash, { fresh: true });
      await settleAndPrepare(profilePage, { canary: false });
      await profilePage.evaluate(STRUCT, { reset: true, commit: true });
      const flags0 = await profilePage.evaluate(APP_FLAGS);
      const base = await profilePage.evaluate(TAB_ACT, { sel: TAB_SEL, risky: TAB_RISKY });
      const seenKeys = new Set(base.list.filter((x) => x.selected).map((x) => x.key));
      const queue = [];
      const groups = new Map();   // controls of one kind in containers of one kind share their patience (see TAB_PATIENCE)
      const enqueue = (list, path) => {
        for (const x of list) {
          if (x.selected || seenKeys.has(x.key)) continue;
          seenKeys.add(x.key);
          if (x.risky) { info.risky.push(x.label); continue; }
          const gk = path.map((p) => p.key).join(">") + "#" + x.group;
          if (!groups.has(gk)) groups.set(gk, { quiet: 0, size: 0 });
          const grp = groups.get(gk);
          grp.size++;
          queue.push({ path: path.concat([{ i: x.i, key: x.key, label: x.label }]), grp });
        }
      };
      enqueue(base.list, []);
      while (queue.length) {
        const { path, grp } = queue.shift();
        if (!TAB_ALL && grp.quiet >= TAB_PATIENCE) { info.stopped++; continue; }
        if (info.visited >= TAB_CAP) { info.capped = true; break; }
        await waitForRoute(profilePage, hash, { fresh: true });
        await profilePage.evaluate(SETTLE, SETTLE_TAB);
        let pressedAll = true;
        for (const step of path) {
          const r = await profilePage.evaluate(TAB_ACT, { sel: TAB_SEL, risky: TAB_RISKY, press: { i: step.i, key: step.key } });
          if (!r.pressed) { pressedAll = false; break; }
          await profilePage.evaluate(SETTLE, SETTLE_TAB);
        }
        if (!pressedAll) continue;
        const prep = await profilePage.evaluate(PREPARE, { canary: false });       // open the closed <details>: what is in them is part of the state
        if (prep.opened) await profilePage.evaluate(SETTLE, { quiet: 60, max: 3000 });
        const after = await profilePage.evaluate(TAB_ACT, { sel: TAB_SEL, risky: TAB_RISKY });
        const label = hash + " > " + path.map((x) => x.label).join(" > ");
        if (!sameScreen(after.hash, hash)) { info.left.push(label + " -> " + after.hash); continue; }
        const flags = await profilePage.evaluate(APP_FLAGS);
        if (flags !== flags0) throw new Error(`pressing ${JSON.stringify(path[path.length - 1].label)} changed an app-wide setting on <html>/<body> (${flags0} -> ${flags}): that is a preference, not a tab - keep it out of the walk`);
        info.visited++;
        if (path.length < TAB_DEPTH) enqueue(after.list, path);
        const kinds = await profilePage.evaluate(STRUCT, { reset: false, commit: false });
        if (!TAB_ALL && kinds.fresh === 0) { grp.quiet++; info.same++; continue; }
        grp.quiet = 0;
        await profilePage.evaluate(STRUCT, { reset: false, commit: true });
        info.measured++;
        await settleAndPrepare(profilePage);                                        // plants the closed-<details> canary, then measures
        await measureState(profilePage, "tabs", label, THEME_LIST, { route: hash, detailsCanary: true, only: !TAB_ALL });
      }
    } catch (e) {
      statOf("tabs").unreached.push(hash + ": " + String(e.message).split("\n")[0].slice(0, 240));
      await resizeTo(profilePage, BASE_H).catch(() => {});
    }
  }
  const tot = Object.values(tabInfo).reduce((a, i) => ({ v: a.v + i.visited, m: a.m + i.measured, s: a.s + i.same, x: a.x + i.stopped }), { v: 0, m: 0, s: 0, x: 0 });
  console.log(`  [tabs] ${tot.v} tab states reached on ${Object.values(tabInfo).filter((i) => i.visited).length} screens: ${tot.m} measured in ${THEME_LIST.length} themes, ${tot.s} showed no kind of element that an earlier state of the same screen had not (not measured twice), ${tot.x} more controls of long groups left unpressed after ${TAB_PATIENCE} such presses in a row`);
}

/* =====================================================================
   VERDICTS
   ===================================================================== */
const elapsed = Date.now() - T0;
await boot.close().catch(() => {});

/* ---- harness honesty ---- */
check(harness.appliedWrong.length === 0, `G.theme.applyTheme set data-theme and the html light class to match the registry on every measurement (${Object.values(stats).reduce((a, s) => a + s.combos, 0)} of them)`,
  () => `${harness.appliedWrong.length} measurement(s) where the theme was not really applied: ${harness.appliedWrong.slice(0, 4).join(" | ")}`);
check(harness.canaryWrong.length === 0, "the planted canaries were reported (and the honest controls were not) on every measurement",
  () => `${harness.canaryWrong.length} measurement(s) where the harness misjudged its own canaries - it can no longer be trusted: ${harness.canaryWrong.slice(0, 4).join(" | ")}`);
check(harness.truncated.length === 0, "every screen fit inside the measuring window (nothing was left scrolled out of sight)",
  () => `${harness.truncated.length} screen(s) taller than the ${MAX_H}px window: ${harness.truncated.slice(0, 4).join(" | ")}`);
check(harness.deadlines <= 3, `the screens settled before their deadline (${harness.deadlines} slow settle(s), at most 3 tolerated)`,
  `${harness.deadlines} screens never stopped changing before their deadline - measurements may have been taken mid-draw`);
for (const [pass, s] of Object.entries(stats)) {
  check(s.unreached.length === 0, `[${pass}] every screen and state was reached (${s.states} measured)`, () => `${s.unreached.length} not reached: ${s.unreached.slice(0, 5).join(" | ")}`);
}
const noiseErrors = boot.noise.filter((n) => /pageerror:/.test(n));
check(noiseErrors.length === 0, "no uncaught page error during the sweep", () => `${noiseErrors.length}: ${noiseErrors.slice(0, 3).join(" | ")}`);

/* ---- the sessions are what they claim to be (this runs in every run, partial or not) ---- */
check(profileIsGuest === false, "the main pass really is a Soldier with a finished profile (G.profile.isGuest() is false)", "the main pass was supposed to run with a finished profile but G.profile.isGuest() is true - the profile was not applied");
if (RUN_SCREENS) check(guestIsGuest === true, "the second pass really is a guest session (G.profile.isGuest() is true)", "the guest pass was supposed to be a guest session but G.profile.isGuest() is false");

/* ---- non-vacuity ---- */
const floorOf = (table, key, what) => {
  const f = table[key];
  if (f === undefined) { bad(`${what} ${key}: no floor is recorded for it - add one to ROUTE_FLOORS (about half of what a run measures)`); return 0; }
  return f;
};
if (!PARTIAL) {
  if (RUN_SCREENS) {
    const P = statOf("profile"), G = statOf("guest"), S = statOf("state"), W = statOf("welcome");
    check(P.states === ROUTE_LIST.length, `[profile] swept all ${ROUTE_LIST.length} screens as a Soldier with a finished profile`, `swept only ${P.states} of ${ROUTE_LIST.length}`);
    check(P.evaluated >= FLOORS.profileTotal, `[profile] evaluated ${P.evaluated} pieces of text (floor ${FLOORS.profileTotal})`, `[profile] only ${P.evaluated} pieces of text evaluated (floor ${FLOORS.profileTotal}) - the sweep is not looking at enough`);
    const perTheme = themes.map((t) => [t.id, P.byTheme[t.id] || 0]).sort((a, b) => a[1] - b[1])[0];
    check(perTheme[1] >= FLOORS.profilePerTheme, `[profile] every theme had at least ${FLOORS.profilePerTheme} pieces of text evaluated (fewest: ${perTheme[0]} with ${perTheme[1]})`, `[profile] ${perTheme[0]}: only ${perTheme[1]} pieces of text evaluated (floor ${FLOORS.profilePerTheme})`);
    check(S.states === STATES.length, `[state] reached all ${STATES.length} interaction states`, `reached only ${S.states} of ${STATES.length}`);
    check(S.evaluated >= FLOORS.stateTotal, `[state] evaluated ${S.evaluated} pieces of text (floor ${FLOORS.stateTotal})`, `[state] only ${S.evaluated} pieces of text evaluated (floor ${FLOORS.stateTotal})`);
    check(guestRoutes.length >= 1, `[guest] ${guestRoutes.length} screen(s) draw differently for a guest: ${guestRoutes.join(", ")} (the other ${guestSame.length} are identical to the profile drawing)`, "no screen differs between a guest and a profile - the two sessions are not what they claim to be");
    check(G.evaluated >= FLOORS.guestTotal, `[guest] evaluated ${G.evaluated} pieces of text (floor ${FLOORS.guestTotal})`, `[guest] only ${G.evaluated} pieces of text evaluated (floor ${FLOORS.guestTotal})`);
    check(W.states === WELCOME.length, `[welcome] reached all ${WELCOME.length} first-run screens`, `reached only ${W.states} of ${WELCOME.length}`);
    check(W.evaluated >= FLOORS.welcomeTotal, `[welcome] evaluated ${W.evaluated} pieces of text (floor ${FLOORS.welcomeTotal})`, `[welcome] only ${W.evaluated} pieces of text evaluated (floor ${FLOORS.welcomeTotal})`);
    /* every single screen and state has its OWN floor (about half of its thinnest theme's count), so one screen cannot collapse behind the totals */
    for (const [pass, s] of [["profile", P], ["state", S], ["guest", G], ["welcome", W]]) {
      for (const [label, n] of Object.entries(s.byLabel)) {
        const f = pass === "guest" && ROUTE_FLOORS.guest[label] === undefined ? FLOORS.guestOtherScreen : floorOf(ROUTE_FLOORS[pass], label, `[${pass}]`);
        check(n >= f, `[${pass}] ${label}: at least ${f} pieces of text in every theme (thinnest ${n})`, `[${pass}] ${label}: only ${n} pieces of text in one theme (floor ${f}) - it was measured blank or half drawn`);
      }
    }
    /* placeholders are drawn by the browser, not in the DOM text: their own floor says the sweep still finds the fields */
    check(P.placeholders >= FLOORS.placeholdersProfile, `[profile] measured ${P.placeholders} placeholders (floor ${FLOORS.placeholdersProfile})`, `[profile] only ${P.placeholders} placeholders measured (floor ${FLOORS.placeholdersProfile}) - the placeholder pass is not seeing the fields`);
    /* The surfaces the audit named as missing from the old sweep must be on screen in the profile pass. */
    for (const w of SURFACES) {
      const k = w.route + " " + w.sel;
      check(surfaceSeen.get(k) === true, `[profile] ${w.route} shows ${w.sel} (${w.why})`, `[profile] ${w.route} did not show ${w.sel} (${w.why}) - that surface is not being swept`);
    }
  }
  if (RUN_TABS) {
    const T = statOf("tabs");
    const reached = Object.values(tabInfo).reduce((a, i) => a + i.visited, 0);
    check(reached >= FLOORS.tabStatesTotal, `[tabs] reached ${reached} tab states (floor ${FLOORS.tabStatesTotal})`, `[tabs] reached only ${reached} tab states (floor ${FLOORS.tabStatesTotal}) - the walk is no longer finding the controls`);
    check(T.states >= FLOORS.tabsMeasured, `[tabs] measured ${T.states} distinct tab states (floor ${FLOORS.tabsMeasured})`, `[tabs] measured only ${T.states} tab states (floor ${FLOORS.tabsMeasured})`);
    check(T.evaluated >= FLOORS.tabsTotal, `[tabs] evaluated ${T.evaluated} pieces of text (floor ${FLOORS.tabsTotal})`, `[tabs] only ${T.evaluated} pieces of text evaluated (floor ${FLOORS.tabsTotal})`);
    const perTheme = themes.map((t) => [t.id, T.byTheme[t.id] || 0]).sort((a, b) => a[1] - b[1])[0];
    check(perTheme[1] >= FLOORS.tabsPerTheme, `[tabs] every theme had at least ${FLOORS.tabsPerTheme} pieces of text evaluated (fewest: ${perTheme[0]} with ${perTheme[1]})`, `[tabs] ${perTheme[0]}: only ${perTheme[1]} pieces of text evaluated (floor ${FLOORS.tabsPerTheme})`);
    const thin = Object.entries(T.byLabel).sort((a, b) => a[1] - b[1])[0];
    if (thin) check(thin[1] >= FLOORS.tabStateMin, `[tabs] every measured tab state gave at least ${FLOORS.tabStateMin} pieces of text in every theme (thinnest ${thin[1]}: ${thin[0]})`, `[tabs] ${thin[0]} gave only ${thin[1]} pieces of text (floor ${FLOORS.tabStateMin}) - measured blank or half drawn`);
    check(T.placeholders >= FLOORS.placeholdersTabs, `[tabs] measured ${T.placeholders} placeholders (floor ${FLOORS.placeholdersTabs})`, `[tabs] only ${T.placeholders} placeholders measured (floor ${FLOORS.placeholdersTabs})`);
  }
}
if (RUN_TABS) {
  /* Per screen, in every run (a narrowed one too): a screen that has tabs must still show them to the walk, and no walk may be cut short by the cap. */
  for (const hash of Object.keys(tabInfo)) {
    const i = tabInfo[hash], f = TAB_FLOORS[hash];
    if (f !== undefined) check(i.visited >= f, `[tabs] ${hash}: ${i.visited} tab states reached (floor ${f})`, `[tabs] ${hash}: only ${i.visited} tab states reached (floor ${f}) - the walk lost this screen's controls`);
    check(!i.capped, `[tabs] ${hash}: the walk was not cut off by the per-screen cap (${TAB_CAP} states)`, `[tabs] ${hash}: more than ${TAB_CAP} tab states - raise TAB_CAP_PER_ROUTE on purpose, or the rest were never walked`);
  }
  for (const [hash, i] of Object.entries(tabInfo)) {
    if (i.skipped) console.log(`        ${hash}: not walked - ${i.skipped}`);
    if (i.risky.length || i.left.length) console.log(`        ${hash}: not pressed (would do more than switch a view): ${[...i.risky, ...i.left].slice(0, 8).join(" | ")}`);
  }
}

/* ---- what was not measured ---- */
{
  const lines = [];
  for (const [pass, s] of Object.entries(stats)) {
    const resolved = Object.entries(s.kinds).filter(([k]) => k.startsWith("resolved:")).reduce((a, [, n]) => a + n, 0);
    const unm = Object.entries(s.kinds).filter(([k]) => !k.startsWith("resolved:")).reduce((a, [, n]) => a + n, 0);
    const share = unm / Math.max(1, s.evaluated + unm);
    lines.push(`        [${pass}] ${s.evaluated} evaluated (${resolved} of them resolved by this sweep, ${s.placeholders} placeholders), ${unm} not measurable = ${(share * 100).toFixed(1)}% ` + JSON.stringify(Object.fromEntries(Object.entries(s.kinds).filter(([k]) => !k.startsWith("resolved:")))));
    /* Each kind of unmeasured text has its OWN cap: zero, except the three that cannot hide a failure (an icon glyph, an emoji,
       the text of an <svg> chart). A new kind, or any count of a kind that should be zero, fails the run and names a few examples. */
    for (const [k, n] of Object.entries(s.kinds)) {
      if (k.startsWith("resolved:")) continue;
      const cap = KIND_CAP[k] === undefined ? 0 : KIND_CAP[k];
      check(n <= cap, `[${pass}] ${k}: ${n} not measurable (at most ${cap === Infinity ? "any number" : cap})`, `[${pass}] ${n} node(s) of kind "${k}" could not be measured (at most ${cap}): ${(s.unmeasured[k] || []).join(" | ")}`);
    }
    check(share <= MAX_UNMEASURED_SHARE, `[${pass}] the share of text this sweep could not measure is ${(share * 100).toFixed(1)}% (at most ${MAX_UNMEASURED_SHARE * 100}%)`, `[${pass}] ${(share * 100).toFixed(1)}% of the text could not be measured (limit ${MAX_UNMEASURED_SHARE * 100}%)`);
  }
  console.log("      measured vs not measurable:");
  for (const l of lines) console.log(l);
  const seenKinds = new Set(Object.values(stats).flatMap((s) => Object.keys(s.kinds)).filter((k) => !k.startsWith("resolved:")));
  for (const k of seenKinds) console.log(`        - ${k}: ${KIND_POLICY[k] || "UNEXPLAINED kind: add it to KIND_POLICY (decide whether it can be measured)"}`);
  for (const k of seenKinds) if (!KIND_POLICY[k]) bad(`axe reported an incomplete kind "${k}" that KIND_POLICY does not explain - decide whether this sweep can measure it`);
}

/* ---- the misses ---- */
const rows = [...misses.values()].sort((a, b) => a.theme.localeCompare(b.theme) || a.route.localeCompare(b.route) || a.selector.localeCompare(b.selector));
const allowUsed = new Set();
const real = [];
const allowed = [];
for (const r of rows) {
  const a = ALLOWLIST.find((x) => x.theme === r.theme && x.route === r.route && x.selector === r.selector);
  if (a) { allowUsed.add(a); allowed.push({ ...r, reason: a.reason }); } else real.push(r);
}
for (const a of ALLOWLIST) {
  if (!a.reason || String(a.reason).trim().length < 20) bad(`allowlist entry ${a.theme} ${a.route} ${a.selector} has no real reason`);
  if (!a.route || (a.route !== "welcome" && routes.indexOf(a.route) === -1)) bad(`allowlist entry ${a.theme} ${a.selector} names no real screen (route "${a.route}") - an entry is for ONE screen, never for a selector everywhere`);
  if (!allowUsed.has(a) && !PARTIAL) bad(`allowlist entry ${a.theme} ${a.route} ${a.selector} matches nothing any more - remove it`);
}
for (const r of allowed) console.log(`        ALLOWED  [${r.theme}] ${r.route} ${r.selector}  ${r.ratio}:1  - ${r.reason}`);

const byTheme = new Map();
for (const r of real) { if (!byTheme.has(r.theme)) byTheme.set(r.theme, []); byTheme.get(r.theme).push(r); }
for (const t of THEME_LIST) {
  const list = byTheme.get(t.id) || [];
  if (!list.length) { ok(`[${t.id}] no colour-contrast miss on any screen or state`); continue; }
  bad(`[${t.id}] ${list.reduce((n, r) => n + r.n, 0)} colour-contrast miss(es) in ${list.length} distinct place(s)`);
  for (const r of list.slice(0, 40)) {
    console.log(`        ${r.selector}  ${r.ratio}:1 (needs ${r.need})  ${r.fg} on ${r.bg}  x${r.n}  ${r.via}  "${r.text}"  in ${[...r.where].slice(0, 3).join(", ")}${r.where.size > 3 ? " +" + (r.where.size - 3) + " more" : ""}`);
  }
  if (list.length > 40) console.log(`        ... and ${list.length - 40} more (full list in the report file)`);
}

/* ---- the report, outside the repo ---- */
try {
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(), suite: SUITE, partial: PARTIAL, webDir: WEB_DIR, elapsedMs: elapsed,
    themes: themes.map((t) => t.id), routes, guestRoutes, guestSame, tabInfo,
    stats, harness: { ...harness, pageHeights: undefined, tallest: Math.max(0, ...harness.pageHeights) },
    misses: rows.map((r) => ({ ...r, where: [...r.where] })), allowed: allowed.map((r) => ({ ...r, where: [...r.where] })),
  }, null, 1));
  console.log(`      full report: ${REPORT_PATH}`);
} catch (e) {
  console.log(`      (could not write the report to ${REPORT_PATH}: ${e.message})`);
}
console.log(`      sweep took ${fmtS(elapsed)} on this machine (shared and busy: a timing, not a performance claim)`);
console.log(`      ${Object.values(stats).reduce((a, s) => a + s.combos, 0)} measurements: ${THEME_LIST.length} themes x (${statesOf("profile")} screens + ${statesOf("state")} interaction states + ${statesOf("guest")} guest screens + ${statesOf("welcome")} first-run screens + ${statesOf("tabs")} tab states)`);

await finish("CONTRAST-FULL");
