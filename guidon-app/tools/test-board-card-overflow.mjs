/**
 * Board Drill: no card may ever render an element wider than the viewport
 * at the narrowest real phone widths - the card (both faces) must fit.
 *
 * Why this suite exists: verify.mjs section 5 reads one overflow probe at
 * #/board per narrow viewport, but Board Drill shuffles its deck on every
 * mount (build(): shuffle(newItems)), so each read samples ONE random card
 * out of ~1000. A defect that lives on a handful of cards - measured
 * 2026-09-04: the back-face "Related doctrine (<long pub name>) ->"
 * button.btn.ghost.sm, whose .btn-row parent pins it at flex-shrink:0 so a
 * 400-409px label never shrinks to a 276px card - therefore surfaced as a
 * ~0.7%-per-run flake, and took a full per-card sweep to attribute. This
 * suite IS that sweep, promoted: it steps every card in the deck with the
 * "Next card" button and reads the same probe on each one, so a per-card
 * overflow is deterministic (every card, every run) instead of sampled.
 *
 * Two contexts, sequential, one browser: 360x480 without touch (verify's
 * win-min) and 344x882 with touch (the folded Z Fold5 cover screen). The
 * deck size comes from the live "Card i/N" tally, never from a hand-copied
 * count, and the sweep steps exactly N cards; wrap-around is asserted from
 * the tally too. Only the FRONT face is visible per card, but the probe
 * reads getBoundingClientRect() of every body element, so a too-wide
 * back-face element is caught pre-flip (that is exactly how the original
 * defect measured, and how verify.mjs saw it).
 *
 * Run: node tools/test-board-card-overflow.mjs [webdir]
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

const WEB = process.argv[2] || "web";
const CONTEXTS = [
  { name: "win-min", width: 360, height: 480, touch: false },
  { name: "fold-closed", width: 344, height: 882, touch: true },
];
const STEP_CAP = 3000; // hard ceiling per context, well above any real deck

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// Same shape as verify.mjs OVERFLOW_PROBE, plus the front-face prompt and
// every offender (not only the widest) so a FAIL line is self-diagnosing.
const PROBE = () => {
  const iw = window.innerWidth;
  const wide = [];
  for (const el of document.querySelectorAll("body *")) {
    const w = el.getBoundingClientRect().width;
    if (w > iw + 1) {
      const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean)[0];
      wide.push({ tagcls: el.tagName.toLowerCase() + (cls ? "." + cls : ""), w: Math.round(w) });
    }
  }
  wide.sort((a, b) => b.w - a.w);
  const tally = [...document.querySelectorAll(".stat .v")].map((e) => e.textContent || "").find((t) => /^Card \d+\/\d+/.test(t)) || "";
  const m = /^Card (\d+)\/(\d+)/.exec(tally);
  return {
    iw,
    doc: document.documentElement.scrollWidth - iw,
    wide,
    prompt: (document.querySelector(".qz-prompt")?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
    card: m ? Number(m[1]) : 0,
    total: m ? Number(m[2]) : 0,
  };
};

const t0 = Date.now();
const { server, url } = await serve(WEB);
const browser = await chromium.launch();
try {
  for (const vp of CONTEXTS) {
    const tag = `${vp.name} ${vp.width}x${vp.height} touch=${vp.touch}`;
    console.log(`\n[${tag}]`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
    const page = await ctx.newPage();
    const noise = [];
    page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

    await page.goto(url, { waitUntil: "load" });
    await dismissOnboarding(page);
    await page.evaluate(() => { location.hash = "#/board"; });
    await page.waitForTimeout(800);

    const hasNext = await page.evaluate(() => !!document.querySelector('button.qz-nav-btn[aria-label="Next card"]'));
    const first = await page.evaluate(PROBE);
    if (!hasNext || !first.total) {
      bad(`${tag}: Board Drill did not mount (next button ${hasNext}, tally total ${first.total})`);
      await ctx.close();
      continue;
    }
    ok(`${tag}: mounted, innerWidth=${first.iw}, deck of ${first.total} cards (from the live tally)`);

    const total = first.total;
    let stepped = 0, hits = 0;
    for (let n = 0; n < Math.min(total, STEP_CAP); n++) {
      const o = n === 0 ? first : await page.evaluate(PROBE);
      stepped++;
      if (o.doc > 1 || o.wide.length) {
        hits++;
        const offenders = o.wide.slice(0, 3).map((x) => `${x.tagcls} ${x.w}px`).join(", ");
        bad(`${tag}: card ${o.card}/${o.total} doc=${o.doc} wide=${o.wide.length} (${offenders}) :: "${o.prompt}"`);
      }
      await page.evaluate(() => { document.querySelector('button.qz-nav-btn[aria-label="Next card"]')?.click(); });
      await page.waitForTimeout(25);
    }
    const after = await page.evaluate(PROBE);
    stepped === total ? ok(`${tag}: stepped all ${stepped}/${total} cards, ${hits} with overflow`)
                      : bad(`${tag}: stepped ${stepped} of ${total} cards`);
    after.card === 1 && after.prompt === first.prompt
      ? ok(`${tag}: deck wrapped back to card 1 ("${first.prompt}")`)
      : bad(`${tag}: after ${total} steps expected card 1, saw card ${after.card} ("${after.prompt}")`);
    noise.length === 0 ? ok(`${tag}: zero page errors`) : bad(`${tag}: ${noise.length} page errors; first: ${noise[0]}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAIL"} - board-card-overflow (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails);
