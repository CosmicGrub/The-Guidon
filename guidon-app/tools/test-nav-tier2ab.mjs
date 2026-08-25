/**
 * PC/desktop intuitivism pass, Tier 2(a)+2(b): the sidebar/drawer nav
 * rendering combined into one diff (both touch navButton()/
 * renderGroupsInto(), see src/index.html) and so covered by one suite.
 *
 *   2(a) - every nav leaf item is now a real <a href> (navButton()), not a
 *   plain <button onclick>: real desktop link behavior (open in new tab,
 *   middle-click, Ctrl/Cmd+click, status-bar URL preview) that a <button>
 *   can never provide. onclick is unchanged in what it DOES, but now only
 *   preventDefault()s a plain unmodified left-click, so a modified click
 *   falls through to the browser's own native new-tab handling instead of
 *   being hijacked into a same-tab SPA hash-set.
 *
 *   2(b) - roving-tabindex arrow-key navigation (Up/Down/Home/End) for the
 *   sidebar's own vertical list (util.rovingList, a new role-agnostic
 *   primitive - NOT util.tabbarKeys' role="tablist" pattern, which would
 *   misdescribe a nav landmark to a screen reader). Group headers are part
 *   of the roving sequence; members of a COLLAPSED group are excluded from
 *   it (and from the Tab order entirely - tabIndex -1, not just visually
 *   hidden) until their header is expanded.
 *
 * Covers both call sites renderGroupsInto() feeds - the >=600px sidebar
 * (navEl) and the <600px "More" drawer - since both share the exact same
 * DOM shape and are meant to behave identically.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

async function pastOnboarding(page) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(700);
}

// Focused element's identity, for asserting roving sequences.
async function focusedId(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    return a.getAttribute("data-hash") || (a.classList.contains("nav-group-header") ? a.textContent.trim() : null);
  });
}

// ============================================================
// PART 1 — >=600px sidebar
// ============================================================
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[sidebar] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[sidebar] pageerror: " + e.message));
  await pastOnboarding(page);

  // ---- 2(a): DOM contract - every leaf item is a real <a href> whose
  // href resolves to its own data-hash. 34 is the same non-hidden route
  // count test-nav-tier1.mjs already established for this sidebar (was 33
  // before the Data & Storage dashboard, #/storage, added a route). ----
  const leafContract = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll(".nav a[data-hash]"));
    return {
      total: els.length,
      allAnchors: els.every((e) => e.tagName === "A"),
      hrefMismatches: els.filter((e) => e.getAttribute("href") !== e.getAttribute("data-hash")).map((e) => e.getAttribute("data-hash")),
      headersStillButtons: Array.from(document.querySelectorAll(".nav .nav-group-header")).every((e) => e.tagName === "BUTTON"),
    };
  });
  leafContract.total === 34 ? ok("sidebar still renders all 34 non-hidden routes as leaf items") : bad("sidebar leaf item count: " + leafContract.total + ", expected 34");
  leafContract.allAnchors ? ok("every sidebar leaf item is a real <a> element") : bad("some sidebar leaf items are not <a> elements");
  leafContract.hrefMismatches.length === 0
    ? ok("every sidebar leaf item's href resolves to its own #/... hash")
    : bad("sidebar leaf items with href != data-hash: " + JSON.stringify(leafContract.hrefMismatches));
  leafContract.headersStillButtons ? ok("group headers are still real <button> elements (unchanged by Tier 2(a))") : bad("a group header is no longer a <button>");

  // ---- 2(a): a plain left-click still drives real SPA navigation, no new
  // tab opened - the preventDefault() guard only fires for an unmodified
  // click, but it MUST fire for one. #/records lives in "Board Prep",
  // which is open by default on a genuine first desktop visit at
  // >=1200px (Tier 1(f)), so no group-header click is needed first. ----
  const pagesBefore = context.pages().length;
  await page.locator('.nav a[data-hash="#/records"]').click();
  await page.waitForTimeout(400);
  const afterPlainClick = await page.evaluate(() => ({
    hash: location.hash,
    heading: (document.querySelector("#route h2") || {}).textContent,
  }));
  afterPlainClick.hash === "#/records" && /records/i.test(afterPlainClick.heading || "")
    ? ok("a plain left-click on a sidebar <a> still navigates for real (#/records renders)")
    : bad(`hash/heading after plain left-click: ${afterPlainClick.hash} / ${afterPlainClick.heading}`);
  context.pages().length === pagesBefore ? ok("a plain left-click does not open a new tab") : bad("a plain left-click unexpectedly opened a new tab");

  // ---- 2(a): a Ctrl+click (Cmd+click surrogate) is NOT hijacked into a
  // same-tab SPA nav - it opens a real new background tab at the right
  // route, and the CURRENT tab's hash is untouched. This is the actual
  // behavioral promise Tier 2(a) exists for; a real trusted Playwright
  // click with a modifier held triggers genuine browser new-tab handling
  // (synthetic dispatchEvent()-based clicks do not), so this is a real
  // check, not a DOM-attribute proxy for one. #/doctrine (Board Prep,
  // already open at this viewport) rather than a collapsed-group item -
  // Playwright's actionability check needs a genuinely visible target,
  // and a collapsed .nav-group-body's children are 0-height/overflow-
  // hidden, not just "not yet clicked open". ----
  {
    const hashBefore = await page.evaluate(() => location.hash);
    const newPagePromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await page.locator('.nav a[data-hash="#/doctrine"]').click({ modifiers: ["Control"] });
    const newPage = await newPagePromise;
    if (newPage) {
      await newPage.waitForLoadState("load").catch(() => {});
      const hashAfter = await page.evaluate(() => location.hash);
      newPage.url().endsWith("#/doctrine") ? ok("Ctrl+click on a sidebar item opens a real new tab at the right route") : bad("Ctrl+click new tab URL: " + newPage.url());
      hashAfter === hashBefore ? ok("Ctrl+click leaves the original tab's route untouched") : bad(`Ctrl+click changed the original tab's hash: ${hashBefore} -> ${hashAfter}`);
      await newPage.close();
    } else {
      bad("Ctrl+click on a sidebar item did not open a new tab");
    }
  }

  // ---- 2(a): middle-click (button:'middle') fires "auxclick", not
  // "click" - navButton()'s onclick never runs, so it opens a new tab
  // purely via the browser's own native href handling, with zero extra
  // code. Same real-trusted-click reasoning as the Ctrl+click check. ----
  {
    const hashBefore = await page.evaluate(() => location.hash);
    const newPagePromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await page.locator('.nav a[data-hash="#/calendar"]').click({ button: "middle" });
    const newPage = await newPagePromise;
    if (newPage) {
      await newPage.waitForLoadState("load").catch(() => {});
      const hashAfter = await page.evaluate(() => location.hash);
      newPage.url().endsWith("#/calendar") ? ok("middle-click on a sidebar item opens a real new tab at the right route") : bad("middle-click new tab URL: " + newPage.url());
      hashAfter === hashBefore ? ok("middle-click leaves the original tab's route untouched") : bad(`middle-click changed the original tab's hash: ${hashBefore} -> ${hashAfter}`);
      await newPage.close();
    } else {
      bad("middle-click on a sidebar item did not open a new tab");
    }
  }

  // ---- 2(b): at rest, exactly one item (headers + leaves together) holds
  // tabIndex 0 - the current route (#/records, just navigated to above) -
  // and it's a real Tab stop; everything else, INCLUDING every header, is
  // -1. This is the core roving-tabindex contract: one Tab stop into the
  // whole list, not up to 38. ----
  const rovingRest = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll(".nav .nav-group-header, .nav a[data-hash]"));
    const zeroed = all.filter((e) => e.tabIndex === 0);
    return {
      total: all.length,
      zeroedCount: zeroed.length,
      zeroedHash: zeroed[0] ? zeroed[0].getAttribute("data-hash") : null,
      zeroedAriaCurrent: zeroed[0] ? zeroed[0].getAttribute("aria-current") : null,
    };
  });
  rovingRest.zeroedCount === 1 ? ok("exactly one sidebar item holds tabIndex 0 at rest") : bad("sidebar items with tabIndex 0: " + rovingRest.zeroedCount + ", expected 1");
  rovingRest.zeroedHash === "#/records" && rovingRest.zeroedAriaCurrent === "page"
    ? ok("the tabIndex-0 item is the current route (#/records), matching aria-current")
    : bad(`tabIndex-0 item: hash=${rovingRest.zeroedHash} aria-current=${rovingRest.zeroedAriaCurrent}, expected #/records/page`);

  // ---- 2(b): a collapsed group's members are excluded from Tab order
  // entirely (tabIndex -1), not just visually hidden. "Study & Skills" is
  // guaranteed collapsed here (only "Board Prep" auto-opens at this
  // viewport - Tier 1(f)). ----
  const collapsedTabIndex = await page.evaluate(() => {
    const el = document.querySelector('.nav a[data-hash="#/learn"]');
    return el ? el.tabIndex : null;
  });
  collapsedTabIndex === -1
    ? ok("a member of a collapsed group (#/learn, in the collapsed 'Study & Skills') has tabIndex -1")
    : bad("collapsed group member #/learn tabIndex: " + collapsedTabIndex + ", expected -1");

  // ---- 2(b): ArrowDown roves through VISIBLE items in document order,
  // stepping onto group headers, and SKIPPING every member of a collapsed
  // group entirely - not stopping on them, not even briefly. Focus starts
  // on the current tabIndex-0 item (#/records) and walks the known-open
  // "Board Prep" sequence, then must land on the "Study & Skills" HEADER
  // next (skipping over #/learn/#/forms/#/write/#/counsel, all collapsed),
  // not on any of that group's hidden members. ----
  await page.locator('.nav a[data-hash="#/records"]').focus();
  const downSequence = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowDown");
    downSequence.push(await focusedId(page));
  }
  // From #/records (Board Prep: train, board, records, calendar, doctrine,
  // dictionary, library): +1 -> calendar, +2 -> doctrine, +3 -> dictionary.
  JSON.stringify(downSequence) === JSON.stringify(["#/calendar", "#/doctrine", "#/dictionary"])
    ? ok("ArrowDown roves forward through the open 'Board Prep' group in order")
    : bad("ArrowDown sequence from #/records (x3): " + JSON.stringify(downSequence));
  await page.keyboard.press("ArrowDown"); // -> library (last of Board Prep)
  await page.keyboard.press("ArrowDown"); // -> Study & Skills header (skips its collapsed members entirely)
  const afterSkip = await focusedId(page);
  afterSkip === "Study & Skills"
    ? ok("ArrowDown past the last item of an open group lands on the NEXT header, skipping every member of the following collapsed group")
    : bad("focus after arrowing past 'Board Prep': " + afterSkip + ", expected 'Study & Skills' header");

  // ---- 2(b): Home/End jump to the first/last VISIBLE item, not the
  // first/last item in the DOM (which would include collapsed members).
  // Last visible here is the "Advanced" header - the last group in
  // NAV_GROUPS as of Tier 2 (Part One), which appended a real 7th group
  // (Author/Diagnostics) after "account" rather than demoting them inside
  // it - itself collapsed (all its members invisible), so the header is
  // the final roving stop. ----
  await page.keyboard.press("End");
  const atEnd = await focusedId(page);
  atEnd === "Advanced" ? ok("End jumps to the last VISIBLE item ('Advanced' header, its members all collapsed)") : bad("focus after End: " + atEnd + ", expected 'Advanced' header");
  await page.keyboard.press("Home");
  const atHome = await focusedId(page);
  atHome === "#/home" ? ok("Home jumps to the first VISIBLE item (#/home)") : bad("focus after Home: " + atHome + ", expected #/home");

  // ---- 2(b): a group header's own Enter activates it NATIVELY (no extra
  // JS needed - it's a real <button>) and the roving set updates live:
  // arrowing past the just-opened header must now land on its first
  // member instead of skipping straight to the next header. ----
  await page.locator(".nav .nav-group-header", { hasText: /^Study & Skills$/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  const expandedNow = await page.locator(".nav .nav-group-header", { hasText: /^Study & Skills$/ }).getAttribute("aria-expanded");
  expandedNow === "true" ? ok("Enter on a focused group header toggles it open (native <button> activation)") : bad("Study & Skills aria-expanded after Enter: " + expandedNow);
  await page.keyboard.press("ArrowDown");
  const afterExpandArrow = await focusedId(page);
  afterExpandArrow === "#/learn"
    ? ok("ArrowDown after expanding reaches the group's own first member (#/learn) - the roving set updated live")
    : bad("focus after ArrowDown past the just-expanded header: " + afterExpandArrow + ", expected #/learn");
  const learnTabIndexNow = await page.evaluate(() => {
    const e = document.querySelector('.nav a[data-hash="#/learn"]');
    return e ? e.tabIndex : null;
  });
  learnTabIndexNow === 0 ? ok("#/learn's tabIndex is live-updated to 0 once its group is expanded and arrowed onto") : bad("#/learn tabIndex after expand+arrow: " + learnTabIndexNow);

  await page.close();
}

// ============================================================
// PART 2 — <600px "More" drawer (renders through the SAME
// renderGroupsInto() as the sidebar - same shape, same expected behavior)
// ============================================================
{
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[drawer] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[drawer] pageerror: " + e.message));
  await pastOnboarding(page);

  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);

  // ---- 2(a): same DOM contract inside the drawer. ----
  const drawerContract = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll(".nav-drawer a[data-hash]"));
    return {
      total: els.length,
      allAnchors: els.every((e) => e.tagName === "A"),
      hrefMismatches: els.filter((e) => e.getAttribute("href") !== e.getAttribute("data-hash")).map((e) => e.getAttribute("data-hash")),
    };
  });
  drawerContract.total === 34 ? ok("drawer still renders all 34 non-hidden routes as leaf items") : bad("drawer leaf item count: " + drawerContract.total + ", expected 34");
  drawerContract.allAnchors ? ok("every drawer leaf item is a real <a> element") : bad("some drawer leaf items are not <a> elements");
  drawerContract.hrefMismatches.length === 0
    ? ok("every drawer leaf item's href resolves to its own #/... hash")
    : bad("drawer leaf items with href != data-hash: " + JSON.stringify(drawerContract.hrefMismatches));

  // ---- 2(b): roving works the same way inside the drawer. Nothing is
  // auto-opened at this viewport (Tier 1(f)'s desktop default is
  // >=1200px only), so EVERY labeled group starts collapsed and the
  // roving set at rest is just #/home + the 5 group headers. ----
  const drawerRest = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll(".nav-drawer .nav-group-header, .nav-drawer a[data-hash]"));
    const zeroed = all.filter((e) => e.tabIndex === 0);
    return { zeroedCount: zeroed.length, zeroedHash: zeroed[0] ? zeroed[0].getAttribute("data-hash") : null };
  });
  drawerRest.zeroedCount === 1 && drawerRest.zeroedHash === "#/home"
    ? ok("drawer: exactly one tabIndex-0 item at rest, the current route (#/home)")
    : bad(`drawer roving-at-rest: count=${drawerRest.zeroedCount} hash=${drawerRest.zeroedHash}, expected 1/#/home`);

  await page.locator('.nav-drawer a[data-hash="#/home"]').focus();
  await page.keyboard.press("ArrowDown");
  const drawerAfterFirstDown = await focusedId(page);
  drawerAfterFirstDown === "Board Prep"
    ? ok("drawer: ArrowDown from #/home lands on the first group header ('Board Prep')")
    : bad("drawer: focus after first ArrowDown: " + drawerAfterFirstDown);
  await page.keyboard.press("ArrowDown");
  const drawerAfterSecondDown = await focusedId(page);
  drawerAfterSecondDown === "Study & Skills"
    ? ok("drawer: ArrowDown past a collapsed group's header lands on the NEXT header, skipping all its (invisible) members")
    : bad("drawer: focus after second ArrowDown: " + drawerAfterSecondDown + ", expected 'Study & Skills' header");

  await page.keyboard.press("End");
  const drawerAtEnd = await focusedId(page);
  drawerAtEnd === "Advanced" ? ok("drawer: End jumps to the last VISIBLE item ('Advanced' header)") : bad("drawer: focus after End: " + drawerAtEnd);

  // ---- 2(b): Enter on a header opens it and live-updates the drawer's
  // own roving set, same as the sidebar. ----
  await page.locator(".nav-drawer .nav-group-header", { hasText: /^Account$/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  const drawerAfterExpandArrow = await focusedId(page);
  drawerAfterExpandArrow === "#/progress"
    ? ok("drawer: ArrowDown after expanding 'Account' reaches its first member (#/progress) live")
    : bad("drawer: focus after expand+ArrowDown: " + drawerAfterExpandArrow + ", expected #/progress");

  await page.close();
}

noise.length === 0 ? ok("no console errors/warnings across both viewport passes") : bad(noise.length + " console msg(s); first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `NAV TIER 2(a)+2(b): ${fails} FAILURE(S)` : "NAV TIER 2(a)+2(b): all passed"));
process.exit(fails ? 1 : 0);
