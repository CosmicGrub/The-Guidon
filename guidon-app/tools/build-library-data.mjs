/**
 * GUIDON Reference Library data assembly (one-time / re-run-on-demand tool,
 * NOT part of the normal build.mjs pipeline).
 *
 * Reads the real, official source PDFs staged in docs-source/ (fetched
 * directly from armypubs.army.mil), re-extracts plain text from each via
 * `pdftotext -enc UTF-8` (no -layout: plain mode reflows as prose, which
 * reads far better in a narrow mobile pane than -layout's whitespace-padded
 * column alignment) into docs-source/_text/*.txt, and produces
 * src/app-modules/library.js - a self-contained app module carrying the
 * full text of all core publications plus their metadata.
 *
 * -enc UTF-8 is NOT optional: pdftotext's default output encoding on this
 * toolchain is NOT UTF-8, and every regulation citation's en-dash
 * ("AR 600–8–19") silently corrupted into invalid UTF-8 bytes without it -
 * Node's readFile(path, "utf8") does not throw on invalid UTF-8, it just
 * substitutes U+FFFD, so that corruption shipped silently the first time
 * this ran. Re-extracting here (rather than trusting whatever is already in
 * _text/) means that mistake can't quietly recur by someone re-running
 * pdftotext by hand without the flag. validateUtf8() below is the second,
 * independent guard: it fails the whole build loudly if any page's text
 * still isn't clean UTF-8, rather than shipping a silent U+FFFD.
 *
 * Why a separate assembly script rather than doing this by hand: 15
 * documents, ~1,955 pages, ~5.7MB of text. Hand-editing that into a JS file
 * is exactly the kind of mechanical, error-prone transcription this script
 * exists to make deterministic and re-runnable (e.g. when a 16th document
 * is added, or an edition updates).
 *
 * PDFs themselves are NOT embedded here - build.mjs's own step copies
 * docs-source/*.pdf to web/docs/ for the web/Android builds (see its "TM
 * source PDFs" step). The standalone single-file build intentionally gets
 * text only, per the explicit architecture decision: real PDFs would ~10x
 * dist/guidon-standalone.html's size, and that distribution's whole promise
 * is "one portable file."
 */
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const SRC_DIR = "docs-source";
const TEXT_DIR = join(SRC_DIR, "_text");
const OUT = "src/app-modules/library.js";

/* Throws with the exact byte offset and file on the first invalid UTF-8
   sequence found, rather than letting one silently become a U+FFFD in
   shipped app content. A handful of isolated symbol-font glyphs (e.g. a
   ballistics formula in TC 3-22.9) can still legitimately need sanitizing -
   that is a deliberate, logged, one-time decision made in the text itself
   (see docs-source/README.md), not something this check should paper over
   by default. */
function assertValidUtf8(buf, label) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    throw new Error(`${label}: not valid UTF-8 (${e.message}). Was it extracted without -enc UTF-8?`);
  }
}

/* One genuine, confirmed exception: TC 3-22.9 (Rifle and Carbine) embeds a
   ballistics formula through a symbol font whose glyphs map to malformed
   CESU-8 surrogate bytes in the PDF itself - not a missing -enc UTF-8 flag,
   an actual encoding defect in that one publication's source. Confirmed by
   hand: ~240 bytes out of 325KB (0.07%), isolated to that one inline
   formula, not the surrounding prose. Every other document in DOCS is
   expected to be clean; if a new document trips this, investigate it -
   don't add it here reflexively. */
const KNOWN_INVALID_UTF8 = new Set(["TC_3-22.9_Rifle_and_Carbine"]);

/* One entry per publication. `file` is the docs-source/ basename (shared by
   the .pdf and the _text/*.txt extraction). Title/date/supersedes are
   filled in below from each document's own extracted cover/preface text
   where the pattern is reliable - hand-confirmed against the fetched PDFs
   rather than guessed, since this is exactly the kind of "current vs.
   stale" fact the whole feature exists to get right. */
