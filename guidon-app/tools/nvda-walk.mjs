/**
 * Walks GUIDON flows in a REAL browser window with NVDA running, and records
 * what NVDA actually says at each step.
 *
 * Why a browser rather than the Tauri shell: NVDA reads Chromium natively, and
 * Playwright can put focus on a specific element deterministically instead of
 * tabbing blindly and hoping. The window is kept foreground because NVDA
 * follows the system focus - it will not announce a background window.
 *
 * Speech is read from NVDA's own debug log (%TEMP%\nvda.log), which records
 * every sequence as  Speaking [LangChangeCommand ('en'), 'text', ...]  even
 * with the "silence" synthesizer selected. So we get the exact words a user
 * would hear, in order, with no audio involved.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const LOG = `${process.env.TEMP}\\nvda.log`;
const OUT = "dist/nvda-walk.txt";
writeFileSync(OUT, "");

const logLines = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split(/\r?\n/) : []);

/** Extracts the spoken strings from NVDA's Speaking[...] entries since `from`. */
function speechSince(from) {
  const all = logLines();
  const out = [];
  for (const line of all.slice(from)) {
    if (!line.startsWith("Speaking [")) continue;
    // NVDA logs Python-repr style, which switches to DOUBLE quotes whenever the
    // string itself contains an apostrophe. Matching only single quotes split
    // "the leader's tool ..." mid-word and made a perfectly correct form
    // description look corrupted in the transcript. Match both quote styles.
    const texts = [...line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => (m[1] !== undefined ? m[1] : m[2]))
      .filter((t) => t && t !== "en");
    if (!texts.length) continue;
    const joined = texts.join(" | ");
    // Anything the OS says about notifications or other apps is not the app.
    if (/New notification from|Actions\. 1 of 1/.test(joined)) continue;
    out.push(joined);
  }
  return out;
}

function foreground() {
  // Raise the Chromium window so NVDA follows focus into it.
  try {
  return execFileSync("powershell", ["-NoProfile", "-Command", `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class F { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c); }
"@
$p = Get-Process chrome,chromium -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*GUIDON*" } | Select-Object -First 1
if($p){ [F]::ShowWindow($p.MainWindowHandle,9) | Out-Null; [F]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; "focused: " + $p.MainWindowTitle } else { "no GUIDON window" }
`], { encoding: "utf8" });
  } catch (e) { return "foreground failed: " + String(e.message).slice(0, 120); }
}

const steps = [];
async function step(label, fn, settle = 1800) {
  // Re-assert foreground before EVERY step, not just once at the top of the
  // walk. A single grab at startup was not enough: on a real, shared
  // desktop, anything else that steals focus mid-walk (another app's
  // window, an editor, a notification) goes completely undetected - NVDA
  // silently follows the new foreground window and the transcript fills
  // with THAT window's content instead of erroring. Found the hard way: a
  // walk's "generate the DA 4856" step came back reading a code editor's
  // git-history UI, not the app, because focus had drifted several steps
  // earlier and nothing re-checked it.
  const fg = String(foreground()).trim();
  const fgOk = /^focused: .*GUIDON/i.test(fg);
  const before = logLines().length;
  await fn();
  await new Promise((r) => setTimeout(r, settle));
  const said = speechSince(before);
  steps.push({ label, said, foregroundFailed: !fgOk });
  const warn = fgOk ? [] : [`  !! foreground check failed before this step (${fg || "no output"}) - speech below may belong to another window`];
  const block = [`===== ${label} =====`, ...warn,
    ...(said.length ? said.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s}`) : ["  (nothing announced)"]), ""];
  appendFileSync(OUT, block.join("\n") + "\n", "utf8");
  console.log(block.join("\n"));
}

const { server, url } = await serve("web");
const browser = await chromium.launch({
  headless: false,
  args: ["--force-renderer-accessibility"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
console.log(String(foreground()).trim());
await page.waitForTimeout(1500);

/* Dismiss onboarding as a Guest so the app is in a normal studying state. */
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button, .ob-mode-card, [role=button], .click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1800);
console.log(String(foreground()).trim());
await page.waitForTimeout(800);

/* Navigate by hash rather than by clicking nav buttons. The first attempt
   matched ".nav button" by text and hit the COLLAPSIBLE GROUP HEADERS
   ("BOARD PREP", "ACCOUNT"), which expand a group instead of navigating - so
   the walk ended up in Settings and Author rather than Board and Forms. */
async function goto(hash, label) {
  await step(label, async () => {
    await page.evaluate((h) => { location.hash = h; }, hash);
  }, 2600);
}

/* ---------------- FLOW 2: a Board Drill card ---------------- */
await goto("#/board", "FLOW 2.1 - navigate to Board Prep");

await step("FLOW 2.2 - focus the flashcard", async () => {
  await page.evaluate(() => {
    // The view container is #route (id="route", class="view") - NOT "#view",
    // which does not exist. Selectors built on "#view" silently matched nothing,
    // focus never landed on the card, and Space/3 went nowhere - which read as
    // "the app announces nothing when you grade a card" when in fact it
    // announces correctly. The focusable card is .qz-wrap.
    const card = document.querySelector("#route .qz-wrap");
    if (card && card.focus) card.focus();
  });
}, 2200);

await step("FLOW 2.3 - press Space to flip the card", async () => {
  await page.keyboard.press("Space");
}, 3000);

await step("FLOW 2.4 - grade it: press 3 (Know It)", async () => {
  await page.keyboard.press("3");
}, 3000);

/* ---------------- FLOW 3: DA 4856 export ---------------- */
await goto("#/forms", "FLOW 3.1 - navigate to Forms");

await step("FLOW 3.2 - Tab through the first Forms controls", async () => {
  for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab"); await page.waitForTimeout(800); }
}, 1600);

await step("FLOW 3.3 - generate the DA 4856", async () => {
  await page.evaluate(async () => {
    try {
      await window.G.pdfAssets.ensure();
      G.util.announce("Generating DA Form 4856");
      const b = await window.G.pdf456.fill({ name: "Rivera, John A.", rank: "SPC" });
      const u = b instanceof Uint8Array ? b : new Uint8Array(b);
      G.util.announce("DA Form 4856 ready, " + u.length + " bytes");
    } catch (e) { G.util.announce("Export failed: " + e.message); }
  });
}, 3200);

/* ---- Probe: does navigating to a LARGE view dump the whole page? ---- */
await goto("#/settings", "PROBE - navigate to Settings (the largest view)");
await goto("#/home", "PROBE - navigate back to Home (a small view)");

await browser.close();
server.close();

console.log("\n================ SUMMARY ================");
let silent = 0;
let untrustworthy = 0;
for (const s of steps) {
  const flag = s.foregroundFailed ? "  [UNTRUSTED - foreground drifted]" : "";
  if (s.foregroundFailed) untrustworthy++;
  if (!s.said.length) { silent++; console.log(`  SILENT  ${s.label}${flag}`); }
  else console.log(`  spoke ${String(s.said.length).padStart(2)}  ${s.label}${flag}`);
}
if (untrustworthy) {
  console.log(`\n!! ${untrustworthy}/${steps.length} step(s) had a failed foreground check - do not treat their`);
  console.log("   results (silent OR spoken) as real findings. Re-run on a desktop with nothing");
  console.log("   else competing for focus, or run interactively so a human can confirm the target");
  console.log("   window stays frontmost throughout.");
}
console.log(`\n${steps.length - silent}/${steps.length} steps produced speech. Transcript: ${OUT}`);
