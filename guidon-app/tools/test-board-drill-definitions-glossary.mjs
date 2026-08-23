/**
 * Roadmap Tier 3: Board Drill's Definitions tab is framed in its own copy
 * ("Use the search to zero in on any term") as a searchable glossary, but
 * used to render its combined board-Q/doctrine/dictionary list in flat
 * insertion order behind a plain "Load 150 more" button - no A-Z structure
 * at all. renderDefinitions() (board.js) now sorts that list by concept and
 * drops a sticky .def-section-header in front of each new first letter.
 *
 * This proves the actual glossary shape, not just "nothing throws":
 *   1. Section headers render in real ascending letter order, and every
 *      card under a given header actually starts with that letter - the
 *      grouping is real, not decorative text dropped in randomly.
 *   2. That correctness holds up after "Load more" pulls in the bulk of
 *      the (1000+ entry) deck, not just the first 150-card page.
 *   3. Typing in the search box still filters (existing behavior, read
 *      from the "Showing X of Y" count rather than just the capped-at-150
 *      DOM slice) AND the filtered set is still correctly grouped.
 *   4. The category filter still works alongside the new grouping.
 *   5. Section headers are genuinely sticky (position:sticky), so they
 *      behave like real A-Z jump structure while scrolling, not static
 *      dividers - and scrolling the list produces no console errors.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(700);

const clickedDef = await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".segmented button")].find((b) => (b.textContent || "").trim() === "Definitions");
  if (!btn) return false;
  btn.click();
  return true;
});
clickedDef ? ok("clicked the Definitions tab button") : bad("could not find a 'Definitions' button in the Board Drill segmented control");
await page.waitForTimeout(400);

// ---- helpers ----
async function readSections() {
  return page.evaluate(() => {
    const firstHeader = document.querySelector(".def-section-header");
    if (!firstHeader) return [];
    const listDiv = firstHeader.parentElement;
    const sections = [];
    let current = null;
    [...listDiv.children].forEach((n) => {
      if (n.classList.contains("def-section-header")) {
        current = { letter: n.textContent.trim(), concepts: [] };
        sections.push(current);
      } else if (n.classList.contains("def-card") && current) {
        const h4 = n.querySelector(".def-concept");
        current.concepts.push(h4 ? h4.textContent.trim() : "");
      }
    });
    return sections;
  });
}
async function readCountText() {
  return page.evaluate(() => {
    const cnt = document.querySelector(".search-count");
    return cnt ? cnt.textContent : null;
  });
}
function totalOf(countText) {
  const m = /of (\d+)/.exec(countText || "");
  return m ? +m[1] : null;
}
function assertAscendingAndFiled(sections, label) {
  const ascending = sections.every((s, i) => i === 0 || sections[i - 1].letter < s.letter);
  ascending
    ? ok(`${label}: section headers are in ascending order (${sections.map((s) => s.letter).join(",")})`)
    : bad(`${label}: section headers NOT ascending: ${sections.map((s) => s.letter).join(",")}`);

  const misfiled = [];
  sections.forEach((s) => {
    s.concepts.forEach((c) => {
      const first = (c || "").trim().charAt(0).toUpperCase();
      const expected = (first >= "A" && first <= "Z") ? first : "#";
      if (expected !== s.letter) misfiled.push(`"${c}" under "${s.letter}"`);
    });
  });
  misfiled.length === 0
    ? ok(`${label}: every card's concept text starts with its own section header's letter`)
    : bad(`${label}: ${misfiled.length} misfiled card(s): ` + misfiled.slice(0, 5).join(" | "));
  return ascending && misfiled.length === 0;
}

/* ---- 1: real A-Z structure on the default (unfiltered) first page ---- */
const baseSections = await readSections();
const baseCount = await readCountText();
baseSections.length >= 2
  ? ok(`default view renders ${baseSections.length} section header(s) on its first page`)
  : bad(`only ${baseSections.length} section header(s) rendered - expected at least a couple distinct letters`);
assertAscendingAndFiled(baseSections, "default view");
const totalConcepts = totalOf(baseCount);
totalConcepts && totalConcepts > 150
  ? ok(`deck is large enough (${totalConcepts} concepts) that "Load more" pagination is genuinely exercised`)
  : bad(`unexpectedly small deck (${baseCount}) - Load-more path won't be meaningfully tested`);