const DOCS = [
  { id: "adp-6-0", file: "ADP_6-0_Mission_Command", citation: "ADP 6-0",
    title: "Command and Control", note: "Retitled from \"Mission Command\" in this July 2026 edition." },
  { id: "adp-6-22", file: "ADP_6-22_Army_Leadership_and_the_Profession", citation: "ADP 6-22",
    title: "Army Leadership and the Profession", note: null },
  { id: "adp-5-0", file: "ADP_5-0_The_Operations_Process", citation: "ADP 5-0",
    title: "The Operations Process", note: null },
  { id: "adp-7-0", file: "ADP_7-0_Training", citation: "ADP 7-0",
    title: "Training", note: null },
  { id: "ar-350-1", file: "AR_350-1_Army_Training_and_Leader_Development", citation: "AR 350-1",
    title: "Army Training and Leader Development", note: null },
  { id: "ar-600-8-19", file: "AR_600-8-19_Enlisted_Promotions_and_Reductions", citation: "AR 600-8-19",
    title: "Enlisted Promotions and Demotions", note: "The regulation GUIDON's own Board Prep / Records Readiness math is built on." },
  { id: "ar-600-9", file: "AR_600-9_Army_Body_Composition_Program", citation: "AR 600-9",
    title: "The Army Body Composition Program", note: null },
  { id: "ar-600-20", file: "AR_600-20_Army_Command_Policy", citation: "AR 600-20",
    title: "Army Command Policy", note: null },
  { id: "ar-623-3", file: "AR_623-3_Evaluation_Reporting_System", citation: "AR 623-3",
    title: "Evaluation Reporting System", note: null },
  { id: "ar-670-1", file: "AR_670-1_Wear_and_Appearance", citation: "AR 670-1",
    title: "Wear and Appearance of Army Uniforms and Insignia", note: null },
  { id: "atp-6-22-1", file: "ATP_6-22.1_The_Counseling_Process", citation: "ATP 6-22.1",
    title: "Providing Feedback: Counseling, Coaching, Mentoring", note: null },
  { id: "da-pam-600-25", file: "DA_PAM_600-25_NCO_Professional_Development_Guide", citation: "DA PAM 600-25",
    title: "U.S. Army Noncommissioned Officer Professional Development Guide", note: null },
  { id: "fm-7-22", file: "FM_7-22_Holistic_Health_and_Fitness", citation: "FM 7-22",
    title: "Holistic Health and Fitness", note: null },
  { id: "tc-3-21-5", file: "TC_3-21.5_Drill_and_Ceremonies", citation: "TC 3-21.5",
    title: "Drill and Ceremonies", note: null },
  { id: "tc-3-22-9", file: "TC_3-22.9_Rifle_and_Carbine", citation: "TC 3-22.9",
    title: "Rifle and Carbine", note: null },
];

function splitPages(raw) {
  // pdftotext separates pages with form-feed (\f); the last page has no
  // trailing one. Trim each page but keep internal blank lines (paragraph
  // spacing carries real meaning in a regulation's outline structure).
  return raw.split("\f").map((p) => p.replace(/\s+$/,"").replace(/^\s+/,"")).filter((p, i, arr) =>
    !(i === arr.length - 1 && p === "")); // drop a trailing empty page from a final \f
}

// Two house styles for a table-of-contents ENTRY, matched over a page's
// WHOLE text (not line-by-line — see detectToc()'s comment on why):
//   "Some Title ....... 4-2"   dot-leader, chapter-relative or roman-numeral
//                               page label (TC/FM/ADP house style)
//   "Some Title, page 45"      comma style (AR/DA PAM house style)
// Global, so a single page's full text yields every entry on it in one
// pass. The label group excludes "." so a run of dot-leaders itself can
// never be swallowed into the label, and excludes "," for the same reason
// in the comma variant.
const TOC_DOTLEADER_RE = /([A-Za-z][^.\n]{2,140}?)\.{4,}\s*([ivxlcdm]+|\d+(?:-\d+)?)\b/gi;
const TOC_COMMA_RE = /([A-Za-z][^,\n]{2,140}?),\s*page\s+([ivxlcdm]+|\d+(?:-\d+)?)\b/gi;

