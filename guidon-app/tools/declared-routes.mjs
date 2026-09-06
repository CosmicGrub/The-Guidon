/**
 * Counts the routes DECLARED in the built HTML, so tests can assert that every
 * declared route actually registered at runtime without hard-coding a number.
 *
 * Hard-coding it is what broke here: three test files each carried their own
 * literal "29", and adding two sections turned a passing suite red for no real
 * reason. That is the same hand-maintained-parallel-list mistake the Demo
 * Center hit in §33 — this time in the tests rather than the app.
 */
import { readFile } from "node:fs/promises";

export async function declaredRoutes(file = "web/index.html") {
  const html = await readFile(file, "utf8");
  const start = html.indexOf("const ROUTES = [");
  if (start < 0) throw new Error("declaredRoutes: ROUTES array not found in " + file);
  const end = html.indexOf("\n  ];", start);
  const block = html.slice(start, end < 0 ? start + 4000 : end);
  const hashes = [...block.matchAll(/hash:\s*"(#\/[a-z]+)"/g)].map((m) => m[1]);
  return { count: hashes.length, hashes };
}

/**
 * The routes the grouped sidebar / "More" drawer actually render, read from
 * the same built HTML: every hash in a NAV_GROUPS entry's `hashes:` array
 * (other keys such as subdivideAfter/demoted repeat hashes and are not
 * counted), minus NAV_HIDDEN, and only if ROUTES declares it (navButton()
 * returns null otherwise). tools/test-nav-tier1.mjs and
 * tools/test-nav-tier2ab.mjs carried the literal 35 for this and went red
 * the day #/group joined "Board Prep" - the same hand-copied-count mistake
 * declaredRoutes() above exists to prevent.
 */
export async function declaredNavRoutes(file = "web/index.html") {
  const html = await readFile(file, "utf8");
  const start = html.indexOf("const NAV_GROUPS = [");
  if (start < 0) throw new Error("declaredNavRoutes: NAV_GROUPS array not found in " + file);
  const endMatch = /\n\s*\];/.exec(html.slice(start));
  const block = html.slice(start, endMatch ? start + endMatch.index : start + 8000);
  const listed = [];
  for (const m of block.matchAll(/hashes:\s*\[([^\]]*)\]/g)) for (const h of m[1].matchAll(/"(#\/[a-z0-9-]+)"/g)) listed.push(h[1]);
  const hiddenMatch = /const NAV_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(html);
  if (!hiddenMatch) throw new Error("declaredNavRoutes: NAV_HIDDEN set not found in " + file);
  const hidden = [...hiddenMatch[1].matchAll(/"(#\/[a-z0-9-]+)"/g)].map((m) => m[1]);
  const routes = new Set((await declaredRoutes(file)).hashes);
  const unknown = listed.filter((h) => !routes.has(h));
  const hashes = listed.filter((h) => routes.has(h) && !hidden.includes(h));
  return { count: hashes.length, hashes, listed, hidden, unknown };
}
