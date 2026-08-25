/**
 * Freshness CROSS-REFERENCE (build-time, re-runnable, non-blocking).
 *
 * THE GAP THIS CLOSES: src/app-modules/currency.js's G.currency system
 * (#/currency) tracks 10 DOMAIN-level freshness signals ("Board Prep, high
 * volatility, last checked 2026-03-06") but has no idea whether any SPECIFIC
 * content item citing that domain was ever actually verified — there was no
 * link from the coarse domain signal down to individual content items.
 *
 * THE FIX: an optional `verifiedAgainst: { domain, date }` tag that can be
 * attached to any content item anywhere in the seed (a board.questions[]
 * card, a points.categories entry, a finance.funds.list fund, a transition
 * sub-object, ...). `domain` is the exact `short` key from currency.js's
 * DOMAINS array; `date` is the real date a human/agent actually checked that
 * item's content against a live source.
 *
 * This script finds every `verifiedAgainst` tag anywhere in the seed (a
 * generic recursive walk — no hardcoded list of "the 8 places tags can
 * live", so a tag added anywhere in the future is picked up automatically),
 * resolves each tag's domain to that domain's REAL CURRENT `asOf` date, and
 * flags any tag whose domain has moved on since the item was checked:
 *
 *   domain.asOf > item.verifiedAgainst.date
 *     => "this item's verification may be stale — the domain it cites has
 *         since updated." (does NOT mean the item is wrong, just that it
 *         hasn't been re-checked against whatever changed)
 *
 * GETTING REAL DOMAIN DATES WITHOUT A BROWSER: currency.js's DOMAINS array
 * lives inside a `window.G = ...; (function () { ... })()` IIFE that assumes
 * a browser/DOM global — it can't just be `import`-ed into a bare Node
 * script. Two of its ten domains (Career, Money) don't even carry a literal
 * `asOf` string; they're `get asOf()` accessors that read live seed state
 * (see careerAsOfStamp()/financeAsOfStamp() in that file) specifically so
 * currency.js's own display can never show a hand-typed date that's drifted
 * from the seed's real content.
 *
 * Rather than hand-copying currency.js's 8 literal asOf strings into this
 * file (exactly the kind of silently-divergent duplication this repo's
 * tools/*.mjs convention exists to avoid — see seed-io.mjs's own header),
 * this script TEXTUALLY PARSES the real, current src/app-modules/currency.js
 * source for its DOMAINS array's `short`/`asOf` pairs every time it runs.
 * The 8 static domains' dates come from that parse, always in sync with
 * currency.js's actual source. The 2 live-getter domains (Career, Money) are
 * resolved by mirroring ONLY the small "read this real seed field" logic of
 * careerAsOfStamp()/financeAsOfStamp() — not the browser-dependent module —
 * reading the exact same seed fields those getters read, via the same
 * readSeed() every other tools/*.mjs script uses. If currency.js ever grows
 * a THIRD live-getter domain this script doesn't know how to resolve, it
 * says so explicitly (domain listed as "unresolvable", never guessed at or
 * silently dropped) rather than corrupting the report.
 *
 * THIS IS A DISCOVERY/REPORT TOOL, NOT A GATE: it never exits non-zero and
 * never throws for a "stale" finding — a human decides what a stale finding
 * means. It only ever exits non-zero-equivalent behavior... actually it
 * doesn't: every code path, including unexpected internal errors, reports
 * clearly and exits 0, because this script must never be the reason a CI run
 * (or a local `npm run audit:freshness`) goes red over a coverage report.
 *
 * Usage:
 *   node tools/audit-content-freshness.mjs [options]
 *     --json <path>   also write the full structured report as JSON
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readSeed } from "./seed-io.mjs";

// ── CLI args ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = argv[++i];
  }
  return out;
}
const OPTS = parseArgs(process.argv.slice(2));

// ── Date parsing, mirroring currency.js's ageOf() exactly ──────────────
// Accept YYYY, YYYY-MM or YYYY-MM-DD; assume the start of the period (same
// "conservative" convention currency.js uses) so this script's comparisons
// can never disagree with what a person would see on #/currency.
function parseStamp(stamp) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(stamp || ""));
  if (!m) return null;
  return new Date(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
}

// ── Resolve currency.js's real DOMAINS (short -> current asOf) ─────────
// See this file's header for why this parses the real source text instead
// of hand-copying its literals.
const CURRENCY_JS_PATH = "src/app-modules/currency.js";

// The only two `get asOf()` live getters currency.js currently defines,
// and exactly the seed field each one reads (see careerAsOfStamp() /
// financeAsOfStamp() in currency.js for the browser-side originals this
// mirrors). Adding a new getter to currency.js without adding it here is
// caught explicitly below, not silently mishandled.
const LIVE_GETTERS = {
  careerAsOfStamp(seedData) {
    try {
      const stamp = seedData.career?.fy26Snapshot?.sourceMilper?.effectiveDate || "";
      if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(stamp)) return stamp;
    } catch { /* fall through to null */ }
    return null;
  },
  financeAsOfStamp(seedData) {
    try {
      const asOf = seedData.finance?.asOf || "";
      const m = /\b(20\d{2})\b/.exec(asOf);
      if (m) return m[1];
    } catch { /* fall through to null */ }
    return null;
  },
};