/* Detects which page(s) of a document are its own table of contents, and
   extracts the section/chapter/table/figure LABELS listed there (NOT their
   page numbers - those use inconsistent per-document schemes, chapter-
   relative like "14-47" in one house style vs. absolute in another, and
   there is no reliable way to map a label's own claimed page number back to
   this script's absolute page-index array without a second, equally
   fragile heuristic on top of this one). Library.js instead makes a TOC
   entry navigable by SEARCHING the document for its own label text and
   jumping to the first real (non-TOC) match - see this file's header and
   library.js's renderToc()/jumpToLabel().

   Matched over each page's FULL text as one string, not split by line
   first: several of the 15 source PDFs (the ADP series in particular) lay
   the Contents page out in a dense multi-column table that pdftotext
   extracts as a handful of long flowing lines with no newline between
   individual entries — a line-based scan found zero entries on exactly
   those pages, even though the dot-leader pattern is present dozens of
   times in the raw text.

   A page counts as TOC-like if 5+ entries match - dense enough that an
   ordinary prose page essentially cannot trigger it by accident (a real
   paragraph doesn't contain five-plus dot-leader-style runs). Runs of
   matching pages are merged (FM 7-22's own Contents section alone spans
   several pages), and capped at the first 20 pages of the document: a page
   80+ that happens to score high is far more likely a dense data table
   than a genuine contents listing, and this is a heuristic, not a
   guarantee - getting it slightly wrong just means one page's content is
   missing from search results, not a broken document. */
function tocEntriesOnPage(pageText) {
  const out = [];
  for (const re of [TOC_DOTLEADER_RE, TOC_COMMA_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(pageText))) out.push(m[1].replace(/\s+/g, " ").trim());
  }
  return out;
}

function detectToc(pages) {
  const scored = pages.slice(0, 20).map((p) => tocEntriesOnPage(p));
  const tocIdx = new Set();
  const labels = [];
  let inRun = false;
  scored.forEach((hits, i) => {
    if (hits.length >= 5) {
      tocIdx.add(i);
      labels.push(...hits);
      inRun = true;
    } else if (inRun && hits.length >= 2) {
      // Tail of a multi-page TOC often trails off (a short Figures/Tables
      // list after the main Contents) - a lower bar while still inside a
      // run avoids cutting that off, without lowering the bar for the
      // FIRST page (which is what keeps ordinary prose out).
      tocIdx.add(i);
      labels.push(...hits);
    } else {
      inRun = false;
    }
  });
  // Dedupe (Figures/Tables lists often repeat a chapter name that's already
  // in the main Contents), drop labels too short to be a meaningful search
  // anchor (stray leader-dot fragments, bare "Section I" headers that
  // match dozens of places), and drop labels starting with a lowercase
  // letter - real chapter/section headings never do, but a hyphenated
  // title wrapped across a line by pdftotext (e.g. "...Staff Ser-\ngeant)")
  // produces exactly that shape: a fragment beginning mid-word.
  const seen = new Set();
  const cleanLabels = labels
    .filter((l) => l.length >= 6 && /^[A-Z0-9]/.test(l) && !seen.has(l.toLowerCase()) && (seen.add(l.toLowerCase()), true))
    .slice(0, 80); // a working jump-list, not a full reproduction of a 100+ row Figure/Table index
  return { tocPageIndices: [...tocIdx].sort((a, b) => a - b), tocEntries: cleanLabels };
}

