/**
 * Reminders: the calendar file, and copy that does not point at a switch that is not there
 *
 * WHY THIS SUITE EXISTS: only the Android app can raise an alert for a reminder.
 * On the iPhone, in a browser, in the Windows app and in a saved file GUIDON
 * cannot speak while it is closed - yet the Reminders panel told every Soldier
 * to "Turn on Notifications in Settings", a switch that exists only on Android,
 * and Search offered a "Settings - Notifications" result that led nowhere. Now:
 *   - the copy says what is true on the device in your hand and names a control
 *     that exists ("Add to my calendar"), and Search only offers the Notifications
 *     switch where it is;
 *   - "Add to my calendar (.ics)" makes a calendar file ON THE DEVICE, on a tap, so
 *     the phone's or computer's own calendar can do the alerting.
 *
 * The file is checked with a parser written in THIS test from RFC 5545, not with
 * the code that makes it (a generator and a checker that share a mistake pass
 * each other): strict CRLF, unfolding, 75-octet lines, escaped text, UTC
 * DTSTAMP, all-day dates whose end is the NEXT day across month, year and leap
 * ends, stable UIDs, and the alarm. The privacy promise is checked on the bytes:
 * nothing the Soldier typed (label, note), no roster name, no profile name, and
 * no reminder id is anywhere in the file - only the kind of date and the date.
 *
 * Reminders made from the leader roster are NOT in the file (the same test the default
 * backup uses: the "leader" stamp, or for older unstamped ones the exact label a roster
 * button wrote), and the copy says so. On Android a backed-out share sheet leaves the
 * file written but not shared, and the screen says that instead of "ready".
 */
import { readFileSync } from "node:fs";
import { bootApp, check, finish, waitForRoute, clickWhenStable, until, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

/* ------------------------------------------------------------------ the checker */
// Strict on purpose: a bare LF, an overlong line, an unterminated component all throw.
function parseIcs(text) {
  if (/(^|[^\r])\n/.test(text) || /\r(?!\n)/.test(text)) throw new Error("a line break is not CRLF");
  const physical = text.split("\r\n");
  if (physical.pop() !== "") throw new Error("the file does not end with CRLF");
  const longest = physical.reduce((m, l) => Math.max(m, Buffer.byteLength(l, "utf8")), 0);
  const lines = [];
  for (const l of physical) {
    if (/^[ \t]/.test(l)) {
      if (!lines.length) throw new Error("a continuation line with nothing to continue");
      lines[lines.length - 1] += l.slice(1);
    } else lines.push(l);
  }
  const root = { name: "ROOT", props: [], children: [] };
  const stack = [root];
  for (const l of lines) {
    const m = /^([A-Za-z0-9-]+)((?:;[^:;=]+=(?:"[^"]*"|[^;:"]*))*):(.*)$/.exec(l);
    if (!m) throw new Error("not a content line: " + JSON.stringify(l));
    const name = m[1].toUpperCase();
    if (name === "BEGIN") { const c = { name: m[3].toUpperCase(), props: [], children: [] }; stack[stack.length - 1].children.push(c); stack.push(c); continue; }
    if (name === "END") {
      const top = stack.pop();
      if (!top || top.name !== m[3].toUpperCase()) throw new Error("END:" + m[3] + " does not close " + (top && top.name));
      continue;
    }
    const params = {};
    for (const p of m[2].split(";").filter(Boolean)) { const i = p.indexOf("="); params[p.slice(0, i).toUpperCase()] = p.slice(i + 1); }
    stack[stack.length - 1].props.push({ name, params, value: m[3] });
  }
  if (stack.length !== 1) throw new Error("a component is never closed");
  return { root, longest };
}
const prop = (c, n) => c.props.find((p) => p.name === n);
const unescapeText = (v) => v.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
// Independent date arithmetic: the day after YYYYMMDD, by UTC calendar.
function nextDay(yyyymmdd) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + 1));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
const compact = (iso) => iso.replace(/-/g, "");
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/* ------------------------------------------------------------------ boot */
const requests = [];
const boot = await bootApp({
  viewport: { width: 1280, height: 900 },
  profile: { ...PERSONAL_PROFILE },
  beforeLoad: async ({ page }) => { page.on("request", (r) => requests.push(r.url())); },
});
const { page, noise } = boot;
const origins = new Set([new URL(boot.url).origin]);

