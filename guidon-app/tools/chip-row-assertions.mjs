/**
 * Shared checks for a chip row that turns into a horizontal scroller at phone
 * width (Board Drill's three ".qf-row" quick-filter bars today; any future
 * chip row that opts into the same class). Not a suite - a helper a suite
 * imports, so it launches no browser of its own.
 *
 * Why this exists: the first phone-width assertion for these rows checked
 * "one row high, flex-wrap nowrap, no page overflow". Every one of those
 * holds for a row that merely CLIPS its chips (overflow-x:hidden) - the
 * chips past the right edge would be unreachable and the test stayed green.
 * It also said nothing about the keyboard focus ring, which the scroller was
 * cutting off along the whole top edge of every chip (a scroll container
 * clips at its padding box, and the ring is drawn OUTSIDE the chip).
 *
 * Everything here goes through real input - a real wheel gesture, real Tab
 * key presses - and reads real geometry/pixels back. Nothing is stubbed.
 *
 *   checkRowScrollsToEnd(page, selector, name)             -> [{ ok, msg }]
 *   checkFocusRingNeverClipped(page, selector, name, opts) -> [{ ok, msg }]
 *   checkRingPaints(page, selector, name)                  -> [{ ok, msg }]
 *   chipInsideRow(page, selector, chipSelector)            -> { inside, ... } | null
 *
 * The checks return result lines instead of printing, so the calling suite
 * keeps its own PASS/FAIL counter:
 *   for (const r of await checkRowScrollsToEnd(page, sel, "pillar")) (r.ok ? ok : bad)(r.msg);
 *
 * "Scrollport" below = the box a scroll container clips its content to: its
 * padding box minus any classic scrollbar (clientWidth/clientHeight already
 * leave the scrollbar out). Each in-page callback re-declares the tiny
 * `port()` helper because page.evaluate() ships one function at a time.
 */

/**
 * Is `chipSelector` (inside the row) fully inside the row's scrollport?
 * Used for "the chip a deep link made active is actually on screen".
 */
export function chipInsideRow(page, selector, chipSelector) {
  return page.evaluate(([sel, chipSel]) => {
    const port = (n) => { const r = n.getBoundingClientRect(); return { left: r.left + n.clientLeft, top: r.top + n.clientTop, right: r.left + n.clientLeft + n.clientWidth, bottom: r.top + n.clientTop + n.clientHeight }; };
    const bar = document.querySelector(sel);
    const chip = bar && bar.querySelector(chipSel);
    if (!bar || !chip) return null;
    const p = port(bar), c = chip.getBoundingClientRect();
    return { text: chip.textContent, scrollLeft: Math.round(bar.scrollLeft), inside: c.left >= p.left - 0.5 && c.right <= p.right + 0.5 && c.top >= p.top - 0.5 && c.bottom <= p.bottom + 0.5, chip: [c.left, c.right].map(Math.round), row: [p.left, p.right].map(Math.round) };
  }, [selector, chipSelector]);
}

/**
 * A row whose chips do not fit must be a real scroller, all the way to its
 * last chip - proved with a real wheel gesture, not by setting scrollLeft
 * (script can scroll an overflow:hidden box; a person cannot).
 */
