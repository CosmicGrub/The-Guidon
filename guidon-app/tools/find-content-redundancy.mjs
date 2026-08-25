/**
 * Board-question redundancy DISCOVERY (re-runnable, on-demand — NOT part of
 * the normal build.mjs pipeline).
 *
 * This session's own Board Study Redundancy Audit found ~20 category-level
 * redundancy pairs across data.board.questions (1,069 cards, 93 categories)
 * by hand: 7 parallel research agents each combing a slice of the category
 * list, plus 2 adversarial-recheck agents double-checking the candidates
 * before anything got merged. That worked, and the real findings from it
 * (AR 670-1/Uniform Standards, AR 623-3/Evaluations, TC 3-21.5/Drill and
 * Ceremony, TC 3-22.9/Weapons, the TC 3-25.26/Land Navigation/Map Reading &
 * Land Navigation cluster, and more) are real. But it was expensive and not
 * repeatable — the next content pass has no way to re-check "did we already
 * find everything" without re-running the same manual sweep from scratch.
 *
 * This script formalizes ONLY the DISCOVERY half of that process as a real,
 * deterministic, re-runnable heuristic. It does NOT attempt the judgment
 * half (is a flagged pair actually safe to merge, and how) — that requires
 * reading the actual card content and understanding whether two categories
 * are truly redundant or just cite the same broad doctrine for legitimately
 * different reasons (see ADP 6-22 below). Treat this script's output as a
 * candidate list for human/LLM review, not a merge plan.
 *
 * TWO INDEPENDENT PASSES, because they catch different things:
 *
 *   PASS 1 — dominant-source category matching. Groups board.questions by
 *   `category`, and for each category finds its most common `source` value
 *   after splitting each card's source string on [,/;(] and trimming — the
 *   exact splitting logic src/index.html's own cross-linking already uses
 *   (see its `pubRef` derivation, e.g. around the "Related doctrine" button
 *   in the board-drill view: `(q.source || "").split(/[,/;(]/).map(s =>
 *   s.trim()).filter(Boolean)`). Two categories whose dominant source
 *   matches, where EACH independently clears a real majority share of its
 *   own cards, are a candidate pair — e.g. "AR 670-1" (its own category,
 *   ~95% AR 670-1) and "Uniform Standards" (~56% AR 670-1) are almost
 *   certainly the same regulation studied under two names.
 *
 *   This pass has a KNOWN, EXPECTED false-positive pattern: a handful of
 *   broad "umbrella" doctrine sources (ADP 6-22 is the clearest example)
 *   are the plurality source for many genuinely distinct study categories
 *   (Army Values, Leadership, Warrior Ethos, Counterproductive Leadership,
 *   Levels of Leadership, Attributes, ...) without those categories being
 *   redundant WITH EACH OTHER — they're just all leadership doctrine that
 *   happens to live in the same manual. The original manual audit hit this
 *   exact pattern and correctly rejected those pairs after review. This
 *   script does not special-case ADP 6-22 (or anything else) out — it
 *   reports what the heuristic finds, honestly, including that noise; see
 *   this script's own validation notes in the project report for how to
 *   read it.
 *
 *   PASS 2 — near-duplicate card text. Independent of category or source:
 *   compares every card's (q + " " + a) text against every other card's
 *   using two small, dependency-free set-similarity measures over
 *   stopword-filtered word sets — Jaccard (intersection / union, penalizes
 *   size mismatches) and the overlap/containment coefficient (intersection
 *   / smaller set's size, catches a short card whose entire content is
 *   subsumed by a longer one, which plain Jaccard undervalues). This is
 *   what catches same-fact cards typed out independently under different
 *   ids/categories/phrasing — e.g. the Troop Leading Procedures 8-step list
 *   independently authored 5 times (bq26, tlp-1, adp50-2, bq-ops-03,
 *   mdmp-2, opproc-8) across 3 categories (Operations, Troop Leading
 *   Procedures, ADP 5-0, Operations Process) — the kind of duplication pure
 *   source-matching can never see, because every one of those cards cites a
 *   different, individually-correct source.
 *
 * Both passes run against the real, current seed via seed-io.mjs's
 * readSeed() — never a stale snapshot.
 *
 * Usage:
 *   node tools/find-content-redundancy.mjs [options]
 *     --json <path>        also write the full structured report as JSON
 *     --top <n>             console rows per section (default 40; JSON output is never truncated)
 *     --share <0..1>        Pass 1 minimum per-category dominant-source share (default 0.40)
 *     --jaccard <0..1>      Pass 2 minimum Jaccard score (default 0.35)
 *     --overlap <0..1>      Pass 2 minimum overlap/containment score (default 0.80)
 *     --min-words <n>       Pass 2 minimum content-word count per card to be considered (default 6)
 */