/* ---- 2: correctness holds after paging through most/all of the deck ---- */
if (totalConcepts && totalConcepts > 150) {
  for (let i = 0; i < 6; i++) {
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /^Load \d+ more$/.test((b.textContent || "").trim()));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await page.waitForTimeout(150);
    if (!clicked) break;
  }
  const grownSections = await readSections();
  const grownCount = await readCountText();
  grownSections.length > baseSections.length
    ? ok(`after "Load more", the visible letter spread grew to ${grownSections.length} sections (was ${baseSections.length})`)
    : bad(`"Load more" did not reveal additional letters: still ${grownSections.length} section(s)`);
  assertAscendingAndFiled(grownSections, "after Load more");
  const grownTotal = totalOf(grownCount);
  (grownTotal === totalConcepts)
    ? ok(`the "of N" total (${grownTotal}) is stable across paging - Load more only reveals more of the same sorted list`)
    : bad(`total shifted while paging: was ${totalConcepts}, now ${grownTotal}`);
}

/* ---- 3: search still filters (by the real total, not the capped DOM slice), and stays grouped ---- */
const searchInput = await page.$('input[aria-label="Search definitions"]');
searchInput ? ok("search input is present (aria-label='Search definitions')") : bad("search input not found");

if (searchInput) {
  await searchInput.fill("leader");
  await page.waitForTimeout(350); // debounce is 150ms in board.js
  const filteredSections = await readSections();
  const filteredCount = await readCountText();
  const filteredTotal = totalOf(filteredCount);
  (filteredTotal != null && filteredTotal > 0 && filteredTotal < totalConcepts)
    ? ok(`searching "leader" narrowed the glossary to ${filteredTotal} concepts (from ${totalConcepts})`)
    : bad(`search did not narrow the real total as expected: ${filteredCount} (base total was ${totalConcepts})`);
  assertAscendingAndFiled(filteredSections, "after searching 'leader'");

  await searchInput.fill("");
  await page.waitForTimeout(350);
  const clearedCount = await readCountText();
  totalOf(clearedCount) === totalConcepts
    ? ok("clearing the search restores the full, unfiltered total")
    : bad(`clearing search did not restore total: ${clearedCount}`);
}

/* ---- 4: category filter still works alongside the new grouping ---- */
const catInfo = await page.evaluate(() => {
  const sel = document.querySelector(".search-box + select");
  if (!sel) return null;
  return { options: [...sel.options].map((o) => o.value) };
});
if (!catInfo || catInfo.options.length < 2) {
  bad("category <select> not found or has no real categories to test");
} else {
  const targetCat = catInfo.options[1]; // index 0 is "All"
  await page.evaluate((cat) => {
    const sel = document.querySelector(".search-box + select");
    sel.value = cat;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, targetCat);
  await page.waitForTimeout(250);
  const catSections = await readSections();
  const catCount = await readCountText();
  const catTotal = totalOf(catCount);
  const catValid = assertAscendingAndFiled(catSections, `category "${targetCat}"`);
  (catTotal && catTotal > 0 && catValid)
    ? ok(`category filter "${targetCat}" groups its ${catTotal} concept(s) under valid A-Z headers`)
    : bad(`category filter "${targetCat}" broke grouping (${catCount})`);

  // Reset to "All" for the sticky/scroll check below.
  await page.evaluate(() => {
    const sel = document.querySelector(".search-box + select");
    sel.value = "All";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(250);
}

/* ---- 5: headers are really sticky, and scrolling the list is clean ---- */
const stickyPosition = await page.evaluate(() => {
  const h = document.querySelector(".def-section-header");
  return h ? getComputedStyle(h).position : null;
});
stickyPosition === "sticky"
  ? ok("section headers use position:sticky (real A-Z jump behavior, not static dividers)")
  : bad(`section header computed position is "${stickyPosition}", expected "sticky"`);

await page.evaluate(() => {
  const main = document.querySelector(".main");
  if (main) main.scrollTop = main.scrollHeight;
});
await page.waitForTimeout(200);
const afterScrollSections = await readSections();
afterScrollSections.length > 0
  ? ok("scrolling the list leaves section headers/cards intact")
  : bad("section headers/cards disappeared after scrolling");

noise.length === 0 ? ok("no console errors/warnings across the whole flow") : bad("console noise: " + noise.join(" | "));

console.log(fails === 0 ? "\nBOARD DRILL DEFINITIONS GLOSSARY: all passed" : `\nBOARD DRILL DEFINITIONS GLOSSARY: ${fails} failed`);
await page.close();
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