// Dates in the FUTURE (the file lists today and later), chosen to sit on the ends that break date maths.
const now = new Date();
const Y = now.getFullYear() + 1;
const leap = (() => { let y = Y; while (!(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) y++; return y; })();
const day = (y, m, d) => y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
// The first Sunday of November (US clocks go back that night): in Los Angeles that day is 25 hours
// long, so a calendar that finds "the next day" by adding 24 hours lands on the same date.
const fallBackSunday = (() => { const d = new Date(Date.UTC(Y, 10, 1)); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1); return day(Y, 11, d.getUTCDate()); })();
// Three days back, not one: in a clock set to the far side of the date line "yesterday" can still be today.
const past = (() => { const d = new Date(now); d.setDate(d.getDate() - 3); return iso(d); })();
const SECRETS = ["Doe", "Smith", "John", "555", "1-2 INF", "4856", "TESTKIT", "rSECRET1", "rSECRET2"];
// What of SECRETS is in a file's bytes. A UID is a hash (hex digits) of a reminder id, and a reminder made on the
// screen has a RANDOM id - so its UID spells a short digit string like "555" or "4856" by chance (about 1 file in 40
// with the old whole-file scan). The all-digit entries are therefore looked for with the UID values blanked out; every
// other entry (no hex digit can spell them) and every other byte is scanned as before, and the UIDs themselves are held
// to their exact shape (a plain hash), so an id written into one would still be caught.
const secretsIn = (text) => {
  const noUids = text.replace(/^UID:.*$/gm, "UID:");
  return SECRETS.filter((x) => (/^\d+$/.test(x) ? noUids : text).includes(x));
};
const uidsAreHashes = (text) => [...text.matchAll(/^UID:(.*)$/gm)].every((m) => /^guidon-[0-9a-f]{16}@guidon\.invalid$/.test(m[1]));
const FIXTURE = [
  { id: "rSECRET1", kind: "board", label: "Promo board with SSG Doe, A. (1-2 INF)", note: "Call 555-0100; bring DA 4856", date: day(Y, 10, 31) },
  { id: "rSECRET2", kind: "counseling", label: "Counsel SSG Smith, John", note: "", date: day(Y, 12, 31) },
  { id: "rb", kind: "weapons", label: "Range day with the third squad", date: day(leap, 2, 28) },
  { id: "rc", kind: "acft", label: "AFT", date: day(leap, 2, 29) },
  { id: "rd", kind: "pt", label: "PT: Strength session", date: day(Y, 4, 30) },
  { id: "re", kind: "banana", label: "Unknown kind", date: day(Y, 6, 15) },
  { id: "rf", kind: "__proto__", label: "Prototype kind", date: day(Y, 7, 1) },
  { id: "rj", kind: "other", label: "Clocks go back", date: fallBackSunday },    // the day a US clock repeats an hour
  { id: "rg", kind: "board", label: "Three days ago", date: past },            // past: not exported
  { id: "rh", kind: "other", label: "Not a date", date: "2031-13-45" },        // not a date: not exported
  { id: "ri", kind: "ets", label: "No date", date: "" },                       // no date: not exported
];
const EXPECTED = { // the events that must come out, by date, with the generic title for the kind
  [day(Y, 10, 31)]: "GUIDON: Promotion board", [day(Y, 12, 31)]: "GUIDON: Counseling follow-up due",
  [day(leap, 2, 28)]: "GUIDON: Weapons qualification due", [day(leap, 2, 29)]: "GUIDON: Fitness test due (ACFT / AFT)",
  [day(Y, 4, 30)]: "GUIDON: PT session", [day(Y, 6, 15)]: "GUIDON: Date to remember", [day(Y, 7, 1)]: "GUIDON: Date to remember",
  [fallBackSunday]: "GUIDON: Date to remember",
};
const N = Object.keys(EXPECTED).length; // how many events must come out