export async function checkRowScrollsToEnd(page, selector, name) {
  const out = [];
  const before = await page.evaluate((sel) => {
    const bar = document.querySelector(sel);
    if (!bar) return null;
    bar.scrollLeft = 0;
    bar.scrollIntoView({ block: "center" });
    const r = bar.getBoundingClientRect();
    return { overflowX: getComputedStyle(bar).overflowX, scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, chips: bar.querySelectorAll(".search-chip").length, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, selector);
  if (!before) { out.push({ ok: false, msg: `${name} row not found (${selector})` }); return out; }
  if (before.scrollWidth <= before.clientWidth + 2) {
    out.push({ ok: true, msg: `${name} row: all ${before.chips} chips already fit (${before.scrollWidth}px in ${before.clientWidth}px) - nothing to scroll` });
    return out;
  }
  out.push(["auto", "scroll"].includes(before.overflowX)
    ? { ok: true, msg: `${name} row: its ${before.scrollWidth}px of chips overflow the ${before.clientWidth}px row and overflow-x is "${before.overflowX}" (a scroller, not a clipper)` }
    : { ok: false, msg: `${name} row: ${before.scrollWidth}px of chips in a ${before.clientWidth}px row, but overflow-x is "${before.overflowX}" - the chips past the edge are cut off and unreachable` });

  // Real wheel input over the row, repeated until the row is at its end (or
  // refuses to move). No fixed sleep decides anything: a loaded CI runner can
  // take far longer than a desktop to deliver a wheel event, and the wheel
  // scroll itself animates - so after each gesture WAIT for the row to move
  // (up to 2s), then for it to come to rest, before judging. A row that never
  // moves (the clipper this check exists to catch) costs one 2s wait and then
  // fails below on scrollLeft 0.
  const scrollState = () => page.evaluate((sel) => { const b = document.querySelector(sel); return { left: b.scrollLeft, atEnd: b.scrollLeft + b.clientWidth >= b.scrollWidth - 1 }; }, selector);
  await page.mouse.move(before.cx, before.cy);
  for (let i = 0; i < 20; i++) {
    const from = await scrollState();
    if (from.atEnd) break;
    await page.mouse.wheel(600, 0);
    await page.waitForFunction(([sel, was]) => document.querySelector(sel).scrollLeft !== was, [selector, from.left], { timeout: 2000 }).catch(() => {});
    let now = (await scrollState()).left, prev;
    do { prev = now; await page.waitForTimeout(80); now = (await scrollState()).left; } while (now !== prev);
    if (now === from.left) break;
  }
  const end = await page.evaluate((sel) => {
    const port = (n) => { const r = n.getBoundingClientRect(); return { left: r.left + n.clientLeft, top: r.top + n.clientTop, right: r.left + n.clientLeft + n.clientWidth, bottom: r.top + n.clientTop + n.clientHeight }; };
    const bar = document.querySelector(sel);
    const chips = bar.querySelectorAll(".search-chip");
    const p = port(bar), c = chips[chips.length - 1].getBoundingClientRect();
    return { scrollLeft: Math.round(bar.scrollLeft), atEnd: bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 1, lastText: chips[chips.length - 1].textContent, lastInside: c.left >= p.left - 0.5 && c.right <= p.right + 0.5, last: [c.left, c.right].map(Math.round), row: [p.left, p.right].map(Math.round) };
  }, selector);
  out.push((end.scrollLeft > 0 && end.atEnd && end.lastInside)
    ? { ok: true, msg: `${name} row: a wheel gesture scrolls it to the end (scrollLeft ${end.scrollLeft}px) and the last chip "${end.lastText}" is then fully inside the row` }
    : { ok: false, msg: `${name} row did not scroll to its last chip with real wheel input: ` + JSON.stringify(end) });
  await page.evaluate((sel) => { document.querySelector(sel).scrollLeft = 0; }, selector);
  await page.mouse.move(0, 0);
  return out;
}

/* Put keyboard focus on chip[0] with a REAL key press: park focus on chip[1]
   from script, then Shift+Tab. A real key press is what makes :focus-visible
   match and what makes the browser run its own scroll-into-view. */
async function keyboardFocusFirstChip(page, selector) {
  await page.evaluate((sel) => { const bar = document.querySelector(sel); bar.scrollLeft = 0; bar.querySelectorAll(".search-chip")[1].focus(); }, selector);
  await page.keyboard.press("Shift+Tab");
}

/* Report on document.activeElement's focus ring: how far each side of the
   ring (the chip box grown by outline-width + outline-offset) sticks out of
   (a) the row's own scrollport - all four sides - and (b) every OTHER
   ancestor that clips sideways, plus the viewport - left/right only. (A
   page-level vertical scroller cutting a ring at the fold is a different,
   app-wide question; what this guards is the row and its inline margin.) */
function ringReport(page, selector) {
  return page.evaluate((sel) => {
    const port = (n) => { const r = n.getBoundingClientRect(); return { left: r.left + n.clientLeft, top: r.top + n.clientTop, right: r.left + n.clientLeft + n.clientWidth, bottom: r.top + n.clientTop + n.clientHeight }; };
    const a = document.activeElement, bar = document.querySelector(sel);
    if (!a || !bar || !bar.contains(a)) return { inRow: false, tag: a && a.tagName };
    const cs = getComputedStyle(a);
    const width = parseFloat(cs.outlineWidth) || 0, offset = parseFloat(cs.outlineOffset) || 0;
    const grow = Math.max(0, width + offset);
    const c = a.getBoundingClientRect();
    const ring = { left: c.left - grow, top: c.top - grow, right: c.right + grow, bottom: c.bottom + grow };
    const cut = [];
    if (getComputedStyle(bar).overflowX !== "visible") {
      const p = port(bar);
      [["top", p.top - ring.top], ["left", p.left - ring.left], ["right", ring.right - p.right], ["bottom", ring.bottom - p.bottom]]
        .forEach(([side, by]) => { if (by > 0.5) cut.push("the row's " + side + " edge by " + by.toFixed(1) + "px"); });
    }
    for (let n = bar.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).overflowX === "visible") continue;
      const q = port(n), who = "<" + n.tagName.toLowerCase() + (n.className ? "." + String(n.className).split(/\s+/)[0] : "") + ">";
      if (q.left - ring.left > 0.5) cut.push(who + " left edge by " + (q.left - ring.left).toFixed(1) + "px");
      if (ring.right - q.right > 0.5) cut.push(who + " right edge by " + (ring.right - q.right).toFixed(1) + "px");
    }
    const vw = document.documentElement.clientWidth;
    if (ring.left < -0.5) cut.push("the viewport's left edge by " + (-ring.left).toFixed(1) + "px");
    if (ring.right > vw + 0.5) cut.push("the viewport's right edge by " + (ring.right - vw).toFixed(1) + "px");
    return { inRow: true, index: [...bar.querySelectorAll(".search-chip")].indexOf(a), text: a.textContent, focusVisible: a.matches(":focus-visible"), style: cs.outlineStyle, width, offset, cut };
  }, selector);
}