async function main() {
  await mkdir(TEXT_DIR, { recursive: true });
  const docs = [];
  for (const d of DOCS) {
    const pdfPath = join(SRC_DIR, d.file + ".pdf");
    const txtPath = join(TEXT_DIR, d.file + ".txt");
    const pdfStat = await stat(pdfPath);
    // Re-extract every run rather than trusting a possibly-stale _text/*.txt
    // left over from a manual pdftotext invocation (see this file's header
    // comment on -enc UTF-8). pdftotext writes UTF-8 bytes directly; read
    // the buffer raw and validate BEFORE decoding as a JS string, so a bad
    // extraction fails here with a clear message instead of silently
    // becoming U+FFFD replacement characters three steps downstream.
    execFileSync("pdftotext", ["-enc", "UTF-8", pdfPath, txtPath]);
    const buf = await readFile(txtPath);
    let raw;
    if (KNOWN_INVALID_UTF8.has(d.file)) {
      // Sanitize rather than fail: TextDecoder without `fatal` substitutes
      // U+FFFD for each malformed sequence instead of throwing - the same
      // graceful degradation used to hand-fix this file the first time.
      raw = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      console.log(`  ${d.file}: known symbol-font encoding defect, sanitized (see KNOWN_INVALID_UTF8)`);
    } else {
      assertValidUtf8(buf, txtPath);
      raw = buf.toString("utf8");
    }
    const pages = splitPages(raw);
    const { tocPageIndices, tocEntries } = detectToc(pages);
    console.log(`  ${d.file}: TOC pages [${tocPageIndices.join(",")}], ${tocEntries.length} jump entries`);
    docs.push({
      id: d.id,
      citation: d.citation,
      title: d.title,
      note: d.note,
      pdfAsset: "docs/" + d.file + ".pdf",
      pdfBytes: pdfStat.size,
      pageCount: pages.length,
      pages,
      tocPageIndices,
      tocEntries,
    });
  }

  const totalChars = docs.reduce((s, d) => s + d.pages.reduce((s2, p) => s2 + p.length, 0), 0);
  const totalPages = docs.reduce((s, d) => s + d.pageCount, 0);

  const header = `/* ==== js/library.js ==== */
/* GUIDON — library.js : Reference Library (global G.library)

   The real, current-edition text of ${docs.length} core Army publications GUIDON's
   own content is built on - fetched directly from armypubs.army.mil (or, for
   ADP 6-0, supplied directly since its official listing was briefly down),
   not reconstructed from memory. ${totalPages} pages, ${(totalChars / 1e6).toFixed(1)}M characters.

   Generated by tools/build-library-data.mjs - do not hand-edit the DOCS data
   below. Re-run that script after adding/updating a document in docs-source/.

   Two ways to read each document:
     1) Native — this module's own reader, styled like the rest of GUIDON,
        built from the plain-text extraction below. Continuous-scroll (every
        page rendered as its own block, content-visibility:auto for
        performance) rather than one-page-at-a-time, specifically so native
        browser Ctrl+F/Cmd+F can find text anywhere in the document. GUIDON's
        own search bar sits above it and additionally excludes each
        document's detected table-of-contents page(s) from results — Ctrl+F
        has no equivalent concept and will still match TOC text, since it
        can only search what's actually rendered; see renderNative()'s and
        searchDoc()'s comments for the full reasoning. A "Jump to section"
        panel lists the document's own chapter/section headings (extracted
        at build time — see detectToc() below) and searches for the chosen
        one, landing on its first real (non-TOC) occurrence.
     2) Original — the real PDF, viewed exactly as published. Only available
        where docs/*.pdf actually ships (the web/Android builds — see
        build.mjs's "TM source PDFs" step). The standalone single-file build
        has the native reader only; embedding ${docs.length} real PDFs would ~10x its
        size, against that distribution's whole "one portable file" promise.

   Study aid only. Not official Army/DoD publication. If anything here
   disagrees with a current regulation, the regulation wins — see each
   document's own "Confirm with" panel and armypubs.army.mil.
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  const DOCS = `;

  const footer = `;

  function byId(id) { return DOCS.find((d) => d.id === id) || null; }

  let activeDoc = null;   // currently open document id, or null (list view)
  let activeMode = "native"; // "native" | "original" — per-document, resets to native on open
  let activePage = 0;     // 0-based page index last scrolled to, for resuming on tab switch

  function fmtBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.round(n / 1024) + " KB";
  }

  function renderList(mount) {
    mount.appendChild(el("div.section-title", {}, [el("h2", { text: "Reference Library" }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text:
      "The real, current-edition text of the " + DOCS.length + " Army publications GUIDON's own content is built on — fetched from armypubs.army.mil, not reconstructed from memory. Read natively (styled like the rest of GUIDON) or open the original PDF exactly as published." }));

    const grid = el("div.card-results-grid");
    mount.appendChild(grid);
    DOCS.forEach((d) => {
      const card = el("div.card.click", { role: "button", tabindex: "0",
        onclick: () => openDoc(mount, d.id),
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") openDoc(mount, d.id); } });
      card.appendChild(el("div.mini-row", { style: "justify-content:space-between;align-items:baseline" }, [
        el("h3", { text: d.citation }),
        el("span.meta", { text: d.pageCount + " pages" }),
      ]));
      card.appendChild(el("p.hint", { text: d.title }));
      if (d.note) card.appendChild(el("p", { style: "margin-top:6px;font-size:0.85rem", text: d.note }));
      grid.appendChild(card);
    });

    mount.appendChild(el("p.hint", { style: "margin-top:14px", text:
      "Study aid only — not an official Army or DoD publication. If anything here disagrees with a current regulation, the regulation wins. Verify anything decision-critical at armypubs.army.mil." }));
  }

  function openDoc(mount, id) {
    activeDoc = id; activeMode = "native"; activePage = 0;
    render(mount);
  }

  function backToList(mount) {
    activeDoc = null;
    render(mount);
  }

  function renderDetail(mount) {
    const d = byId(activeDoc);
    if (!d) { activeDoc = null; return renderList(mount); }

    const back = el("button.btn.sm.ghost", { type: "button", text: "← Reference Library", style: "margin-bottom:10px" });
    back.addEventListener("click", () => backToList(mount));
    mount.appendChild(back);

    mount.appendChild(el("div.section-title", {}, [el("h2", { text: d.citation }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text: d.title }));

    const hasPdf = G.library._pdfAvailable !== false; // set by index.js probe below
    const tabs = el("div.tabbar", { role: "tablist" });
    if (util.tabbarKeys) util.tabbarKeys(tabs);
    tabs.appendChild(util.tabBtn("Read in GUIDON", activeMode === "native", () => { activeMode = "native"; render(mount); }));
    if (hasPdf) tabs.appendChild(util.tabBtn("Original PDF", activeMode === "original", () => { activeMode = "original"; render(mount); }));
    mount.appendChild(tabs);

    const stage = el("div", { id: "library-stage", style: "margin-top:10px" });
    mount.appendChild(stage);

    if (activeMode === "original" && hasPdf) return renderOriginal(stage, d);
    return renderNative(stage, d);
  }

  // Snippet around a match, as real DOM (a <mark class="dict-hi"> for the
  // hit itself) rather than a string — reuses Global Search's own
  // highlight styling (views.search's highlight()) rather than inventing a
  // second one.
  function snippetNode(pageText, matchStart, matchLen) {
    const CTX = 50;
    const start = Math.max(0, matchStart - CTX);
    const end = Math.min(pageText.length, matchStart + matchLen + CTX);
    const span = el("span");
    if (start > 0) span.appendChild(document.createTextNode("…"));
    span.appendChild(document.createTextNode(pageText.slice(start, matchStart).replace(/\s+/g, " ")));
    span.appendChild(el("mark.dict-hi", { text: pageText.slice(matchStart, matchStart + matchLen) }));
    span.appendChild(document.createTextNode(pageText.slice(matchStart + matchLen, end).replace(/\s+/g, " ")));
    if (end < pageText.length) span.appendChild(document.createTextNode("…"));
    return span;
  }

  // Case-insensitive substring search across every page EXCEPT the
  // document's own detected table-of-contents pages (d.tocPageIndices) -
  // the whole point being that searching "AR 350-1" or a chapter name
  // shouldn't come back with the Contents page's own navigational listing
  // as a "hit" alongside the real place that content actually appears.
  // Ctrl+F has no equivalent concept of "skip this page" (it can only
  // search text that's actually rendered), which is exactly why this
  // exists as GUIDON's own search rather than relying on Ctrl+F alone -
  // see this file's header and renderNative()'s comment on content-
  // visibility for how Ctrl+F is still made to work across the FULL
  // document despite the continuous view never rendering all pages at
  // full layout cost simultaneously.
  function searchDoc(d, query) {
    if (!query || query.length < 2) return [];
    const ql = query.toLowerCase();
    const tocSet = new Set(d.tocPageIndices);
    const hits = [];
    d.pages.forEach((pageText, i) => {
      if (tocSet.has(i)) return;
      const idx = pageText.toLowerCase().indexOf(ql);
      if (idx === -1) return;
      hits.push({ page: i, matchStart: idx, matchLen: query.length });
    });
    return hits;
  }

  function jumpToPage(scroller, pageIdx) {
    const target = scroller.querySelector('[data-page="' + pageIdx + '"]');
    if (!target) return;
    activePage = pageIdx;
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    target.classList.add("list-detail-jumped");
    setTimeout(() => target.classList.remove("list-detail-jumped"), 1600);
  }

  function renderNative(stage, d) {
    util.clear(stage);

    // ── Search bar — GUIDON's own search, TOC-excluded (see searchDoc) ──
    const searchBox = el("div.search-box");
    const searchInput = el("input", { type: "search", placeholder: "Search this document…",
      "aria-label": "Search " + d.citation, autocomplete: "off" });
    searchBox.appendChild(searchInput);
    stage.appendChild(searchBox);

    const resultsBox = el("div", { style: "margin:8px 0" });
    stage.appendChild(resultsBox);

    function runAndShow(query) {
      util.clear(resultsBox);
      if (!query || query.length < 2) return;
      const hits = searchDoc(d, query);
      if (!hits.length) {
        resultsBox.appendChild(el("div.empty", { text: "No matches (table-of-contents pages are excluded from search)." }));
        return;
      }
      const shown = hits.slice(0, 30);
      resultsBox.appendChild(el("p.hint", { text: hits.length + " match" + (hits.length === 1 ? "" : "es") +
        (hits.length > shown.length ? " (showing first " + shown.length + ")" : "") }));
      shown.forEach((h) => {
        const row = el("button.list-detail-row", { type: "button", style: "text-align:left;margin-bottom:4px" }, [
          el("span.ldr-badge", { text: "p. " + (h.page + 1) }),
          snippetNode(d.pages[h.page], h.matchStart, h.matchLen),
        ]);
        row.addEventListener("click", () => jumpToPage(scroller, h.page));
        resultsBox.appendChild(row);
      });
    }
    let deb;
    searchInput.addEventListener("input", () => {
      clearTimeout(deb);
      deb = setTimeout(() => runAndShow(searchInput.value.trim()), 150);
    });

    // ── Table of contents — "the app itself follows the TOC": each entry
    // is the document's own chapter/section label (extracted at build time,
    // see build-library-data.mjs's detectToc()), made navigable by running
    // it through the SAME search above and jumping to the first real
    // (non-TOC) match, rather than trusting the TOC's own claimed page
    // number - those use inconsistent per-document schemes (chapter-
    // relative like "14-47" in one house style, absolute in another) that
    // can't be reliably mapped back to this reader's page-index array. ──
    if (d.tocEntries.length) {
      let tocOpen = false;
      const tocToggle = el("button.btn.sm.ghost", { type: "button", text: "Jump to section ▾" });
      const tocPanel = el("div.panel", { style: "margin-top:8px;display:none;max-height:40vh;overflow-y:auto" });
      tocToggle.addEventListener("click", () => {
        tocOpen = !tocOpen;
        tocPanel.style.display = tocOpen ? "" : "none";
        tocToggle.textContent = tocOpen ? "Jump to section ▴" : "Jump to section ▾";
      });
      d.tocEntries.forEach((label) => {
        const row = el("button.list-detail-row", { type: "button", style: "margin-bottom:4px" }, [el("span.ldr-name", { text: label })]);
        row.addEventListener("click", () => {
          const hits = searchDoc(d, label);
          if (hits.length) { searchInput.value = label; runAndShow(label); jumpToPage(scroller, hits[0].page); }
        });
        tocPanel.appendChild(row);
      });
      stage.appendChild(tocToggle);
      stage.appendChild(tocPanel);
    }

    // ── Continuous scroll — every page rendered as its own block, so
    // native browser Ctrl+F/Cmd+F can find text ANYWHERE in the document,
    // not just whatever one page a paginated view happened to have on
    // screen. content-visibility:auto skips layout/paint cost for
    // off-screen blocks (the same win a virtualized list gets) WITHOUT the
    // downside virtualization usually has for find-in-page: Chrome/Firefox
    // both special-cased content-visibility specifically so it does not
    // hide content from Ctrl+F the way display:none would. ──
    const scroller = el("div.panel", { id: "library-scroller",
      style: "margin-top:10px;white-space:pre-wrap;font-size:0.92rem;line-height:1.6;max-height:70vh;overflow-y:auto" });
    d.pages.forEach((pageText, i) => {
      const block = el("div.lib-page", { "data-page": String(i) });
      block.appendChild(el("div.meta", { style: "font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim);margin-bottom:6px",
        text: "Page " + (i + 1) + " / " + d.pageCount }));
      block.appendChild(document.createTextNode(pageText || "(blank page)"));
      scroller.appendChild(block);
    });
    stage.appendChild(scroller);

    // Resume near wherever the Soldier last scrolled to (e.g. after
    // switching to the Original PDF tab and back), not back at page 1.
    if (activePage > 0) {
      const target = scroller.querySelector('[data-page="' + activePage + '"]');
      if (target) target.scrollIntoView({ block: "start" });
    }
    scroller.addEventListener("scroll", () => {
      const sr = scroller.getBoundingClientRect();
      const blocks = scroller.querySelectorAll(".lib-page");
      for (const b of blocks) {
        if (b.getBoundingClientRect().top >= sr.top - 4) { activePage = Number(b.dataset.page); break; }
      }
    }, { passive: true });
  }

  // Fetches the real PDF bytes and hands them to util.downloadBinary(),
  // which already branches correctly per platform (task #200's own fix,
  // reused rather than re-solved): a real blob-download on web, and on
  // native Android — where <a download>/<a target=_blank> are confirmed
  // silent no-ops, verified on a real device — Filesystem.writeFile() +
  // Share.share() so the OS share sheet's "Open with" hands it to a real
  // PDF viewer. Fetching first rather than passing d.pdfAsset straight
  // through matters here specifically: downloadBinary's native branch needs
  // the actual bytes to base64-encode for Filesystem.writeFile, not a URL.
  async function saveOriginal(d) {
    const res = await fetch(d.pdfAsset);
    if (!res.ok) throw new Error("fetch failed: " + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    const name = d.citation.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".pdf";
    const ok = await util.downloadBinary(name, buf, "application/pdf");
    if (!ok) throw new Error("downloadBinary returned false");
  }

  function renderOriginal(stage, d) {
    util.clear(stage);
    const isNative = !!(G.native && G.native.isNative && G.native.isNative());
    // Android's stock WebView (unlike a real browser) has no built-in PDF
    // renderer - an <iframe src="*.pdf"> is confirmed blank on a real
    // device, not just untested. Showing an always-empty box there is
    // worse than not showing one; native gets a single clear action
    // instead, web keeps the iframe (real browsers render it fine).
    if (isNative) {
      // No working href fallback exists on this platform (that's this
      // function's whole reason for being) — the button below is the only
      // way to reach the file, so it's the primary control, not an
      // afterthought under an empty box.
      const btn = el("button.btn.sm", { type: "button", text: "Open the original PDF", style: "display:inline-block" });
      util.busyButton(btn, () => saveOriginal(d), {
        busy: "Opening…", doneMs: 4000,
        done: () => "Choose an app to view the PDF.",
        fail: "Couldn't open the PDF. Try again, or use the Read in GUIDON tab instead.",
      });
      stage.appendChild(btn);
    } else {
      // Real browsers render a PDF <iframe> natively; target="_blank" and
      // <a download> both already work correctly here (task #200's gap is
      // Android-WebView-specific), so the plain link from before is enough.
      const frame = el("iframe", {
        src: d.pdfAsset, title: d.citation + " — original PDF",
        style: "width:100%;height:75vh;border:1px solid var(--line);border-radius:8px;background:var(--panel)",
      });
      stage.appendChild(frame);
      const dl = el("a.btn.sm.ghost", { href: d.pdfAsset, target: "_blank", rel: "noopener", text: "Open in a new tab", style: "margin-top:8px;display:inline-block" });
      stage.appendChild(dl);
    }
    stage.appendChild(el("p.hint", { style: "margin-top:6px", text: "The real, unmodified publication (" + fmtBytes(d.pdfBytes) + ") as fetched from armypubs.army.mil." }));
  }

  async function render(mount) {
    util.clear(mount);
    // Probe once per app session whether docs/*.pdf actually shipped in this
    // build (true on web/Android, false on the standalone single-file build,
    // which intentionally ships text only — see this file's header comment).
    // location.protocol === "file:" is checked FIRST and short-circuits
    // before ever calling fetch(): a file:// fetch() doesn't just reject,
    // it logs "Fetch API cannot load ... URL scheme is not supported" to
    // the console as a side effect of the browser's own network layer,
    // before this function's try/catch ever runs — so catching the
    // rejection is not enough to keep this console-error-clean, tools/
    // test-standalone.mjs (loads dist/guidon-standalone.html from a real
    // file:// URL) caught exactly that.
    if (G.library._pdfAvailable === undefined) {
      if (location.protocol === "file:") {
        G.library._pdfAvailable = false;
      } else {
        try {
          const probe = await fetch(DOCS[0].pdfAsset, { method: "HEAD" });
          G.library._pdfAvailable = probe.ok;
        } catch (e) { G.library._pdfAvailable = false; }
      }
    }
    // One-shot cross-link (same pattern as G.career._searchSeed and
    // G.board._openReadiness): another module — currently only currency.js's
    // "Read the source" button — sets this, navigates to #/library, and this
    // consumes it exactly once rather than leaving Library permanently stuck
    // on whatever document was last cross-linked into it.
    if (G.library._openId) {
      if (byId(G.library._openId)) { activeDoc = G.library._openId; activeMode = "native"; activePage = 0; }
      G.library._openId = null;
    }
    if (activeDoc) return renderDetail(mount);
    return renderList(mount);
  }

  G.library = { render: render, DOCS: DOCS, _pdfAvailable: undefined, _openId: null };
})();
// END library.js
`;

  const json = JSON.stringify(docs);
  const out = header + "JSON.parse(" + JSON.stringify(json) + ")" + footer;
  await writeFile(OUT, out, "utf8");

  console.log(`library.js written: ${docs.length} docs, ${totalPages} pages, ${(totalChars / 1e6).toFixed(2)}M chars, ${(Buffer.byteLength(out, "utf8") / 1048576).toFixed(2)} MB module`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
