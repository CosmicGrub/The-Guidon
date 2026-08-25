/**
 * Intuitivism pass, Tier 1 nav mechanics: three new pieces of interactive
 * surface with no prior coverage.
 *   1. <600px flat bar curated to 4 primary routes + "More", opening the
 *      SAME grouped accordion the >=600px sidebar renders as a bottom-sheet
 *      drawer (renderGroupsInto - one render path, not a duplicate DOM
 *      structure that could drift from the sidebar).
 *   2. In-group dividers (Board Prep/Leadership/Career & Life) - pure
 *      visual chunking, reusing the same .nav-divider element already
 *      used between groups.
 *   3. Diagnostics/Author's own dedicated "Advanced" group (Tier 2, Part
 *      One - this suite originally covered Tier 1(d)'s in-place
 *      .nav-demoted dimming of the same pair within Account; superseded
 *      when the owner asked for the plan's own 7th-group fallback
 *      instead - see NAV_GROUPS in src/index.html for the full writeup).
 * Exercises the real drawer end-to-end (open, focus-trap, Escape, a route
 * click closing it and navigating for real, focus restore) rather than
 * just checking the curated button list exists.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

// ============================================================
// PART 1 — <600px flat bar + "More" drawer
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[<600px] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[<600px] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(700);

  const navState = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll(".nav > a[data-hash]"));
    const more = document.querySelector(".nav-more-btn");
    return {
      primaryHashes: buttons.map((b) => b.getAttribute("data-hash")),
      hasMore: !!more,
      moreText: more ? more.textContent.trim() : null,
      moreActive: more ? more.classList.contains("active") : null,
    };
  });
  navState.primaryHashes.length === 4
    ? ok(`<600px flat bar shows exactly 4 primary routes (${navState.primaryHashes.join(", ")})`)
    : bad(`<600px flat bar primary route count: ${navState.primaryHashes.length}, expected 4 (${JSON.stringify(navState.primaryHashes)})`);
  navState.hasMore ? ok('a "More" button renders alongside the 4 primaries') : bad('"More" button not found in the <600px flat bar');
  navState.moreActive === false ? ok('"More" is not active while on Home (one of the 4 primaries)') : bad("More active state on Home: " + navState.moreActive);

  // ---- open the drawer ----
  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);
  const drawerOpen = await page.evaluate(() => {
    const panel = document.querySelector(".nav-drawer");
    return {
      exists: !!panel,
      role: panel ? panel.getAttribute("role") : null,
      ariaModal: panel ? panel.getAttribute("aria-modal") : null,
      ariaLabel: panel ? panel.getAttribute("aria-label") : null,
      groupHeaders: panel ? Array.from(panel.querySelectorAll(".nav-group-header")).map((h) => h.textContent.trim()) : [],
      totalButtons: panel ? panel.querySelectorAll("a[data-hash]").length : 0,
      demoted: panel ? Array.from(panel.querySelectorAll(".nav-demoted")).map((b) => b.getAttribute("data-hash")) : [],
    };
  });
  drawerOpen.exists ? ok("clicking More opens the .nav-drawer panel") : bad(".nav-drawer did not appear after clicking More");
  drawerOpen.role === "dialog" && drawerOpen.ariaModal === "true"
    ? ok("drawer panel carries role=dialog aria-modal=true")
    : bad(`drawer panel role/aria-modal: ${drawerOpen.role}/${drawerOpen.ariaModal}`);
  drawerOpen.ariaLabel === "More sections" ? ok('drawer aria-label reads "More sections"') : bad("drawer aria-label: " + drawerOpen.ariaLabel);
  // Tier 2 (Part One): a genuine 7th group, "Advanced" (Author +
  // Diagnostics), replaces the old in-place .nav-demoted pair inside
  // Account - so 6 labeled headers now, not 5.
  JSON.stringify(drawerOpen.groupHeaders) === JSON.stringify(["Board Prep", "Study & Skills", "Leadership", "Career & Life", "Account", "Advanced"])
    ? ok("drawer renders all 6 labeled groups, same order as the sidebar")
    : bad("drawer group headers: " + JSON.stringify(drawerOpen.groupHeaders));
  // 34 as of the Data & Storage dashboard (#/storage, roadmap Tier 8) - was
  // 33 before that route existed.
  drawerOpen.totalButtons === 34
    ? ok("drawer renders all 34 non-hidden routes (same set the >=600px sidebar shows)")
    : bad("drawer route button count: " + drawerOpen.totalButtons + ", expected 34");
  drawerOpen.demoted.length === 0
    ? ok("drawer has no .nav-demoted items - Author/Diagnostics moved to their own real group instead of in-place dimming")
    : bad("drawer still has .nav-demoted items: " + JSON.stringify(drawerOpen.demoted));

  // ---- focus trap: opening moves focus inside the panel ----
  const focusedInPanel = await page.evaluate(() => {
    const panel = document.querySelector(".nav-drawer");
    return panel ? panel.contains(document.activeElement) : false;
  });
  focusedInPanel ? ok("opening the drawer moves keyboard focus inside the panel") : bad("focus is not inside the drawer panel after opening");

  // ---- Escape closes it and restores focus to the More button ----
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const afterEscape = await page.evaluate(() => ({
    drawerGone: !document.querySelector(".nav-drawer-back"),
    focusedIsMore: document.activeElement === document.querySelector(".nav-more-btn"),
  }));
  afterEscape.drawerGone ? ok("Escape closes the drawer") : bad("drawer still present after Escape");
  afterEscape.focusedIsMore ? ok("closing via Escape restores focus to the More button") : bad("focus was not restored to the More button after Escape");

  // ---- a real route click inside the drawer navigates AND closes it ----
  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);
  // #/progress lives in the "Account" group, which - same shared
  // navOpenGroups state the >=600px sidebar uses - starts collapsed here
  // (we're arriving from Home, not a route inside Account). A real
  // Soldier taps the group header open first; do the same rather than
  // reaching straight for a button that's currently clipped off by its
  // own collapsed .nav-group-body. Using #/progress specifically (not
  // #/settings, which the user picked as one of the 4 primaries) so this
  // stays a genuine non-primary route for the "More lights up" check below.
  await page.locator(".nav-drawer .nav-group-header", { hasText: /^Account$/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.nav-drawer a[data-hash="#/progress"]').click();
  await page.waitForTimeout(400);
  const afterNav = await page.evaluate(() => ({
    hash: location.hash,
    heading: (document.querySelector("#route h2") || {}).textContent,
    drawerGone: !document.querySelector(".nav-drawer-back"),
    moreActive: document.querySelector(".nav-more-btn").classList.contains("active"),
  }));
  afterNav.hash === "#/progress" && afterNav.heading === "Progress"
    ? ok("clicking a route inside the drawer navigates for real (#/progress renders)")
    : bad(`hash/heading after drawer nav click: ${afterNav.hash} / ${afterNav.heading}`);
  afterNav.drawerGone ? ok("the drawer closes itself once a route is chosen") : bad("drawer still present after choosing a route");
  afterNav.moreActive ? ok('"More" lights up now that the active route (#/progress) lives inside the drawer, not the 4 primaries') : bad("More button did not activate for a non-primary route");

  // ---- regression: the drawer's group-open state persists to the same
  // localStorage key the >=600px sidebar shares (guidon-nav-open-groups) -
  // Account was just expanded above and never explicitly closed, so it
  // should still be recorded open. ----
  const navGroupsAfterNav = await page.evaluate(() => localStorage.getItem("guidon-nav-open-groups") || "");
  navGroupsAfterNav.includes("account")
    ? ok('opening the "Account" group in the drawer persists to the shared guidon-nav-open-groups key')
    : bad("guidon-nav-open-groups after opening Account: " + navGroupsAfterNav);

  // ---- regression: re-opening the drawer while already on a drawer-only
  // route highlights the matching button, the same way the >=600px
  // sidebar already does - this used to be dead CSS (setActive() was
  // hardcoded to navEl, a different DOM subtree from the drawer's panel,
  // so the drawer's own current-route highlight never applied). ----
  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);
  const reopenedHighlight = await page.evaluate(() => {
    const btn = document.querySelector('.nav-drawer a[data-hash="#/progress"]');
    return btn ? { active: btn.classList.contains("active"), ariaCurrent: btn.getAttribute("aria-current") } : null;
  });
  reopenedHighlight && reopenedHighlight.active && reopenedHighlight.ariaCurrent === "page"
    ? ok("re-opening the drawer while on #/progress highlights the matching button (.active + aria-current)")
    : bad("drawer's #/progress button state on reopen: " + JSON.stringify(reopenedHighlight));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ---- a non-drawer navigation (not a drawer click) also closes it if left open ----
  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(400);
  const afterExternalNav = await page.evaluate(() => !document.querySelector(".nav-drawer-back"));
  afterExternalNav ? ok("an external navigation (not a drawer click) also closes an open drawer, not just leaves it stranded") : bad("drawer was left open after a non-drawer navigation");

  // ---- regression: a resize crossing the 600px breakpoint while the
  // drawer is open must close it too, not just leave it stranded, focus-
  // trapped, over the freshly-rendered >=600px sidebar underneath (a real
  // bug this suite did not originally catch - found by a later adversarial
  // audit and fixed by also calling closeNavDrawer() from the SIDEBAR_MQ
  // "change" listener, alongside the existing route()-driven close). ----
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(200);
  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const afterResize = await page.evaluate(() => {
    const back = document.querySelector(".nav-drawer-back");
    // #/home specifically: it's the one nav item NAV_GROUPS leaves
    // ungrouped (label:null), so it's always rendered directly, never
    // inside a collapsible .nav-group-body that might legitimately be
    // closed (we never navigated to a grouped route in this test, so
    // e.g. "Board Prep" - #/train's own group - was never auto-opened,
    // which would make #/train collapsed/off-position for reasons that
    // have nothing to do with the stale-drawer bug this checks for).
    const homeBtn = document.querySelector('.nav a[data-hash="#/home"]');
    let hitsButton = false;
    if (homeBtn) {
      const r = homeBtn.getBoundingClientRect();
      hitsButton = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === homeBtn;
    }
    return { drawerGone: !back, sidebarClickable: hitsButton };
  });
  afterResize.drawerGone ? ok("a resize crossing the 600px breakpoint while the drawer is open closes it") : bad("drawer was still present after a breakpoint-crossing resize");
  afterResize.sidebarClickable ? ok("the >=600px sidebar underneath is genuinely clickable after the resize, not covered by a stale drawer backdrop") : bad("the sidebar's #/home button is not the topmost element at its own coordinates after the resize");

  await page.close();
}

// ============================================================
// PART 2 — >=600px sidebar: in-group dividers + the "Advanced" group
// (Tier 2, Part One - Author/Diagnostics's own real 7th group, replacing
// the old in-place .nav-demoted dimming this Part used to cover)
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[sidebar] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[sidebar] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(700);

  const sidebar = await page.evaluate(() => ({
    totalButtons: document.querySelectorAll(".nav a[data-hash]").length,
    dividerCount: document.querySelectorAll(".nav .nav-divider").length,
    groupHeaders: Array.from(document.querySelectorAll(".nav .nav-group-header")).map((h) => h.textContent.trim()),
    demoted: Array.from(document.querySelectorAll(".nav .nav-demoted")).map((b) => b.getAttribute("data-hash")),
    hasMoreBtn: !!document.querySelector(".nav-more-btn"),
    accountOrder: Array.from(document.querySelectorAll(".nav-group-body a[data-hash]"))
      .map((b) => b.getAttribute("data-hash"))
      .filter((h) => ["#/progress", "#/currency", "#/settings", "#/share"].includes(h)),
  }));
  // 34 as of the Data & Storage dashboard (#/storage) - see the drawer
  // assertion above for the same count and its own provenance note.
  sidebar.totalButtons === 34 ? ok("sidebar renders all 34 non-hidden routes") : bad("sidebar route button count: " + sidebar.totalButtons + ", expected 34");
  sidebar.hasMoreBtn === false ? ok("no More button at >=600px - the sidebar shows everything directly") : bad("unexpected More button in the sidebar");
  // 6 labeled groups now (Board Prep/Study & Skills/Leadership/Career &
  // Life/Account/Advanced) = 6 between-group dividers, + 3 in-group
  // subdividers (Board Prep/Leadership/Career & Life only - Account lost
  // its subdivideAfter along with the demoted pair it used to separate,
  // and the new Advanced group is too short to need one). Same total (9)
  // as the old 5+4 split, different composition - spelled out here so a
  // future count change doesn't get "fixed" by cancelling out two
  // unrelated regressions.
  sidebar.dividerCount === 9
    ? ok("sidebar renders 9 dividers total (6 between-group + 3 in-group sub-dividers)")
    : bad("sidebar divider count: " + sidebar.dividerCount + ", expected 9");
  JSON.stringify(sidebar.groupHeaders) === JSON.stringify(["Board Prep", "Study & Skills", "Leadership", "Career & Life", "Account", "Advanced"])
    ? ok("sidebar renders 6 labeled group headers, Advanced last")
    : bad("sidebar group headers: " + JSON.stringify(sidebar.groupHeaders));
  sidebar.demoted.length === 0
    ? ok("no .nav-demoted item exists anywhere in the sidebar - Author/Diagnostics moved to a real group instead")
    : bad("sidebar still has .nav-demoted items: " + JSON.stringify(sidebar.demoted));
  JSON.stringify(sidebar.accountOrder) === JSON.stringify(["#/progress", "#/currency", "#/settings", "#/share"])
    ? ok("Account's own remaining 4 items (Progress/Freshness/Settings/Share & Install) are unaffected, in their original order")
    : bad("Account group order: " + JSON.stringify(sidebar.accountOrder));

  // ---- the "Advanced" group itself: real label, real members, real
  // hrefs, no leftover demoted styling now that it's a genuine group. ----
  const advancedHeader = page.locator(".nav .nav-group-header", { hasText: /^Advanced$/ });
  (await advancedHeader.count()) === 1 ? ok('exactly one "Advanced" group header renders in the sidebar') : bad('"Advanced" group header count: ' + (await advancedHeader.count()));
  await advancedHeader.click();
  await page.waitForTimeout(250);
  const advanced = await page.evaluate(() => {
    const header = Array.from(document.querySelectorAll(".nav .nav-group-header")).find((h) => h.textContent.trim() === "Advanced");
    const body = header ? header.nextElementSibling : null;
    const items = body ? Array.from(body.querySelectorAll("a[data-hash]")) : [];
    return {
      expanded: header ? header.getAttribute("aria-expanded") : null,
      hashes: items.map((b) => b.getAttribute("data-hash")),
      hrefsMatch: items.every((b) => b.getAttribute("href") === b.getAttribute("data-hash")),
      anyDemoted: items.some((b) => b.classList.contains("nav-demoted")),
      opacities: items.map((b) => getComputedStyle(b).opacity),
    };
  });
  advanced.expanded === "true" ? ok('clicking the "Advanced" header opens it') : bad('"Advanced" header aria-expanded after click: ' + advanced.expanded);
  // #/storage (Data & Storage dashboard) added to this group alongside
  // Author/Diagnostics - same "power-user/infrequent controls, one tap
  // away" rationale the group's own header comment in src/index.html gives
  // for Author/Diagnostics.
  JSON.stringify(advanced.hashes) === JSON.stringify(["#/author", "#/selftest", "#/storage"])
    ? ok('"Advanced" contains exactly Author, Diagnostics and Data & Storage, in that order')
    : bad('"Advanced" group members: ' + JSON.stringify(advanced.hashes));
  advanced.hrefsMatch ? ok('"Advanced" members are real <a href> links resolving to their own hash') : bad('"Advanced" member href mismatch: ' + JSON.stringify(advanced));
  advanced.anyDemoted ? bad('"Advanced" members still carry .nav-demoted - should render like any other group\'s members') : ok('"Advanced" members carry no .nav-demoted class');
  advanced.opacities.every((o) => parseFloat(o) === 1)
    ? ok(`"Advanced" members render at full opacity (${advanced.opacities.join(", ")}), not the old .82 demoted dimming`)
    : bad('"Advanced" member opacities: ' + JSON.stringify(advanced.opacities) + ", expected all 1");

  // ---- regression: the sidebar's own .nav-group-header toggle - covered
  // nowhere in this suite before (Part 1 only ever clicks the DRAWER's
  // copy) - actually flips state and persists to the same shared
  // guidon-nav-open-groups key the drawer reads/writes. ----
  const studyHeader = page.locator(".nav .nav-group-header", { hasText: /^Study & Skills$/ });
  const beforeToggle = await studyHeader.getAttribute("aria-expanded");
  await studyHeader.click();
  await page.waitForTimeout(250);
  const afterToggle = await studyHeader.getAttribute("aria-expanded");
  beforeToggle !== afterToggle
    ? ok(`sidebar's "Study & Skills" group header toggles aria-expanded (${beforeToggle} -> ${afterToggle})`)
    : bad(`sidebar group header aria-expanded did not change: ${beforeToggle} -> ${afterToggle}`);
  const persistedKey = await page.evaluate(() => localStorage.getItem("guidon-nav-open-groups") || "");
  const nowOpen = afterToggle === "true";
  (nowOpen ? persistedKey.includes("study") : !persistedKey.includes("study"))
    ? ok(`sidebar group toggle persists to the shared guidon-nav-open-groups key (now ${nowOpen ? "includes" : "excludes"} "study")`)
    : bad(`guidon-nav-open-groups after sidebar toggle: ${persistedKey} (group now ${nowOpen ? "open" : "closed"})`);

  // ---- same open/closed persistence check, but for the NEW "advanced"
  // group specifically - it was opened above (the click that expanded it
  // to inspect its members); confirm that stuck to the shared key exactly
  // like every pre-existing group already does, rather than assuming a
  // brand-new NAV_GROUPS entry "just works" because it reuses shared code. ----
  persistedKey.includes("advanced")
    ? ok('opening the "Advanced" group persists to the shared guidon-nav-open-groups key, same as every other group')
    : bad("guidon-nav-open-groups after opening Advanced: " + persistedKey);

  await page.close();
}

noise.length === 0 ? ok("no console errors/warnings across both viewport passes") : bad(noise.length + " console msg(s); first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `NAV TIER 1: ${fails} FAILURE(S)` : "NAV TIER 1: all passed"));
process.exit(fails ? 1 : 0);
