/**
 * Roadmap Tier 5 ("Optional" tier — BLC/ALC/SLC Prep, mild width-waste
 * finding): all three modules share one render shape — a self-check
 * checklist plus a stack of accordion .panel SECTIONS whose body/points
 * are long-form prose, not tabular data — inside .view, which is sized for
 * cards/records (900/960/1200px across its own existing breakpoints), not
 * running text. Verified live before this fix (see the roadmap task's own
 * exploration, not re-duplicated here): at a real 1440px viewport, SECTIONS
 * body text (.hint) wrapped at up to 1120px-wide lines and .points bullets
 * (li) at up to 1028px wide — both roughly double a comfortable reading
 * measure. The self-check <label> rows were already fine (flex-row
 * children shrink to content, not the panel's full width) except for one
 * long outlier per module.
 *
 * Fix: blc.js/alc.js/slc.js's render() now tags the fresh per-route mount
 * frame with its own -view class (.blc-view/.alc-view/.slc-view), and a
 * matching CSS rule caps p.hint/li/label text at max-width:70ch inside it —
 * the same measure html.dyslexia-spacing already uses elsewhere in this
 * file. No new media query: max-width only ever clamps a box already wider
 * than 70ch, so it is a structural no-op on any viewport where .view itself
 * is already narrower than that (every phone-width layout) and only
 * changes anything at the desktop/tablet widths where the real problem
 * lived — this test proves both halves of that claim with real measured
 * geometry, not just that nothing throws.
 *
 * Also confirms the fix touched nothing behavioral: the self-check
 * checkbox still toggles, persists across a reload, and still drives the
 * progress stat/bar text, and the accordion SECTIONS still open/close —
 * all exercised post-fix, at the same wide viewport the CSS change targets.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

const ROUTES = [
  { hash: "#/blc", viewClass: "blc-view", key: "guidon:blc:checks:v1" },
  { hash: "#/alc", viewClass: "alc-view", key: "guidon:alc:checks:v1" },
  { hash: "#/slc", viewClass: "slc-view", key: "guidon:slc:checks:v1" },
];

async function newPageWithProfile(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(600);
  // Seed a completed personal profile directly (same pattern as
  // test-board-date-stale.mjs / test-career.mjs) so every route is reachable
  // immediately, with no onboarding wizard in the way of the routes under test.
  await page.evaluate(async () => {
    await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
      onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT", lastName: "READER",
    } });
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(600);
  return { ctx, page, noise };
}

// Measures the widest .panel p.hint / .panel li / checklist <label>, PLUS the
// live computed max-width the CSS rule actually resolved to (proves the rule
// is genuinely engaged, not just "happens to look narrow" for other reasons).
async function measure(page, viewClass) {
  return page.evaluate((cls) => {
    const view = document.querySelector(".view");
    // The scoping class lands on the ROUTER'S PER-ROUTE FRAME (the plain
    // <div> app.js's route() creates fresh and passes to render() as
    // `mount` - see app.js's `const frame = el("div"); routeEl.appendChild
    // (frame); r.render(frame)`), which is a child of `.view#route`, not
    // `.view` itself. Look for the class anywhere under .view rather than
    // on .view's own className.
    const scoped = document.querySelector("." + cls);
    const hints = Array.from(document.querySelectorAll(".panel p.hint"));
    const lis = Array.from(document.querySelectorAll(".panel li"));
    const labels = Array.from(document.querySelectorAll("label"));
    const widest = (nodes) => nodes.reduce((m, n) => Math.max(m, n.getBoundingClientRect().width), 0);
    const computedMaxWidth = (nodes) => nodes.length ? getComputedStyle(nodes[0]).maxWidth : null;
    return {
      hasScopeClass: !!scoped && !!view && view.contains(scoped),
      viewWidth: view ? Math.round(view.getBoundingClientRect().width) : null,
      hintCount: hints.length, liCount: lis.length, labelCount: labels.length,
      maxHint: Math.round(widest(hints)),
      maxLi: Math.round(widest(lis)),
      maxLabel: Math.round(widest(labels)),
      hintComputedMaxWidth: computedMaxWidth(hints),
      liComputedMaxWidth: computedMaxWidth(lis),
    };
  }, viewClass);
}

// ============================================================================
// Part 1: WIDE viewport (1440px) — the cap must actually be engaged.
// ============================================================================
{
  const { ctx, page, noise } = await newPageWithProfile({ width: 1440, height: 900 });

  for (const r of ROUTES) {
    await page.goto(url + r.hash, { waitUntil: "load" });
    await page.waitForTimeout(400);
    // Open the first accordion SECTION so its .hint/li text is actually in
    // the DOM with real layout (SECTIONS start collapsed - display:none).
    const header = page.locator(".panel button[aria-expanded]").first();
    await header.waitFor({ state: "visible", timeout: 5000 });
    await header.click();
    await page.waitForTimeout(150);

    const m = await measure(page, r.viewClass);

    m.hasScopeClass
      ? ok(`${r.hash}: the ${r.viewClass} scoping class is present inside .view`)
      : bad(`${r.hash}: no element carrying .${r.viewClass} found inside .view`);

    (m.hintCount > 0 && m.liCount > 0 && m.labelCount > 0)
      ? ok(`${r.hash}: real content present (${m.hintCount} hint(s), ${m.liCount} li(s), ${m.labelCount} label(s))`)
      : bad(`${r.hash}: expected real .hint/li/label content, got hintCount=${m.hintCount} liCount=${m.liCount} labelCount=${m.labelCount}`);

    // .view itself is still wide (confirms this is a real desktop layout,
    // not an accidental narrow render that would make the cap meaningless).
    (m.viewWidth != null && m.viewWidth > 900)
      ? ok(`${r.hash}: .view is a real wide-desktop width (${m.viewWidth}px)`)
      : bad(`${r.hash}: .view width unexpectedly narrow at 1440px viewport: ${m.viewWidth}px`);

    // The rule resolved to a real px clamp, not "none" — proves the CSS
    // selector actually matched (not silently inert from a typo/specificity
    // miss) rather than the measured narrowness being coincidental.
    const hintClamped = m.hintComputedMaxWidth && m.hintComputedMaxWidth !== "none";
    hintClamped
      ? ok(`${r.hash}: .panel p.hint's computed max-width is a real clamp (${m.hintComputedMaxWidth}), not "none"`)
      : bad(`${r.hash}: .panel p.hint's computed max-width is "${m.hintComputedMaxWidth}" — the 70ch rule did not engage`);
    const liClamped = m.liComputedMaxWidth && m.liComputedMaxWidth !== "none";
    liClamped
      ? ok(`${r.hash}: .panel li's computed max-width is a real clamp (${m.liComputedMaxWidth}), not "none"`)
      : bad(`${r.hash}: .panel li's computed max-width is "${m.liComputedMaxWidth}" — the 70ch rule did not engage`);

    // The real, rendered text now measures well under the pre-fix ~1000-
    // 1120px lines (see this file's header comment), and strictly under
    // .view's own width — proving the cap is actually constraining layout,
    // not just present-but-overridden by something wider downstream.
    (m.maxHint > 0 && m.maxHint < 700 && m.maxHint < m.viewWidth)
      ? ok(`${r.hash}: widest .panel p.hint now renders at ${m.maxHint}px (was ~1054-1120px before this fix)`)
      : bad(`${r.hash}: widest .panel p.hint renders at ${m.maxHint}px — expected a real width under 700px and under .view's own ${m.viewWidth}px`);
    (m.maxLi > 0 && m.maxLi < 700 && m.maxLi < m.viewWidth)
      ? ok(`${r.hash}: widest .panel li now renders at ${m.maxLi}px (was ~1028px before this fix)`)
      : bad(`${r.hash}: widest .panel li renders at ${m.maxLi}px — expected a real width under 700px and under .view's own ${m.viewWidth}px`);
    (m.maxLabel > 0 && m.maxLabel < 700)
      ? ok(`${r.hash}: widest self-check label renders at ${m.maxLabel}px`)
      : bad(`${r.hash}: widest self-check label renders at ${m.maxLabel}px — expected under 700px`);
  }

  noise.length === 0
    ? ok("wide viewport: no console errors/pageerrors across all three routes")
    : bad("wide viewport: console noise — " + noise.slice(0, 3).join(" | "));

  await ctx.close();
}

// ============================================================================
// Part 2: NARROW viewport (375px) — same fix must be a structural no-op:
// no artificial extra-narrow clipping, single-column layout unchanged.
// ============================================================================
{
  const { ctx, page, noise } = await newPageWithProfile({ width: 375, height: 812 });

  for (const r of ROUTES) {
    await page.goto(url + r.hash, { waitUntil: "load" });
    await page.waitForTimeout(400);
    const header = page.locator(".panel button[aria-expanded]").first();
    await header.waitFor({ state: "visible", timeout: 5000 });
    await header.click();
    await page.waitForTimeout(150);

    const m = await measure(page, r.viewClass);

    // At 375px, .view is necessarily well under 70ch — the cap must not be
    // the thing determining the rendered width here. Confirmed by checking
    // the resolved max-width (px) is LARGER than what actually rendered,
    // i.e. the box is limited by its narrow container, not by the 70ch cap.
    const hintCapPx = m.hintComputedMaxWidth ? parseFloat(m.hintComputedMaxWidth) : null;
    (hintCapPx != null && m.maxHint > 0 && m.maxHint < hintCapPx)
      ? ok(`${r.hash} @375px: .panel p.hint renders at ${m.maxHint}px, under its own ${Math.round(hintCapPx)}px 70ch cap — the container, not the cap, is what's narrow here`)
      : bad(`${r.hash} @375px: expected the rendered hint width (${m.maxHint}px) to sit under the resolved 70ch cap (${hintCapPx}px)`);

    (m.viewWidth != null && m.viewWidth <= 375)
      ? ok(`${r.hash} @375px: .view stays a real mobile single-column width (${m.viewWidth}px)`)
      : bad(`${r.hash} @375px: .view width unexpectedly wide: ${m.viewWidth}px`);
  }

  noise.length === 0
    ? ok("narrow viewport: no console errors/pageerrors across all three routes")
    : bad("narrow viewport: console noise — " + noise.slice(0, 3).join(" | "));

  await ctx.close();
}

// ============================================================================
// Part 3: interactivity is completely unchanged post-fix (checklist toggle +
// persistence + progress stat, and accordion open/close) at the wide
// viewport the CSS change actually targets.
// ============================================================================
{
  const { ctx, page } = await newPageWithProfile({ width: 1440, height: 900 });

  for (const r of ROUTES) {
    await page.goto(url + r.hash, { waitUntil: "load" });
    await page.waitForTimeout(400);

    // --- Accordion: first SECTION opens and closes on click. ---
    const header = page.locator(".panel button[aria-expanded]").first();
    await header.waitFor({ state: "visible", timeout: 5000 });
    const before = await header.getAttribute("aria-expanded");
    await header.click();
    await page.waitForTimeout(120);
    const afterOpen = await header.getAttribute("aria-expanded");
    (before === "false" && afterOpen === "true")
      ? ok(`${r.hash}: first SECTION accordion opens on click (aria-expanded false -> true)`)
      : bad(`${r.hash}: accordion open failed — aria-expanded went ${before} -> ${afterOpen}`);
    await header.click();
    await page.waitForTimeout(120);
    const afterClose = await header.getAttribute("aria-expanded");
    afterClose === "false"
      ? ok(`${r.hash}: same SECTION accordion closes again on a second click`)
      : bad(`${r.hash}: accordion close failed — aria-expanded is "${afterClose}", expected "false"`);

    // --- Checklist: first self-check box toggles, persists, and updates
    //     the "N / total" progress stat. ---
    const statBefore = await page.locator(".stat .v").first().textContent();
    const box = page.locator('input[type="checkbox"]').first();
    const wasChecked = await box.isChecked();
    await box.click();
    await page.waitForTimeout(150);
    const isChecked = await box.isChecked();
    (isChecked === !wasChecked)
      ? ok(`${r.hash}: first self-check box toggles on click (${wasChecked} -> ${isChecked})`)
      : bad(`${r.hash}: checkbox click did not toggle state (stayed ${wasChecked})`);
    const statAfter = await page.locator(".stat .v").first().textContent();
    (statAfter !== statBefore)
      ? ok(`${r.hash}: progress stat updates on toggle ("${statBefore}" -> "${statAfter}")`)
      : bad(`${r.hash}: progress stat did not update after toggling a checkbox (stayed "${statBefore}")`);

    // Reload and confirm the checked state persisted to IndexedDB (same
    // KEY each module's render() reads on boot) — proves the scoping-class
    // change to render() didn't disturb the existing save/restore path.
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(500);
    await page.evaluate((h) => { location.hash = h; }, r.hash);
    await page.waitForTimeout(400);
    const persisted = await page.locator('input[type="checkbox"]').first().isChecked();
    persisted === isChecked
      ? ok(`${r.hash}: checked state persisted across reload (still ${persisted})`)
      : bad(`${r.hash}: checked state did NOT persist across reload — expected ${isChecked}, got ${persisted}`);
  }

  await ctx.close();
}

console.log(fails === 0 ? "\nCHECKLIST READING WIDTH: all passed" : `\nCHECKLIST READING WIDTH: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