import { writeFileSync } from "node:fs";
import { readSeed } from "./seed-io.mjs";

// ── CLI args ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { json: null, top: 40, share: 0.40, jaccard: 0.35, overlap: 0.80, minWords: 6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--json") out.json = next();
    else if (a === "--top") out.top = Number(next());
    else if (a === "--share") out.share = Number(next());
    else if (a === "--jaccard") out.jaccard = Number(next());
    else if (a === "--overlap") out.overlap = Number(next());
    else if (a === "--min-words") out.minWords = Number(next());
  }
  return out;
}
const OPTS = parseArgs(process.argv.slice(2));

// ── Pass 1: dominant-source category matching ──────────────────────────

// Mirrors src/index.html's own `pubRef` cross-linking split EXACTLY (see
// this file's header) — same regex, same trim, same drop-empty filter — so
// "which sources does this card cite" means the same thing here as it does
// to the app's own "Related doctrine" cross-linking.
function splitSources(sourceStr) {
  return (sourceStr || "").split(/[,/;(]/).map((s) => s.trim()).filter(Boolean);
}

function groupByCategory(questions) {
  const byCategory = new Map();
  for (const q of questions) {
    const cat = q.category || "(uncategorized)";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(q);
  }
  return byCategory;
}

// Dominant source's share is computed against the total count of source
// TOKENS in the category (a card citing "TC 3-21.5, Ch 2" contributes one
// count to each of "TC 3-21.5" and "Ch 2"), not against the card count —
// simplest direct reading of "the most common source string ... after
// splitting", and it's what the real data validates cleanly against.
function dominantSource(cards) {
  const counts = new Map();
  let total = 0;
  for (const c of cards) {
    for (const token of splitSources(c.source)) {
      counts.set(token, (counts.get(token) || 0) + 1);
      total++;
    }
  }
  let best = null, bestCount = 0;
  for (const [token, count] of counts) {
    if (count > bestCount) { best = token; bestCount = count; }
  }
  return { source: best, count: bestCount, total, share: total ? bestCount / total : 0 };
}

function findCategoryPairs(questions, shareThreshold) {
  const byCategory = groupByCategory(questions);
  const categories = [...byCategory.entries()].map(([name, cards]) => ({
    name, cards, n: cards.length, dominant: dominantSource(cards),
  }));

  const pairs = [];
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      const A = categories[i], B = categories[j];
      if (!A.dominant.source || !B.dominant.source) continue;
      if (A.dominant.source !== B.dominant.source) continue;
      if (A.dominant.share < shareThreshold || B.dominant.share < shareThreshold) continue;
      pairs.push({
        categoryA: A.name, nA: A.n, shareA: A.dominant.share,
        categoryB: B.name, nB: B.n, shareB: B.dominant.share,
        dominantSource: A.dominant.source,
        confidence: Math.min(A.dominant.share, B.dominant.share),
      });
    }
  }
  pairs.sort((x, y) => y.confidence - x.confidence);
  return { pairs, categories };
}

// ── Pass 2: near-duplicate card text ────────────────────────────────────

const STOPWORDS = new Set(("a an the of to in on for and or is are was were be been being this that these "
  + "those with as at by from it its into over under between within about which what who whom whose when "
  + "where why how not no nor so than then too very can will would should could may might must shall do "
  + "does did have has had i you he she we they them his her our your their s t re ve ll d m").split(" "));

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function wordSet(s) {
  const words = normalize(s).split(" ").filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}
function intersectionSize(a, b) {
  let n = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) n++;
  return n;
}

function findCardPairs(questions, { jaccardThreshold, overlapThreshold, minWords }) {
  const cards = questions
    .map((q) => ({ id: q.id, category: q.category, q: q.q, a: q.a, set: wordSet(`${q.q} ${q.a}`) }))
    .filter((c) => c.set.size >= minWords);

  const pairs = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const A = cards[i], B = cards[j];
      const inter = intersectionSize(A.set, B.set);
      if (inter === 0) continue;
      const jaccard = inter / (A.set.size + B.set.size - inter);
      const overlap = inter / Math.min(A.set.size, B.set.size);
      if (jaccard < jaccardThreshold && overlap < overlapThreshold) continue;
      pairs.push({
        idA: A.id, categoryA: A.category, qA: A.q,
        idB: B.id, categoryB: B.category, qB: B.q,
        crossCategory: A.category !== B.category,
        jaccard, overlap,
        score: Math.max(jaccard, overlap),
      });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return { pairs, consideredCards: cards.length, totalCards: questions.length };
}