function loadDomainAsOf(seedData) {
  const src = readFileSync(CURRENCY_JS_PATH, "utf8");
  const startIdx = src.indexOf("const DOMAINS = [");
  if (startIdx === -1) {
    throw new Error(`audit-content-freshness: could not find "const DOMAINS = [" in ${CURRENCY_JS_PATH} — has currency.js been restructured?`);
  }
  // Bounded by the next top-level function declaration after the array
  // (ageOf(), in the real file) so the regex below only ever scans the
  // DOMAINS array block itself, not the rest of the module.
  const endIdx = src.indexOf("\n  function ageOf", startIdx);
  const block = endIdx === -1 ? src.slice(startIdx) : src.slice(startIdx, endIdx);

  const entryRe = /short:\s*"([^"]+)"[\s\S]{0,160}?(?:asOf:\s*"([^"]+)"|get asOf\(\)\s*\{\s*return\s*(\w+)\(\))/g;
  const domains = new Map(); // short -> { asOf, source }
  let m;
  while ((m = entryRe.exec(block))) {
    const [, short, literalAsOf, getterName] = m;
    if (literalAsOf) {
      domains.set(short, { asOf: literalAsOf, source: "literal" });
    } else if (getterName) {
      const resolver = LIVE_GETTERS[getterName];
      if (!resolver) {
        domains.set(short, { asOf: null, source: `unresolvable live getter "${getterName}" — audit-content-freshness.mjs does not know how to read this field; add it to LIVE_GETTERS` });
      } else {
        const live = resolver(seedData);
        domains.set(short, { asOf: live, source: `live (${getterName})` + (live ? "" : " — could not be read from the current seed" ) });
      }
    }
  }
  if (domains.size === 0) {
    throw new Error(`audit-content-freshness: parsed 0 domains out of ${CURRENCY_JS_PATH}'s DOMAINS array — the regex may no longer match this file's shape`);
  }
  return domains;
}

// ── Generic recursive walk: find every `verifiedAgainst` tag in the seed ──
// No hardcoded list of "the known tagged locations" — any object anywhere
// in the seed tree carrying a `verifiedAgainst: { domain, date }` field is
// picked up, so a tag added somewhere new later doesn't require touching
// this script.
function pathToString(path) {
  let s = "";
  for (const seg of path) {
    if (typeof seg === "number") s += `[${seg}]`;
    else s += (s ? "." : "") + seg;
  }
  return s || "(root)";
}

// Best-effort human label for a tagged node, using whichever identifying
// field it happens to carry (board.questions has `id`, funds.list has
// `code`, va_financial.key_thresholds has `pct`, the bdd.verifiedKeyPoints
// sidecar has `keyPointIndex` + `note`, ...) — falls back to the seed path
// itself when nothing more specific is available.
function describeNode(node, path) {
  const bits = [];
  if (typeof node.id === "string") bits.push(`id=${node.id}`);
  if (typeof node.code === "string") bits.push(`code=${node.code}`);
  if (typeof node.pct === "number") bits.push(`pct=${node.pct}`);
  if (typeof node.keyPointIndex === "number") bits.push(`keyPointIndex=${node.keyPointIndex}`);
  if (typeof node.note === "string") bits.push(`"${node.note.slice(0, 60)}${node.note.length > 60 ? "…" : ""}"`);
  if (bits.length === 0 && typeof node.category === "string") bits.push(`category=${node.category}`);
  if (bits.length === 0 && typeof node.q === "string") bits.push(`q="${node.q.slice(0, 60)}${node.q.length > 60 ? "…" : ""}"`);
  if (bits.length === 0 && typeof node.label === "string") bits.push(`label=${node.label}`);
  return bits.length ? bits.join(" ") : pathToString(path);
}

function isVerifiedAgainstShape(v) {
  return v && typeof v === "object" && !Array.isArray(v)
    && typeof v.domain === "string" && typeof v.date === "string";
}

function findVerifiedAgainstTags(root) {
  const found = [];
  function walk(node, path) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, path.concat(i)));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, "verifiedAgainst") && isVerifiedAgainstShape(node.verifiedAgainst)) {
      found.push({
        domain: node.verifiedAgainst.domain,
        date: node.verifiedAgainst.date,
        path: pathToString(path),
        label: describeNode(node, path),
      });
    }
    for (const key of Object.keys(node)) {
      if (key === "verifiedAgainst") continue; // the tag itself carries no nested tags
      walk(node[key], path.concat(key));
    }
  }
  walk(root, []);
  return found;
}