/**
 * Tab through EVERY chip of the row with real key presses; at each stop the
 * whole focus ring must be inside everything that clips it. Walking all of
 * them (not just the first) also proves the browser's own scroll-into-view
 * leaves room for the ring at the row's edges (scroll-padding), including on
 * the last chip at the very end of the scroll range.
 * opts.boldFocus: run the walk with the app's Bold Focus setting on (a 3px
 * ring at 3px offset - the widest ring the app draws).
 */
export async function checkFocusRingNeverClipped(page, selector, name, opts) {
  const bold = !!(opts && opts.boldFocus);
  const label = `${name} row${bold ? " (Bold Focus on)" : ""}`;
  const count = await page.evaluate((sel) => { const bar = document.querySelector(sel); return bar ? bar.querySelectorAll(".search-chip").length : 0; }, selector);
  if (count < 2) return [{ ok: false, msg: `${label}: expected at least 2 chips, found ${count}` }];
  if (bold) await page.evaluate(() => document.documentElement.classList.add("bold-focus"));
  await keyboardFocusFirstChip(page, selector);
  const problems = [];
  let ringDesc = "";
  for (let i = 0; i < count; i++) {
    const r = await ringReport(page, selector);
    if (!r.inRow || r.index !== i) { problems.push(`stop ${i}: keyboard focus is not on chip ${i} (${JSON.stringify(r)})`); break; }
    if (!r.focusVisible || r.style === "none" || !(r.width > 0)) problems.push(`"${r.text}": no visible focus ring after a real Tab (${JSON.stringify({ focusVisible: r.focusVisible, style: r.style, width: r.width })})`);
    if (r.cut.length) problems.push(`"${r.text}" ring runs past ${r.cut.join(", ")}`);
    ringDesc = `${r.width}px ring at ${r.offset}px offset`;
    if (i < count - 1) await page.keyboard.press("Tab");
  }
  if (bold) await page.evaluate(() => document.documentElement.classList.remove("bold-focus"));
  await page.evaluate((sel) => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); document.querySelector(sel).scrollLeft = 0; }, selector);
  return [problems.length === 0
    ? { ok: true, msg: `${label}: Tab through all ${count} chips - the ${ringDesc} is never cut off, on any side` }
    : { ok: false, msg: `${label}: focus ring cut off on ${problems.length} of ${count} chips - ${problems.slice(0, 3).join(" | ")}${problems.length > 3 ? " | ..." : ""}` }];
}

/**
 * Pixel proof for the two edges the scroller used to swallow: with the first
 * chip keyboard-focused, the strip directly ABOVE it and the strip to its
 * LEFT must look different from the same strips once focus is gone (byte-
 * compared screenshots - the ring is the only thing that can change there).
 * Geometry says the ring fits; this says it is actually painted.
 */
export async function checkRingPaints(page, selector, name) {
  await keyboardFocusFirstChip(page, selector);
  const strips = await page.evaluate((sel) => {
    const a = document.activeElement, bar = document.querySelector(sel);
    if (!a || !bar || !bar.contains(a)) return null;
    const c = a.getBoundingClientRect();
    const midX = Math.round(c.left + c.width / 2), midY = Math.round(c.top + c.height / 2);
    return { text: a.textContent, top: { x: midX - 6, y: Math.floor(c.top) - 5, width: 12, height: 5 }, left: { x: Math.floor(c.left) - 5, y: midY - 2, width: 5, height: 4 } };
  }, selector);
  if (!strips) return [{ ok: false, msg: `${name} row: could not put keyboard focus on the first chip` }];
  const focused = { top: await page.screenshot({ clip: strips.top }), left: await page.screenshot({ clip: strips.left }) };
  await page.evaluate(() => document.activeElement.blur());
  const blurred = { top: await page.screenshot({ clip: strips.top }), left: await page.screenshot({ clip: strips.left }) };
  const painted = { top: !focused.top.equals(blurred.top), left: !focused.left.equals(blurred.left) };
  return [(painted.top && painted.left)
    ? { ok: true, msg: `${name} row: the first chip's focus ring really paints above it and to its left (the two edges a scroller swallows first)` }
    : { ok: false, msg: `${name} row: the focus ring on "${strips.text}" does not paint ${[!painted.top && "above the chip", !painted.left && "to the left of the chip"].filter(Boolean).join(" or ")} - those pixels are identical with and without focus` }];
}