/* ------------------------------------------------------------------ the file */
const built = await page.evaluate((list) => {
  const a = window.G.reminders.buildIcs(list, new Date(Date.UTC(2031, 0, 2, 3, 4, 5)));
  const b = window.G.reminders.buildIcs(list, new Date(Date.UTC(2031, 5, 9, 7, 8, 9)));
  return { a, b };
}, FIXTURE);

let cal, longest;
try { ({ root: cal, longest } = parseIcs(built.a.text)); cal = cal.children[0]; check(true, "the file parses as RFC 5545: CRLF line breaks, unfolds, components all closed"); }
catch (e) { check(false, "", "the file does not parse: " + e.message); cal = { props: [], children: [] }; longest = 0; }
check(cal.name === "VCALENDAR" && prop(cal, "VERSION") && prop(cal, "VERSION").value === "2.0" && !!prop(cal, "PRODID"),
  "it is a VCALENDAR, version 2.0, with a PRODID", () => JSON.stringify(cal.props));
const events = cal.children.filter((c) => c.name === "VEVENT");
check(built.a.events === N && events.length === N,
  "exactly the " + N + " upcoming dated reminders became events (past, not-a-date and no-date ones left out)", () => "events: " + built.a.events + " / parsed " + events.length);
check(longest <= 75, "no line is longer than 75 octets", () => "longest line is " + longest + " octets");

const byStart = {};
events.forEach((e) => { const s = prop(e, "DTSTART"); if (s) byStart[s.value] = e; });
let datesOk = true, endsOk = true, titlesOk = true, stampOk = true, allDay = true, alarmOk = true;
const detail = [];
for (const [isoDate, title] of Object.entries(EXPECTED)) {
  const e = byStart[compact(isoDate)];
  if (!e) { datesOk = false; detail.push("missing " + isoDate); continue; }
  const s = prop(e, "DTSTART"), end = prop(e, "DTEND"), sum = prop(e, "SUMMARY"), st = prop(e, "DTSTAMP"), tr = prop(e, "TRANSP");
  if (s.params.VALUE !== "DATE" || !/^\d{8}$/.test(s.value)) { allDay = false; detail.push("DTSTART not a DATE " + s.value); }
  if (!end || end.params.VALUE !== "DATE" || end.value !== nextDay(compact(isoDate))) { endsOk = false; detail.push(isoDate + " ends " + (end && end.value) + ", expected " + nextDay(compact(isoDate))); }
  if (!sum || unescapeText(sum.value) !== title) { titlesOk = false; detail.push(isoDate + " titled " + (sum && sum.value)); }
  if (!st || st.value !== "20310102T030405Z") { stampOk = false; detail.push("DTSTAMP " + (st && st.value)); }
  const al = e.children.find((c) => c.name === "VALARM");
  if (!al || !prop(al, "ACTION") || prop(al, "ACTION").value !== "DISPLAY" || !prop(al, "TRIGGER") || prop(al, "TRIGGER").value !== "PT9H" || !prop(al, "DESCRIPTION")) { alarmOk = false; detail.push(isoDate + " alarm " + JSON.stringify(al && al.props)); }
  if (!tr || tr.value !== "TRANSPARENT") { detail.push(isoDate + " blocks the day"); titlesOk = false; }
}
check(datesOk, "every expected date is there, as a whole-day event on its own day", () => detail.join("; "));
check(allDay, "each event is an all-day event (DTSTART;VALUE=DATE, no time of day)", () => detail.join("; "));
check(endsOk, "each all-day event ends the NEXT day, including Oct 31, Apr 30, Dec 31 and both Feb 28 and Feb 29 of a leap year", () => detail.join("; "));
check(titlesOk, "each title is the generic one for its kind (an unknown kind, even \"__proto__\", is just \"Date to remember\"), and nothing blocks the day", () => detail.join("; "));
check(stampOk, "DTSTAMP is the moment of export in UTC", () => detail.join("; "));
check(alarmOk, "each event carries the calendar's own alert for 9 in the morning on the day", () => detail.join("; "));

// Privacy, on the bytes: nothing typed, no name, no id.
const leaked = secretsIn(built.a.text);
check(leaked.length === 0 && uidsAreHashes(built.a.text), "nothing the Soldier typed, no roster name, no profile name and no reminder id is anywhere in the file",
  () => "found in the file: " + JSON.stringify(leaked) + (uidsAreHashes(built.a.text) ? "" : " (and a UID that is not a plain hash)"));