// ── Run both passes ─────────────────────────────────────────────────────
const { data } = readSeed("src/index.html");
const questions = data.board.questions;

const pass1 = findCategoryPairs(questions, OPTS.share);
const pass2 = findCardPairs(questions, { jaccardThreshold: OPTS.jaccard, overlapThreshold: OPTS.overlap, minWords: OPTS.minWords });

const report = {
  generatedAt: new Date().toISOString(),
  thresholds: { categoryShare: OPTS.share, cardJaccard: OPTS.jaccard, cardOverlap: OPTS.overlap, minCardWords: OPTS.minWords },
  totals: {
    totalCards: questions.length,
    totalCategories: pass1.categories.length,
    categoryPairsFound: pass1.pairs.length,
    cardPairsFound: pass2.pairs.length,
    cardPairsCrossCategory: pass2.pairs.filter((p) => p.crossCategory).length,
    cardsConsideredForPass2: pass2.consideredCards,
  },
  categoryPairs: pass1.pairs,
  cardPairs: pass2.pairs,
};

// ── Console summary ─────────────────────────────────────────────────────
console.log(`\nBoard-question redundancy audit — ${report.totals.totalCards} cards across ${report.totals.totalCategories} categories\n`);

console.log(`── Pass 1: dominant-source category pairs (share >= ${OPTS.share}) — ${pass1.pairs.length} found ──`);
if (pass1.pairs.length === 0) console.log("  (none)");
for (const p of pass1.pairs.slice(0, OPTS.top)) {
  console.log(
    `  [${(p.confidence * 100).toFixed(0)}%] "${p.categoryA}" (${p.nA} cards, ${(p.shareA * 100).toFixed(0)}% ${p.dominantSource})`
    + `  <->  "${p.categoryB}" (${p.nB} cards, ${(p.shareB * 100).toFixed(0)}% ${p.dominantSource})`
  );
}
if (pass1.pairs.length > OPTS.top) console.log(`  ... and ${pass1.pairs.length - OPTS.top} more (see --json for the full list)`);

const cross = pass2.pairs.filter((p) => p.crossCategory);
const same = pass2.pairs.filter((p) => !p.crossCategory);
console.log(`\n── Pass 2: near-duplicate card text — ${pass2.pairs.length} found (${cross.length} cross-category, ${same.length} same-category) ──`);
console.log(`  (${pass2.consideredCards}/${report.totals.totalCards} cards had >= ${OPTS.minWords} content words and were considered)\n`);

console.log(`  Cross-category (the kind source-matching alone cannot catch):`);
if (cross.length === 0) console.log("    (none)");
for (const p of cross.slice(0, OPTS.top)) {
  console.log(`    [jac=${p.jaccard.toFixed(2)} ovl=${p.overlap.toFixed(2)}] ${p.idA} [${p.categoryA}] <-> ${p.idB} [${p.categoryB}]`);
  console.log(`        "${p.qA.slice(0, 78)}"`);
  console.log(`        "${p.qB.slice(0, 78)}"`);
}
if (cross.length > OPTS.top) console.log(`    ... and ${cross.length - OPTS.top} more (see --json for the full list)`);

console.log(`\n  Same-category (may just be adjacent facts on one topic — lower priority):`);
if (same.length === 0) console.log("    (none)");
for (const p of same.slice(0, Math.min(OPTS.top, 15))) {
  console.log(`    [jac=${p.jaccard.toFixed(2)} ovl=${p.overlap.toFixed(2)}] ${p.idA} <-> ${p.idB} [${p.categoryA}]`);
}
if (same.length > 15) console.log(`    ... and ${same.length - 15} more (see --json for the full list)`);

console.log(`\nThis is a DISCOVERY tool: every pair above is a candidate for human/LLM review, not a merge instruction.\n`);

if (OPTS.json) {
  writeFileSync(OPTS.json, JSON.stringify(report, null, 2), "utf8");
  console.log(`Full structured report written to ${OPTS.json}`);
}
