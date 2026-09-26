/**
 * Snapshot what the app really holds and shows for "What's new", so a change
 * to how the entries are stored can be proven to change nothing a Soldier
 * sees.
 *
 *   node tools/whats-new-snapshot.mjs <out-prefix>
 *       Opens BOTH built outputs (web/ through the test server, and
 *       dist/guidon-standalone.html straight from disk), and writes
 *         <prefix>-web-notes.json         G.whatsNew.RELEASE_NOTES as JSON text
 *         <prefix>-web-panel.html         the panel G.whatsNew.show() draws for a Soldier
 *         <prefix>-standalone-notes.json  (same two, for the single file)
 *         <prefix>-standalone-panel.html  who has skipped every release
 *   node tools/whats-new-snapshot.mjs --compare <prefix-a> <prefix-b>
 *       Byte-compares the four pairs and exits 1 on any difference.
 *
 * WHY THIS EXISTS. When every entry moved out of src/index.html and 14
 * per-release scripts into src/data/whats-new.json, the requirement was "no
 * change in what the app renders". This is that proof, kept: run it on a
 * build made BEFORE a change and on one made AFTER, then --compare. The
 * migration itself was proven this way - all four pairs byte-identical
 * (22 entries, 13,332 bytes of notes, 20,211 bytes of panel).
 *
 * Needs a finished build (npm run build); it reads web/ and dist/, never src/.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const KINDS = [["web", "notes.json"], ["web", "panel.html"], ["standalone", "notes.json"], ["standalone", "panel.html"]];
const file = (prefix, label, kind) => `${prefix}-${label}-${kind}`;
const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

async function snapshot(prefix) {
  for (const p of ["web/index.html", "dist/guidon-standalone.html"]) if (!existsSync(p)) { console.error(`whats-new-snapshot: ${p} is missing - run npm run build first`); process.exit(1); }
  const browser = await chromium.launch();
  const { server, url } = await serve("web");
  try {
    for (const [label, target] of [["web", url], ["standalone", pathToFileURL(path.resolve("dist", "guidon-standalone.html")).href]]) {
      const page = await (await browser.newContext()).newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(target, { waitUntil: "load" });
      await page.waitForFunction(() => !!(window.G && window.G.whatsNew && Array.isArray(window.G.whatsNew.RELEASE_NOTES)));
      const out = await page.evaluate(() => {
        const W = window.G.whatsNew;
        const notes = JSON.stringify(W.RELEASE_NOTES);
        // A Soldier who has skipped every release sees the longest panel there can be.
        W.show(W.missedSince("0.0.1", window.GUIDON_APP_VERSION));
        const box = document.querySelector(".whatsnew-box");
        return { notes, panel: box ? box.outerHTML : "", count: W.RELEASE_NOTES.length };
      });
      if (errors.length) console.error(`whats-new-snapshot: ${label} raised page errors: ${errors.join(" | ")}`);
      writeFileSync(file(prefix, label, "notes.json"), out.notes);
      writeFileSync(file(prefix, label, "panel.html"), out.panel);
      console.log(`${label.padEnd(10)} ${String(out.count).padStart(3)} entries   notes ${sha(out.notes)}   panel ${sha(out.panel)}`);
      await page.context().close();
    }
  } finally { await new Promise((r) => server.close(r)); await browser.close(); }
}

function compare(a, b) {
  let differ = 0;
  for (const [label, kind] of KINDS) {
    const fa = file(a, label, kind), fb = file(b, label, kind);
    if (!existsSync(fa) || !existsSync(fb)) { console.log(`MISSING    ${!existsSync(fa) ? fa : fb}`); differ++; continue; }
    const A = readFileSync(fa), B = readFileSync(fb);
    if (A.equals(B)) console.log(`IDENTICAL  ${label} ${kind} (${A.length} bytes, ${sha(A)})`);
    else { differ++; console.log(`DIFFERENT  ${label} ${kind} (${A.length} vs ${B.length} bytes)`); }
  }
  console.log(differ ? `\nwhats-new-snapshot: ${differ} of ${KINDS.length} differ` : `\nwhats-new-snapshot: all ${KINDS.length} identical`);
  process.exit(differ ? 1 : 0);
}

const args = process.argv.slice(2);
if (args[0] === "--compare" && args[1] && args[2]) compare(args[1], args[2]);
else if (args[0] && !args[0].startsWith("--")) await snapshot(args[0]);
else { console.error("usage: node tools/whats-new-snapshot.mjs <out-prefix>   |   --compare <prefix-a> <prefix-b>"); process.exit(1); }