// Stable and unique UIDs.
const uidsA = [...built.a.text.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
const uidsB = [...built.b.text.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
check(JSON.stringify(uidsA) === JSON.stringify(uidsB) && uidsA.length === N,
  "the same reminders give the same UIDs on a second export (opening a newer file updates the calendar, it does not add a copy)", () => JSON.stringify([uidsA, uidsB]));
check(new Set(uidsA).size === N && uidsA.every((u) => /^guidon-[0-9a-f]{16}@guidon\.invalid$/.test(u)),
  "the UIDs are all different, and are not the reminder ids", () => JSON.stringify(uidsA));
check(JSON.stringify(parseIcs(built.b.text).root.children[0].children.map((c) => prop(c, "DTSTAMP").value)) === JSON.stringify(new Array(N).fill("20310609T070809Z")),
  "only DTSTAMP changes between two exports");

// The same dates in any time zone: a date typed as 2028-02-29 is that whole day whether the
// clock is set to the far west (UTC-12), the far east (UTC+14) or in between. (Date maths done
// in UTC, or by adding 24 hours, slips a day in some of these.)
const wantPairs = Object.keys(EXPECTED).map((d) => compact(d) + ">" + nextDay(compact(d))).sort();
for (const tz of ["Etc/GMT+12", "Pacific/Kiritimati", "America/Los_Angeles"]) {
  const s = await boot.openSession({ viewport: { width: 412, height: 915 }, noise, contextOptions: { timezoneId: tz },
    beforeLoad: async ({ page: p }) => { p.on("request", (r) => requests.push(r.url())); } });
  origins.add(new URL(s.url).origin);
  const text = await s.page.evaluate((list) => window.G.reminders.buildIcs(list, new Date(Date.UTC(2031, 0, 2, 3, 4, 5))).text, FIXTURE);
  const pairs = parseIcs(text).root.children[0].children.filter((c) => c.name === "VEVENT")
    .map((e) => prop(e, "DTSTART").value + ">" + prop(e, "DTEND").value).sort();
  check(JSON.stringify(pairs) === JSON.stringify(wantPairs), "in a clock set to " + tz + " every date is the same whole day, ending the next",
    () => JSON.stringify({ got: pairs, want: wantPairs }));
}

// Folding and escaping, on their own, with text that would break a careless one.
const edge = await page.evaluate(() => {
  const long = "Counseling, follow-up; due \\ today é—😀 ".repeat(12);
  return { long, esc: window.G.reminders._icsEscape("a,b;c\\d\ne"), folded: window.G.reminders._icsFold("SUMMARY:" + long) };
});
const foldedLines = edge.folded.split("\r\n");
check(foldedLines.length > 1 && foldedLines.every((l) => Buffer.byteLength(l, "utf8") <= 75),
  "a long line is folded so no physical line is over 75 octets", () => JSON.stringify(foldedLines.map((l) => Buffer.byteLength(l, "utf8"))));
check(foldedLines.slice(1).every((l) => l.startsWith(" ")) && foldedLines.map((l, i) => (i ? l.slice(1) : l)).join("") === "SUMMARY:" + edge.long,
  "unfolding the folded line gives back exactly the original, multi-byte characters whole");
check(unescapeText(edge.esc) === "a,b;c\\d\ne" && !/(^|[^\\])[,;]/.test(edge.esc.replace(/\\\\/g, "")),
  "comma, semicolon, backslash and a line break are escaped, and an independent reader gets the original text back", () => edge.esc);

/* ------------------------------------------------------------------ through the real screen */
await page.evaluate(async (list) => {
  for (const r of list) await window.G.reminders.add({ kind: r.kind, label: r.label, date: r.date, note: r.note || "" });
}, FIXTURE.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
// Reminders the leader roster made: one stamped, one older and unstamped whose label still matches a roster entry.
// Neither may reach the file, so the "exactly N events" check on the saved file below proves they were left out.
const ROSTER_DAYS = [day(Y, 3, 3), day(Y, 3, 4)];
// ...and two the Soldier TYPED, using a roster entry's exact words in the label: not the roster's (one has another kind, one
// has a note - the roster's button writes neither), so they are the Soldier's own dates and DO go in the file.
const LOOKALIKE_DAYS = [day(Y, 3, 5), day(Y, 3, 6)];
await page.evaluate(async (args) => {
  const { days, lookalikes } = args;
  await window.G.db.put("kv", { k: "guidon:leader:roster:v1", v: [{ rank: "SGT", name: "XROSTER" }] });
  await window.G.reminders.add({ kind: "counseling", label: "Counsel SGT XROSTER", date: days[0], source: "leader" });
  await window.G.reminders.add({ kind: "acft", label: "Schedule AFT for SGT XROSTER", date: days[1] });   // no stamp: an older reminder
  await window.G.reminders.add({ kind: "board", label: "Counsel SGT XROSTER", date: lookalikes[0] });       // typed: the right words, the wrong kind
  await window.G.reminders.add({ kind: "counseling", label: "Counsel SGT XROSTER", date: lookalikes[1], note: "bring the packet" });   // typed: the right kind, but a note
}, { days: ROSTER_DAYS, lookalikes: LOOKALIKE_DAYS });
const NS = N + LOOKALIKE_DAYS.length;   // the file from the screen: the fixture's dates plus the two typed look-alikes
await waitForRoute(page, "#/profile", { ready: ".rem-calendar button" });
const calCopy = await page.evaluate(() => (document.querySelector(".rem-calendar p.hint") || {}).textContent || "");
check(/Reminders you made from the leader roster are not included\./.test(calCopy), "the calendar section says reminders made from the leader roster are not included", () => calCopy);
const hint = await page.evaluate(() => (document.querySelector(".rem-h").nextElementSibling || {}).textContent || "");
check(/Add to my calendar/.test(hint) && !/Notifications in Settings/.test(hint),
  "on a browser the Reminders hint names the calendar button and does not point at a Notifications switch", () => hint);
const btnText = await page.locator(".rem-calendar button").first().textContent();
check(/Add to my calendar/.test(btnText), "the button the hint names is there: \"" + btnText.trim() + "\"");

const downloadP = page.waitForEvent("download");
await clickWhenStable(page, page.locator(".rem-calendar button").first());
const dl = await downloadP;
check(dl.suggestedFilename() === "guidon-dates.ics", "the tap saves a file named guidon-dates.ics", () => dl.suggestedFilename());
const onDisk = readFileSync(await dl.path(), "utf8");
let shown;
try { shown = parseIcs(onDisk); } catch (e) { shown = null; check(false, "", "the saved file does not parse: " + e.message); }
const shownEvents = shown ? shown.root.children[0].children.filter((c) => c.name === "VEVENT") : [];
check(shownEvents.length === NS && shown.longest <= 75, "the saved file parses and holds the " + NS + " upcoming dates (the fixture's " + N + ", and the two typed look-alikes of a roster label)", () => "events: " + shownEvents.length);
const leakedUi = secretsIn(onDisk).concat(["Promo board", "Range day", "third squad", "Unknown kind", "Prototype kind", "Strength session", "XROSTER"].filter((x) => onDisk.includes(x)));
const rosterDatesIn = ROSTER_DAYS.filter((d) => onDisk.includes("DTSTART;VALUE=DATE:" + compact(d)));
check(rosterDatesIn.length === 0, "neither roster reminder (the stamped one, nor the older one that looks exactly like the roster button's) is in the saved file", () => "roster dates found: " + JSON.stringify(rosterDatesIn));
const lookalikeDatesIn = LOOKALIKE_DAYS.filter((d) => onDisk.includes("DTSTART;VALUE=DATE:" + compact(d)));
check(lookalikeDatesIn.length === LOOKALIKE_DAYS.length, "...but both dates the Soldier typed with a roster entry's words in the label ARE in it (a different kind, a note: not the roster's)", () => "look-alike dates found: " + JSON.stringify(lookalikeDatesIn) + " of " + JSON.stringify(LOOKALIKE_DAYS));
check(leakedUi.length === 0 && uidsAreHashes(onDisk), "the file saved from the screen carries none of the typed wording, names or ids either", () => "found: " + JSON.stringify(leakedUi) + (uidsAreHashes(onDisk) ? "" : " (and a UID that is not a plain hash)"));
const toast = await until(page, (n) => new RegExp(n + " dates ready").test((document.getElementById("toast") || {}).textContent || ""), NS);
check(toast, "the screen says how many dates are ready and what to do with the file");
const leftOutSaid = await until(page, () => /2 reminders made from the roster were left out[.]/.test((document.getElementById("toast") || {}).textContent || ""));
// (read here, in the page: a failure message that touched document would be run by Node, which has none, and crash the suite)
const leftOutToast = await page.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
check(leftOutSaid, "...and says that the 2 reminders made from the roster were left out (not the typed look-alikes)", "the toast said: " + JSON.stringify(leftOutToast));

// Only roster reminders left: nothing of the Soldier's own to add, and it says why.
await page.evaluate(async (keep) => { for (const r of await window.G.reminders.load()) if (!keep.includes(r.date)) await window.G.reminders.remove(r.id); }, ROSTER_DAYS);
await waitForRoute(page, "#/profile", { fresh: true, ready: ".rem-calendar button" });
let gotRosterOnly = false;
page.once("download", () => { gotRosterOnly = true; });
await clickWhenStable(page, page.locator(".rem-calendar button").first());
const rosterOnly = await until(page, () => /the ones made from the roster are not included/.test((document.getElementById("toast") || {}).textContent || ""));
check(rosterOnly && !gotRosterOnly, "with only roster reminders left there is no file, and the sentence says the roster's are not included");

// Nothing to export: no file, and a plain sentence.
await page.evaluate(async () => { for (const r of await window.G.reminders.load()) await window.G.reminders.remove(r.id); });
await waitForRoute(page, "#/profile", { fresh: true, ready: ".rem-calendar button" });
let got = false;
page.once("download", () => { got = true; });
await clickWhenStable(page, page.locator(".rem-calendar button").first());
const none = await until(page, () => /No upcoming reminders to add yet/.test((document.getElementById("toast") || {}).textContent || ""));
check(none && !got, "with no upcoming reminders there is no file, only a plain sentence");

/* ------------------------------------------------------------------ the Android share sheet */
// A Soldier who backs out of the share sheet has a file in the app's private cache and nothing they can open:
// the screen must not say "ready". The two plugins are stubbed (this proves the app's handling, not a device).
const NATIVE_SHARE = (outcome) => {
  window.__written = [];
  window.__shared = 0;
  const ok = async () => ({ display: "granted", notifications: [] });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {
    LocalNotifications: { checkPermissions: ok, requestPermissions: ok, getPending: ok, schedule: ok, cancel: ok },
    Filesystem: { writeFile: async (o) => { window.__written.push({ path: o.path, directory: o.directory }); return { uri: "file:///cache/" + o.path }; } },
    Share: { share: async () => { window.__shared++; if (outcome === "cancel") throw new Error("Share canceled"); return {}; } },
  } };
};
for (const [label, outcome, want, refuse] of [
  ["the Soldier backs out of the share sheet", "cancel", /Calendar file made, but not shared\. Tap the button again to choose where it goes\./, /ready — open the file/],
  ["the Soldier picks where it goes", "ok", /1 date ready — open the file in your calendar app\./, /not shared/],
]) {
  const s = await boot.openSession({ viewport: { width: 412, height: 915 }, noise,
    beforeLoad: async ({ page: p }) => { p.on("request", (r) => requests.push(r.url())); await p.addInitScript(NATIVE_SHARE, outcome); } });
  origins.add(new URL(s.url).origin);
  await waitForRoute(s.page, "#/profile", { ready: ".rem-calendar button" });
  await s.page.evaluate(async (d) => { await window.G.reminders.add({ kind: "board", label: "Board day", date: d }); }, day(Y, 9, 9));
  await clickWhenStable(s.page, s.page.locator(".rem-calendar button").first());
  const said = await until(s.page, () => /calendar file made|date ready|Couldn.t make/i.test((document.getElementById("toast") || {}).textContent || ""));
  const text = await s.page.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
  const st = await s.page.evaluate(() => ({ written: window.__written, shared: window.__shared }));
  check(said && want.test(text) && !refuse.test(text), "on Android, when " + label + ", the screen says: \"" + text + "\"", () => "toast: " + JSON.stringify(text));
  check(st.written.length === 1 && st.written[0].path === "guidon-dates.ics" && st.written[0].directory === "CACHE" && st.shared === 1, "...after the file was written to the app's cache and handed to the share sheet once", () => JSON.stringify(st));
  await s.context.close();
}

/* ------------------------------------------------------------------ the copy, on every kind of device */
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const TAURI = () => { window.__TAURI_INTERNALS__ = {}; };
const ANDROID_WITH_ALERTS = () => {
  const ok = async () => ({ display: "granted", notifications: [] });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android",
    Plugins: { LocalNotifications: { checkPermissions: ok, requestPermissions: ok, getPending: ok, schedule: ok, cancel: ok } } };
};
async function screens(opts) {
  const s = await boot.openSession({ viewport: { width: 412, height: 915 }, noise, contextOptions: opts.context || {},
    beforeLoad: async ({ page: p }) => { p.on("request", (r) => requests.push(r.url())); if (opts.stub) await p.addInitScript(opts.stub); } });
  origins.add(new URL(s.url).origin);
  const p = s.page;
  await waitForRoute(p, "#/profile", { ready: ".rem-calendar button" });
  const profile = await p.evaluate(() => ({ hint: (document.querySelector(".rem-h").nextElementSibling || {}).textContent || "",
    hasButton: /Add to my calendar/.test((document.querySelector(".rem-calendar") || {}).textContent || "") }));
  await waitForRoute(p, "#/settings", { ready: ".fin-h" });
  const settingsHasSwitch = await p.evaluate(() => !!document.getElementById("settings-notif-panel"));
  await waitForRoute(p, "#/search", { ready: 'input[type="search"]' });
  const hits = await p.evaluate(() => {
    const inp = document.querySelector('input[type="search"]');
    inp.focus(); inp.value = "notifications";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes("Screens")).click();
    return [...document.querySelectorAll(".search-hit-title")].map((t) => t.textContent);
  });
  return { profile, settingsHasSwitch, hits };
}
const NOTIF_HIT = "Settings — Notifications", REM_HIT = "Profile — Reminders & calendar file";
for (const [label, opts] of [["a desktop browser", { }], ["an iPhone", { context: { userAgent: IPHONE } }], ["the Windows app", { stub: TAURI }]]) {
  const r = await screens(opts);
  check(!/Notifications in Settings/.test(r.profile.hint) && /Add to my calendar/.test(r.profile.hint) && r.profile.hasButton,
    label + ": the Reminders hint says GUIDON cannot alert while closed and names the calendar button, which is there", () => JSON.stringify(r.profile));
  check(!r.settingsHasSwitch && !r.hits.includes(NOTIF_HIT) && r.hits.includes(REM_HIT),
    label + ": Settings has no Notifications switch, Search does not offer one, and it offers Reminders instead", () => JSON.stringify(r));
}
{
  const r = await screens({ stub: ANDROID_WITH_ALERTS });
  check(/Turn on Notifications in Settings if you'd like a local reminder on the day, too\./.test(r.profile.hint),
    "the Android app: the Reminders hint keeps its sentence about the Notifications switch", () => r.profile.hint);
  check(r.settingsHasSwitch && r.hits.includes(NOTIF_HIT) && r.hits.includes(REM_HIT),
    "the Android app: Settings has the Notifications switch, Search offers it, and the calendar file is offered too", () => JSON.stringify(r));
}

/* ------------------------------------------------------------------ nothing leaves the device */
const away = requests.filter((u) => !([...origins].some((o) => u.startsWith(o + "/")) || /^(data|blob|about):/.test(u)));
check(away.length === 0, "making and saving the file sent nothing off this device", () => away.slice(0, 5).join(" | "));
// (the backed-out share sheet is logged on purpose by util._nativeSave; the stub above makes it happen)
expectNoConsoleNoise(noise, { ignore: [/Failed to load resource/, /native share failed\/cancelled \(file was already saved\): Share canceled/] });
await finish("ICS EXPORT");
