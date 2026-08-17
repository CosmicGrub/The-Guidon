/* ==== js/scrollhint.js ==== */
/* GUIDON - scrollhint.js : tells you a tab strip has more in it (G.scrollhint)

   §41 made .segmented horizontally scrollable rather than wrapping, because
   wrapping destroys the pill shape. That fixed reachability - the trailing tabs
   stopped being unreachable - but left a real usability hole: on a 412px phone
   the strip reads "BOARD DRILL | QUIZ | MOCK BOARD | POINTS | RE..." with no
   indication that scrolling is possible at all. A tab you cannot discover is
   barely better than a tab you cannot reach.

   The affordance is a MASK on the scroll container, not a coloured gradient.
   The app has 24 themes; any gradient painted in a specific colour would be
   wrong in most of them, and the buttons paint their own backgrounds anyway so
   a background gradient would sit behind them invisibly. A mask operates on
   alpha, so it fades whatever is actually there - button, label, active fill -
   and is correct in every theme for free.

   The attribute is set from measured geometry rather than a media query,
   because whether a strip overflows depends on how many tabs that particular
   view has, not on the screen width.
*/
window.G = window.G || {};
(function () {
  "use strict";

  // .segmented was the original target (§41); nav.nav (the mobile bottom-tab
  // rail, which packs up to ~32 destinations into one unlabelled horizontal
  // strip below 600px) and .tabbar (the shared sub-tab component used by
  // Board Prep, Develop, and - per its own code comment - "every other
  // tabbed feature") have the identical overflow-with-no-affordance gap.
  // Same geometry-driven mechanism, same mask, just a wider selector.
  const SEL = ".segmented, nav.nav, .tabbar";
  const EDGE = 2;                 // px tolerance for "scrolled to the end"

  function update(elm) {
    if (!elm || !elm.isConnected) return;
    const overflows = elm.scrollWidth - elm.clientWidth > EDGE;
    if (!overflows) elm.removeAttribute("data-scroll");
    else {
      const atEnd = elm.scrollLeft + elm.clientWidth >= elm.scrollWidth - EDGE;
      const atStart = elm.scrollLeft <= EDGE;
      // both = content hidden in both directions; more/back = one side only.
      elm.setAttribute("data-scroll", atEnd ? "back" : (atStart ? "more" : "both"));
    }

    // Vertical counterpart (nav.nav only, in practice): at >=600px the side
    // rail becomes a column and overflows top/bottom instead of left/right
    // once enough groups are open - see the flex-shrink:0 fix on
    // .nav-group-body that made real overflow (rather than silent clipping)
    // possible in the first place. .segmented/.tabbar never scroll
    // vertically, so this attribute simply never sets on them.
    const vOverflows = elm.scrollHeight - elm.clientHeight > EDGE;
    if (!vOverflows) { elm.removeAttribute("data-scroll-y"); return; }
    const atBottom = elm.scrollTop + elm.clientHeight >= elm.scrollHeight - EDGE;
    const atTop = elm.scrollTop <= EDGE;
    elm.setAttribute("data-scroll-y", atBottom ? "back" : (atTop ? "more" : "both"));
  }

  const wired = new WeakSet();
  let ro = null;

  function wire(elm) {
    if (wired.has(elm)) return;
    wired.add(elm);
    elm.addEventListener("scroll", function () { update(elm); }, { passive: true });
    if (ro) { try { ro.observe(elm); } catch (e) {} }
    update(elm);
    // If a non-first tab is active on render, bring it into view so the user
    // can see where they are rather than an apparently-unrelated strip.
    //
    // HORIZONTAL ONLY, by adjusting the strip's own scrollLeft — never
    // scrollIntoView(). scrollIntoView scrolls every ancestor, including the
    // page: with an active strip low in a view (Settings' forms-mode strip),
    // navigating to that section auto-scrolled the whole page down to it, so
    // arriving at Settings landed mid-page with the heading off-screen. That
    // shipped in v1.2.0 before being caught by a screenshot audit.
    const active = elm.querySelector("button.active");
    if (active) {
      const target = active.offsetLeft - (elm.clientWidth - active.offsetWidth) / 2;
      elm.scrollLeft = Math.max(0, Math.min(target, elm.scrollWidth - elm.clientWidth));
    }
  }

  function scanAll() {
    const list = document.querySelectorAll(SEL);
    for (let i = 0; i < list.length; i++) wire(list[i]);
    for (let i = 0; i < list.length; i++) update(list[i]);
  }

  function init() {
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(function (entries) {
        entries.forEach(function (e) { update(e.target); });
      });
    }
    // Views are re-rendered wholesale on navigation, so watch the tree rather
    // than trying to hook every call site that builds a .segmented.
    const mo = new MutationObserver(function () { scanAll(); });
    mo.observe(document.body, { childList: true, subtree: true });
    scanAll();
    window.addEventListener("resize", scanAll, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  G.scrollhint = { update: update, scanAll: scanAll, SEL: SEL };
})();
// END scrollhint.js
