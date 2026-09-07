/**
 * Study-group seat-name call sign (Chris, 2026-09-06): src/index.html's
 * onboarding wizard already had a curated, affectionate CALLSIGNS array
 * (~line 20228, private to profile.js's closure) and a "spin a random call
 * sign" dice mechanic for the last-name field. Neither was reachable from
 * src/app-modules/studygroup.js. Meanwhile drawIdle()'s two seat-name
 * inputs (Host's `nameIn`, Join's `jname`) pre-filled from G.profile's own
 * displayName() - the real, persistent, on-device profile name - which a
 * study room broadcasts to a stranger on the same Wi-Fi/hotspot in a way a
 * private on-device profile never does.
 *
 * This suite is the RED-then-GREEN baseline for that fix:
 *   BEFORE: no G.profile.CALLSIGNS export exists, drawIdle() has no
 *           ".sg-name-dice" button anywhere, and both seat-name fields
 *           default to displayName() ("GUEST" for a guest profile, which is
 *           never itself a CALLSIGNS entry) - every assertion below that
 *           depends on the dice or the callsign default fails or throws.
 *   AFTER:  G.profile.CALLSIGNS is the one shared source (exported off the
 *           same profile.js module the onboarding wizard's own dice reads),
 *           both seat-name panels get their own dice button with an
 *           independent no-repeat-consecutive guard and the same
 *           util.announce() accessibility call the onboarding dice uses,
 *           and the default value of both fields is a freshly spun call
 *           sign rather than the real profile name - only on that field's
 *           true first look; a later re-render (e.g. the mode toggle)
 *           never clobbers a value already typed or spun.
 *
 * Static checks (no browser) come first:
 *   (1) exactly one `const CALLSIGNS = [` literal in the src/ tree (the
 *       source of truth - src/index.html - the same convention
 *       tools/lint-patterns.mjs itself uses; generated copies under
 *       dist/, web/, android/ are build output, not source, and are not
 *       part of this invariant)
 *   (2) src/index.html exports it as G.profile.CALLSIGNS
 *   (3) src/app-modules/studygroup.js reads G.profile.CALLSIGNS - no
 *       second array literal of its own
 *   (4) no navigator.userAgent / device-model string anywhere in
 *       studygroup.js, nor inside profile.js's own module slice of
 *       src/index.html - confirming the negative Chris asked for
 *   (5) MAX_NAME assertion: every CALLSIGNS entry's length is measured
 *       (not eyeballed) against room-schema.js's real MAX_NAME
 *
 * Then one Chromium (room-harness's openRoom, which enforces "one browser
 * at a time" itself) boots a single Guest page on #/group with the
 * study-groups switch on and drives drawIdle() for real:
 *   (6) both seat-name inputs get exactly one ".sg-name-dice" sibling
 *   (7) the default value of each is a G.profile.CALLSIGNS member, not
 *       G.profile.cached().displayName() ("GUEST")
 *   (8) each dice button's own no-repeat-consecutive guard, spun 15 times
 *   (9) util.announce()'s #a11y-live region gets "Call sign: <pick>" after
 *       a spin, same as onboarding's own dice
 *   (10) typing into Host's seat name, then toggling the room mode
 *        (forces a full drawIdle() re-render), does not clobber it
 *   (11) the two panels' guards are independent: spinning Host's dice
 *        repeatedly never changes Join's current value
 *
 * Usage: node tools/test-studygroup-callsigns.mjs
 *        GUIDON_TEST_CONCURRENCY-aware like every other suite - launches
 *        exactly one Chromium, via room-harness's own guard.
 */
import { readFile } from "node:fs/promises";
import { serve } from "./server.mjs";
import { openRoom, close } from "./room-harness.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// ---------------------------------------------------------------------
// Static checks
// ---------------------------------------------------------------------
const indexSrc = await readFile("src/index.html", "utf-8");
const sgSrc = await readFile("src/app-modules/studygroup.js", "utf-8");
const schemaSrc = await readFile("src/app-modules/room-schema.js", "utf-8");

