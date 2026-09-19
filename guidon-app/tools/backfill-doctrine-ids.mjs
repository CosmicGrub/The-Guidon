/**
 * Gives every doctrine entry without an `id` a deterministic, unique one
 * ("doc-" + slug(title)), so that lint-board-taxonomy's rule (a) - every
 * doctrine record has a non-empty, unique id - holds, and any future
 * id-based feature (pillar/regulation filters, deep links) has something
 * to key on. First run (2026-09-15) backfilled the 46 entries of one older
 * authoring batch that had never carried ids.
 *
 * id shape: lowercase, diacritics stripped, non-alphanumerics collapsed to
 * single hyphens, capped at 48 chars on a WORD boundary; a collision
 * (against existing ids and other new ones) gets a -2/-3 suffix.
 * Re-runnable: a run with nothing to do writes nothing and exits 0.
 */
import { fileURLToPath } from "node:url";
import { readSeed, writeSeed } from "./seed-io.mjs";

const SEED_PATH = fileURLToPath(new URL("../src/index.html", import.meta.url));
const { data } = readSeed(SEED_PATH);
const D = data.doctrine.entries;

const slug = (t) => {
  const full = String(t).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (full.length <= 48) return full;
  const cut = full.slice(0, 48);
  return (full[48] === "-" ? cut : cut.replace(/-[^-]*$/, "")).replace(/-+$/, "");
};

const taken = new Set(D.map((e) => e.id).filter(Boolean));
const noId = D.filter((e) => !(typeof e.id === "string" && e.id.trim()));
if (noId.length === 0) { console.log("nothing to do - every doctrine entry already has an id"); process.exit(0); }

for (const e of noId) {
  const base = "doc-" + slug(e.title);
  let id = base, n = 2;
  while (taken.has(id)) id = base + "-" + n++;
  taken.add(id);
  // Put id first so the on-disk key order matches every other entry.
  // The spread keeps a present-but-empty id ("", null, "   " - exactly what
  // the noId filter selects) and, as the LAST Object.assign source, would
  // clobber the freshly generated one: the tool reported success while lint
  // rule (a) still failed. Drop it first. (Review finding on PR #170; the
  // fix was pushed as ea1e79a and then lost when the older copy of this
  // file carried by #171 won the merge - restored here.)
  const rest = { ...e };
  delete rest.id;
  Object.keys(e).forEach((k) => delete e[k]);
  Object.assign(e, { id }, rest);
  console.log("  " + id.padEnd(52) + " <- " + rest.title);
}
console.log(`backfilled ${noId.length} doctrine id(s)`);
const r = writeSeed(data, SEED_PATH);
console.log(`wrote ${r.bytesWritten} bytes to ${r.path}`);
