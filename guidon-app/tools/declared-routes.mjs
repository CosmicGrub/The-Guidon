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