// ── Run ──────────────────────────────────────────────────────────────────
function main() {
  const { data: seedData } = readSeed("src/index.html");
  const domainAsOf = loadDomainAsOf(seedData);
  const tags = findVerifiedAgainstTags(seedData);

  const perDomain = new Map(); // short -> { total, current, stale, unknown, items: [] }
  for (const short of domainAsOf.keys()) {
    perDomain.set(short, { total: 0, current: 0, stale: 0, unknown: 0, items: [] });
  }

  for (const tag of tags) {
    if (!perDomain.has(tag.domain)) {
      // A tag citing a domain currency.js's DOMAINS array no longer has (or
      // never had — a typo). Surface it under its own bucket rather than
      // dropping it silently.
      perDomain.set(tag.domain, { total: 0, current: 0, stale: 0, unknown: 0, items: [], unrecognizedDomain: true });
    }
    const bucket = perDomain.get(tag.domain);
    bucket.total++;

    const domainInfo = domainAsOf.get(tag.domain);
    const domainAsOfStr = domainInfo ? domainInfo.asOf : null;
    const domainDate = domainAsOfStr ? parseStamp(domainAsOfStr) : null;
    const itemDate = parseStamp(tag.date);

    let status;
    if (bucket.unrecognizedDomain || !domainDate || !itemDate) {
      status = "unknown";
      bucket.unknown++;
    } else if (domainDate.getTime() > itemDate.getTime()) {
      status = "stale";
      bucket.stale++;
    } else {
      status = "current";
      bucket.current++;
    }

    bucket.items.push({
      path: tag.path,
      label: tag.label,
      verifiedDate: tag.date,
      domainAsOf: domainAsOfStr,
      status,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    domains: [...domainAsOf.entries()].map(([short, info]) => ({ short, asOf: info.asOf, resolvedVia: info.source })),
    totals: {
      totalTaggedItems: tags.length,
      totalCurrent: [...perDomain.values()].reduce((n, b) => n + b.current, 0),
      totalStale: [...perDomain.values()].reduce((n, b) => n + b.stale, 0),
      totalUnknown: [...perDomain.values()].reduce((n, b) => n + b.unknown, 0),
    },
    perDomain: Object.fromEntries(perDomain),
  };

  // ── Console report ──────────────────────────────────────────────────
  console.log(`\nContent-freshness cross-reference — ${report.totals.totalTaggedItems} tagged item(s) across ${perDomain.size} domain(s)\n`);

  console.log("── Domain asOf (real, resolved this run) ──");
  for (const d of report.domains) {
    console.log(`  ${d.short.padEnd(14)} asOf=${String(d.asOf).padEnd(12)} (${d.resolvedVia})`);
  }

  console.log(`\n── Per-domain tagged-item coverage ──`);
  for (const [short, bucket] of perDomain) {
    if (bucket.total === 0) {
      console.log(`  ${short.padEnd(14)} 0 tagged items`);
      continue;
    }
    const flag = bucket.unrecognizedDomain ? "  [!] not in currency.js's DOMAINS array" : "";
    console.log(`  ${short.padEnd(14)} ${bucket.total} tagged — ${bucket.current} current, ${bucket.stale} possibly stale, ${bucket.unknown} unknown${flag}`);
    for (const it of bucket.items) {
      const marker = it.status === "stale" ? "STALE " : it.status === "unknown" ? "UNKNOWN" : "current";
      console.log(`      [${marker}] ${it.path} — ${it.label} (verified ${it.verifiedDate}, domain asOf ${it.domainAsOf ?? "?"})`);
    }
  }

  if (report.totals.totalStale > 0) {
    console.log(`\n${report.totals.totalStale} item(s) may be stale — the domain they cite has moved on since they were last checked. This is not a failure: it means those specific items are worth a re-check, nothing more.`);
  } else if (report.totals.totalTaggedItems > 0) {
    console.log(`\nAll ${report.totals.totalTaggedItems} tagged item(s) are current relative to their domain's real asOf date.`);
  } else {
    console.log(`\nNo content carries a verifiedAgainst tag yet. This is a discovery tool, not a gate — coverage grows as content gets tagged.`);
  }
  console.log(`\nThis is a DISCOVERY tool: a "stale" flag means "worth a re-check", not "wrong". A human decides what to do with it.\n`);

  if (OPTS.json) {
    writeFileSync(OPTS.json, JSON.stringify(report, null, 2), "utf8");
    console.log(`Full structured report written to ${OPTS.json}`);
  }
}

try {
  main();
} catch (e) {
  // Never let this discovery tool fail a build. Report the error clearly
  // and still exit 0 — see this file's header.
  console.error(`audit-content-freshness: internal error (reported, not fatal): ${e.message}`);
}