const LITERAL_RE = /const\s+CALLSIGNS\s*=\s*\[/g;
const literalCount = (indexSrc.match(LITERAL_RE) || []).length;
literalCount === 1
  ? ok("(1) exactly one `const CALLSIGNS = [` literal in src/index.html")
  : bad("(1) expected exactly 1 CALLSIGNS array literal in src/index.html, found " + literalCount);
(sgSrc.match(LITERAL_RE) || []).length === 0
  ? ok("(1) studygroup.js declares no CALLSIGNS array literal of its own")
  : bad("(1) studygroup.js has its own `const CALLSIGNS = [` - a second copy");

/CALLSIGNS\s*:\s*CALLSIGNS\s*,/.test(indexSrc)
  ? ok("(2) src/index.html exports the array as G.profile.CALLSIGNS")
  : bad("(2) no `CALLSIGNS: CALLSIGNS,` property found on the G.profile export object");

/G\.profile\s*&&\s*G\.profile\.CALLSIGNS/.test(sgSrc) || /G\.profile\.CALLSIGNS/.test(sgSrc)
  ? ok("(3) studygroup.js reads G.profile.CALLSIGNS")
  : bad("(3) studygroup.js never references G.profile.CALLSIGNS");

// Strip comments before scanning: this file's own doc-comments legitimately
// SAY "navigator.userAgent" while explaining that the code never touches
// it (see spinCallsign() above) - the signal worth failing on is live code
// reading a device-identifying string, not prose that names what it avoids.
const sgCodeOnly = sgSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/navigator\s*\.\s*userAgent|Build\s*\.\s*MODEL|navigator\.platform|navigator\.appVersion/i.test(sgCodeOnly)
  ? bad("(4) studygroup.js references a device-identifying string near the seat-name feature")
  : ok("(4) studygroup.js never touches navigator.userAgent / a device-model string");

// Isolate profile.js's own module slice of src/index.html (where CALLSIGNS
// and both onboarding dice call sites live) rather than scanning the whole
// ~20k-line file, which legitimately touches `navigator` elsewhere
// (capability checks unrelated to a seat name).
const profileStart = indexSrc.indexOf("/* ==== js/profile.js ==== */");
const profileEnd = indexSrc.indexOf("// END profile.js");
if (profileStart === -1 || profileEnd === -1 || profileEnd <= profileStart) {
  bad("(4) could not isolate the profile.js module slice of src/index.html to check for device-identifying strings");
} else {
  const profileSlice = indexSrc.slice(profileStart, profileEnd);
  /navigator\s*\.\s*userAgent|Build\s*\.\s*MODEL|navigator\.platform|navigator\.appVersion/i.test(profileSlice)
    ? bad("(4) profile.js's module slice (CALLSIGNS + the onboarding dice) references a device-identifying string")
    : ok("(4) profile.js's module slice never touches navigator.userAgent / a device-model string");
}

const maxNameMatch = schemaSrc.match(/var\s+MAX_NAME\s*=\s*(\d+)\s*;/);
if (!maxNameMatch) {
  bad("(5) could not find `var MAX_NAME = N;` in src/app-modules/room-schema.js");
} else {
  const MAX_NAME = Number(maxNameMatch[1]);
  ok("(5) room-schema.js MAX_NAME = " + MAX_NAME);
  const arrMatch = indexSrc.match(/const\s+CALLSIGNS\s*=\s*\[([\s\S]*?)\];/);
  if (!arrMatch) {
    bad("(5) could not extract the CALLSIGNS array literal body from src/index.html");
  } else {
    const entries = Array.from(arrMatch[1].matchAll(/"([^"]*)"/g)).map((m) => m[1]);
    if (!entries.length) {
      bad("(5) extracted zero CALLSIGNS entries - regex mismatch, not an empty list");
    } else {
      const measured = entries.map((s) => ({ s, len: s.length }));
      const longest = measured.reduce((a, b) => (b.len > a.len ? b : a));
      const over = measured.filter((e) => e.len > MAX_NAME);
      console.log("  INFO  " + entries.length + " CALLSIGNS entries measured; longest is \"" + longest.s + "\" at " + longest.len + " chars (MAX_NAME " + MAX_NAME + ")");
      over.length === 0
        ? ok("(5) every CALLSIGNS entry is within MAX_NAME (" + MAX_NAME + ") - longest measured at " + longest.len)
        : bad("(5) " + over.length + " CALLSIGNS entr" + (over.length === 1 ? "y" : "ies") + " exceed MAX_NAME: " + over.map((e) => e.s + " (" + e.len + ")").join(", "));
    }
  }
}

// ---------------------------------------------------------------------
// Live browser checks
// ---------------------------------------------------------------------
const { server, url } = await serve("web");
let room = null;
try {
  room = await openRoom(url, 1, { hash: "#/group", studyGroups: true });
  const P = room.pages[0];

  const state = await P.evaluate(() => ({
    hasExport: !!(window.G && G.profile && Array.isArray(G.profile.CALLSIGNS)),
    callsigns: (window.G && G.profile && G.profile.CALLSIGNS) || [],
    displayName: (window.G && G.profile && G.profile.cached && G.profile.cached() && G.profile.cached().displayName) || null,
  }));
  state.hasExport
    ? ok("G.profile.CALLSIGNS is reachable in the running page (" + state.callsigns.length + " entries)")
    : bad("G.profile.CALLSIGNS is not an array in the running page");
  state.displayName === "GUEST"
    ? ok("Guest profile displayName() is \"GUEST\" (the real-name baseline these fields must NOT default to)")
    : bad("expected the guest profile's displayName() to be \"GUEST\", got " + JSON.stringify(state.displayName));

  const hostDiceCount = await P.locator(".sg-name-dice").count();
  // The host panel's dice is the FIRST .sg-name-dice in DOM order (Host a
  // room is built before Join a room in drawIdle()); the join panel's is
  // the second. Verified structurally below rather than assumed.
  hostDiceCount === 2
    ? ok("(6) exactly two .sg-name-dice buttons are present (one per seat-name panel)")
    : bad("(6) expected exactly 2 .sg-name-dice buttons in drawIdle(), found " + hostDiceCount);

  const hostNameVal = await P.locator(".sg-name").inputValue();
  const joinNameVal = await P.locator(".sg-join-name").inputValue();
  (state.callsigns.includes(hostNameVal) && hostNameVal !== state.displayName)
    ? ok("(7) Host seat-name defaults to a call sign (\"" + hostNameVal + "\"), not displayName()")
    : bad("(7) Host seat-name default \"" + hostNameVal + "\" is not a CALLSIGNS entry distinct from displayName()");
  (state.callsigns.includes(joinNameVal) && joinNameVal !== state.displayName)
    ? ok("(7) Join seat-name defaults to a call sign (\"" + joinNameVal + "\"), not displayName()")
    : bad("(7) Join seat-name default \"" + joinNameVal + "\" is not a CALLSIGNS entry distinct from displayName()");

  // (8) No-repeat-consecutive guard, spun for real, per panel.
  async function spinSeries(diceLocator, nameLocator, n) {
    const seen = [];
    for (let i = 0; i < n; i++) {
      await diceLocator.click();
      seen.push(await nameLocator.inputValue());
    }
    return seen;
  }
  const hostDice = P.locator(".sg-name-dice").nth(0);
  const joinDice = P.locator(".sg-name-dice").nth(1);
  if (hostDiceCount === 2) {
    const hostSpins = await spinSeries(hostDice, P.locator(".sg-name"), 15);
    const hostAllValid = hostSpins.every((v) => state.callsigns.includes(v));
    let hostNoRepeat = true;
    for (let i = 1; i < hostSpins.length; i++) if (hostSpins[i] === hostSpins[i - 1]) hostNoRepeat = false;
    (hostAllValid && hostNoRepeat)
      ? ok("(8) Host dice: 15 spins, every pick a CALLSIGNS entry, no two consecutive picks equal")
      : bad("(8) Host dice spins failed the no-repeat/validity check: " + JSON.stringify(hostSpins));

    const joinSpins = await spinSeries(joinDice, P.locator(".sg-join-name"), 15);
    const joinAllValid = joinSpins.every((v) => state.callsigns.includes(v));
    let joinNoRepeat = true;
    for (let i = 1; i < joinSpins.length; i++) if (joinSpins[i] === joinSpins[i - 1]) joinNoRepeat = false;
    (joinAllValid && joinNoRepeat)
      ? ok("(8) Join dice: 15 spins, every pick a CALLSIGNS entry, no two consecutive picks equal")
      : bad("(8) Join dice spins failed the no-repeat/validity check: " + JSON.stringify(joinSpins));

    // (9) accessibility announce - same #a11y-live region the onboarding
    // dice uses, same "Call sign: <pick>" text.
    await hostDice.click();
    const lastHostVal = await P.locator(".sg-name").inputValue();
    await P.waitForTimeout(120);
    const live = await P.evaluate(() => { const r = document.getElementById("a11y-live"); return r ? r.textContent : null; });
    live === "Call sign: " + lastHostVal
      ? ok("(9) #a11y-live announces \"Call sign: " + lastHostVal + "\" after a Host spin")
      : bad("(9) expected #a11y-live to read \"Call sign: " + lastHostVal + "\", got " + JSON.stringify(live));

    // (10) typed value survives an unrelated re-render (the mode toggle).
    await P.locator(".sg-name").fill("MYTYPEDNAME");
    await P.getByRole("button", { name: "Mock Board Live" }).click();
    const afterToggle = await P.locator(".sg-name").inputValue();
    afterToggle === "MYTYPEDNAME"
      ? ok("(10) a typed seat name survives a mode-toggle re-render of drawIdle()")
      : bad("(10) mode toggle clobbered a typed seat name: expected \"MYTYPEDNAME\", got " + JSON.stringify(afterToggle));
    // Restore relay mode for a clean state before the next check.
    await P.getByRole("button", { name: "Rapid-Fire relay" }).click();

    // (11) independence: Join's current value must not move while Host's
    // dice is clicked repeatedly.
    const joinBefore = await P.locator(".sg-join-name").inputValue();
    for (let i = 0; i < 5; i++) await hostDice.click();
    const joinAfter = await P.locator(".sg-join-name").inputValue();
    joinAfter === joinBefore
      ? ok("(11) Join's seat name is untouched by 5 Host-panel spins - independent guards")
      : bad("(11) Join's seat name changed from \"" + joinBefore + "\" to \"" + joinAfter + "\" after only spinning Host's dice");
  } else {
    bad("(8) skipped - no dice buttons to spin");
    bad("(9) skipped - no dice button to spin for the announce check");
    bad("(10) skipped - no dice button, so drawIdle() has not been fitted with the seat-name feature yet");
    bad("(11) skipped - no dice buttons to test guard independence");
  }

  if (room.noise[0].length) {
    bad("page errors/console errors during the run: " + JSON.stringify(room.noise[0]));
  } else {
    ok("no console or page errors during the run");
  }
} finally {
  await close();
  await server.close();
}

console.log(fails ? `\n${fails} FAILED` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
