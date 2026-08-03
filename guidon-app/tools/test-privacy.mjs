/**
 * The squad roster is the only data in GUIDON about people other than the user.
 * Backup files get emailed. This asserts the roster does not ride along by
 * default, and that including it is possible but deliberate.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil: "load" }); await page.waitForTimeout(700);

// Seed a roster entry and an ordinary user-data key.
await page.evaluate(async () => {
  await G.db.put("kv", { k: "guidon:leader:roster:v1", v: [{ rank:"SPC", name:"J.R.", counseled:"2026-06-01" }] });
  await G.db.put("kv", { k: "guidon:probe:mine", v: { ok: true } });
});
await page.waitForTimeout(400);

const def = await page.evaluate(async () => {
  const p = await G.backup.exportAll();
  const keys = (p.stores.kv || []).map(r => r.k);
  return { keys, excluded: p.excludedPrivateEntries, flag: p.includesOtherPeoplesData,
           raw: JSON.stringify(p) };
});
!def.keys.includes("guidon:leader:roster:v1")
  ? ok("default export EXCLUDES the squad roster") : bad("roster present in default export");
def.keys.includes("guidon:probe:mine")
  ? ok("default export still includes the user's own data") : bad("user data was dropped");
def.excluded === 1 ? ok("export reports 1 excluded private entry") : bad("excluded count = " + def.excluded);
def.flag === false ? ok("payload flags includesOtherPeoplesData = false") : bad("flag = " + def.flag);
!/J\.R\./.test(def.raw) ? ok("no roster initials anywhere in the default payload") : bad("initials leaked into payload");

const opt = await page.evaluate(async () => {
  const p = await G.backup.exportAll({ includePrivate: true });
  return { keys: (p.stores.kv||[]).map(r=>r.k), flag: p.includesOtherPeoplesData };
});
opt.keys.includes("guidon:leader:roster:v1")
  ? ok("opt-in export CAN include the roster when explicitly requested") : bad("opt-in did not include roster");
opt.flag === true ? ok("opt-in payload flags includesOtherPeoplesData = true") : bad("opt-in flag = " + opt.flag);

await page.evaluate(async () => { await G.db.del ? 0 : 0; });
await browser.close(); server.close();
console.log("\n" + (fails ? `PRIVACY: ${fails} FAILURE(S)` : "PRIVACY: all passed"));
process.exit(fails ? 1 : 0);
