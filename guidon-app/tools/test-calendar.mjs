/**
 * Career Calendar: date arithmetic, urgency ordering, persistence.
 *
 * The whole value of this section is one calculation - "your weapons
 * qualification is 25 months old, which is worth zero promotion points" - so
 * the calculation gets a test rather than a glance.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/** YYYY-MM-DD for "n months before today", computed the same way a user would. */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(900);

const booted = await page.evaluate(() => ({
  heading: (document.querySelector("#view h2, main h2") || {}).textContent,
  dateInputs: document.querySelectorAll('input[type="date"]').length,
}));
booted.heading === "Career Calendar" ? ok("Career Calendar renders") : bad("heading was " + booted.heading);
booted.dateInputs >= 7 ? ok(`${booted.dateInputs} tracked date fields`) : bad("only " + booted.dateInputs + " date inputs");

/* The fixed anchors nobody enters must always be present. */
const anchors = await page.evaluate(() => document.body.textContent || "");
/Promotion month cut-off/.test(anchors) ? ok("26th-of-month promotion cut-off always shown") : bad("cut-off anchor missing");
/Credentialing Assistance resets/.test(anchors) ? ok("1 Oct CA fiscal-year reset always shown") : bad("CA reset anchor missing");

/** Sets one tracked date and returns the rendered "what is next" rows. */
async function setDate(label, value) {
  return page.evaluate(({ label, value }) => {
    const inp = document.querySelector(`input[type="date"][aria-label="${label}"]`);
    if (!inp) return { error: "no input for " + label };
    inp.value = value;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }, { label, value });
}

async function rowsNow() {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll(".card")].filter((c) => c.querySelector(".k") && c.querySelector(".v"));
    return cards.map((c) => ({
      label: c.querySelector(".k").textContent.trim(),
      value: c.querySelector(".v").textContent.trim(),
      border: c.style.borderLeftColor || c.style.borderLeft,
    }));
  });
}

// 25 months since qualification: past the 24-month validity, must read OVERDUE.
await setDate("Last weapons qualification", monthsAgo(25));
await page.waitForTimeout(500);
let rows = await rowsNow();
const wpnOver = rows.find((r) => /weapons qualification/i.test(r.label));
wpnOver && wpnOver.value === "OVERDUE"
  ? ok("weapons qual 25 months old reads OVERDUE (24-month rule)")
  : bad("expected OVERDUE, got " + JSON.stringify(wpnOver));

// 1 month since qualification: due in roughly 23 months, so plainly not urgent.
await setDate("Last weapons qualification", monthsAgo(1));
await page.waitForTimeout(500);
rows = await rowsNow();
const wpnOk = rows.find((r) => /weapons qualification/i.test(r.label));
const days = wpnOk ? parseInt(wpnOk.value, 10) : NaN;
days > 600 && days < 730
  ? ok(`weapons qual 1 month old is ${days} days out (~23 months, as expected)`)
  : bad("expected roughly 690 days, got " + JSON.stringify(wpnOk));

// An AFT 11 months old should be inside the 45-day amber window.
await setDate("Last record AFT", monthsAgo(11));
await page.waitForTimeout(500);
rows = await rowsNow();
const aft = rows.find((r) => /AFT/i.test(r.label));
const aftDays = aft ? parseInt(aft.value, 10) : NaN;
aftDays >= 0 && aftDays <= 45
  ? ok(`AFT 11 months old is ${aftDays} days out and flagged`)
  : bad("expected 0-45 days for an 11-month-old AFT, got " + JSON.stringify(aft));

/* Rows must be ordered by urgency, or the page is just a list. */
const ordered = await page.evaluate(() => {
  const vals = [...document.querySelectorAll(".card .v")].map((v) => v.textContent.trim());
  const nums = vals.map((t) => (t === "OVERDUE" ? -1 : parseInt(t, 10))).filter((n) => !isNaN(n));
  return nums.every((n, i) => i === 0 || nums[i - 1] <= n);
});
ordered ? ok("upcoming rows sorted soonest-first") : bad("rows are not in urgency order");

/* Persistence across a reload. */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(1000);
const persisted = await page.evaluate(() => {
  const inp = document.querySelector('input[type="date"][aria-label="Last record AFT"]');
  return inp ? inp.value : null;
});
persisted === monthsAgo(11)
  ? ok("entered dates survive a reload")
  : bad(`expected ${monthsAgo(11)} after reload, got ${persisted}`);

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CALENDAR: ${fails} FAILURE(S)` : "CALENDAR: all passed"));
process.exit(fails ? 1 : 0);
