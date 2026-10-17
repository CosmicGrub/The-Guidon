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
const yesterday = (() => { const d = new Date(now); d.setDate(d.getDate() - 1); return iso(d); })();
const SECRETS = ["Doe", "Smith", "John", "555", "1-2 INF", "4856", "TESTKIT", "rSECRET1", "rSECRET2"];
const FIXTURE = [
  { id: "rSECRET1", kind: "board", label: "Promo board with SSG Doe, A. (1-2 INF)", note: "Call 555-0100; bring DA 4856", date: day(Y, 10, 31) },
  { id: "rSECRET2", kind: "counseling", label: "Counsel SSG Smith, John", note: "", date: day(Y, 12, 31) },
  { id: "rb", kind: "weapons", label: "Range day with the third squad", date: day(leap, 2, 28) },
  { id: "rc", kind: "acft", label: "AFT", date: day(leap, 2, 29) },
  { id: "rd", kind: "pt", label: "PT: Strength session", date: day(Y, 4, 30) },
  { id: "re", kind: "banana", label: "Unknown kind", date: day(Y, 6, 15) },
  { id: "rf", kind: "__proto__", label: "Prototype kind", date: day(Y, 7, 1) },
  { id: "rg", kind: "board", label: "Yesterday", date: yesterday },            // past: not exported
  { id: "rh", kind: "other", label: "Not a date", date: "2031-13-45" },        // not a date: not exported
  { id: "ri", kind: "ets", label: "No date", date: "" },                       // no date: not exported
];
const EXPECTED = { // the events that must come out, by date, with the generic title for the kind
  [day(Y, 10, 31)]: "GUIDON: Promotion board", [day(Y, 12, 31)]: "GUIDON: Counseling follow-up due",
  [day(leap, 2, 28)]: "GUIDON: Weapons qualification due", [day(leap, 2, 29)]: "GUIDON: Fitness test due (ACFT / AFT)",
  [day(Y, 4, 30)]: "GUIDON: PT session", [day(Y, 6, 15)]: "GUIDON: Date to remember", [day(Y, 7, 1)]: "GUIDON: Date to remember",
};

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
check(built.a.events === 7 && events.length === 7,
  "exactly the 7 upcoming dated reminders became events (past, not-a-date and no-date ones left out)", () => "events: " + built.a.events + " / parsed " + events.length);
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
const leaked = SECRETS.filter((s) => built.a.text.includes(s));
check(leaked.length === 0, "nothing the Soldier typed, no roster name, no profile name and no reminder id is anywhere in the file",
  () => "found in the file: " + JSON.stringify(leaked));

// Stable and unique UIDs.
const uidsA = [...built.a.text.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
const uidsB = [...built.b.text.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
check(JSON.stringify(uidsA) === JSON.stringify(uidsB) && uidsA.length === 7,
  "the same reminders give the same UIDs on a second export (opening a newer file updates the calendar, it does not add a copy)", () => JSON.stringify([uidsA, uidsB]));
check(new Set(uidsA).size === 7 && uidsA.every((u) => /^guidon-[0-9a-f]{16}@guidon\.invalid$/.test(u)),
  "the UIDs are all different, and are not the reminder ids", () => JSON.stringify(uidsA));
check(JSON.stringify(parseIcs(built.b.text).root.children[0].children.map((c) => prop(c, "DTSTAMP").value)) === JSON.stringify(new Array(7).fill("20310609T070809Z")),
  "only DTSTAMP changes between two exports");

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
await waitForRoute(page, "#/profile", { ready: ".rem-calendar button" });
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
check(shownEvents.length === 7 && shown.longest <= 75, "the saved file parses and holds the 7 upcoming dates", () => "events: " + shownEvents.length);
const leakedUi = SECRETS.concat(["Promo board", "Range day", "third squad", "Unknown kind", "Prototype kind", "Strength session"]).filter((s) => onDisk.includes(s));
check(leakedUi.length === 0, "the file saved from the screen carries none of the typed wording, names or ids either", () => "found: " + JSON.stringify(leakedUi));
const toast = await until(page, () => /7 dates ready/.test((document.getElementById("toast") || {}).textContent || ""));
check(toast, "the screen says how many dates are ready and what to do with the file");

// Nothing to export: no file, and a plain sentence.
await page.evaluate(async () => { for (const r of await window.G.reminders.load()) await window.G.reminders.remove(r.id); });
await waitForRoute(page, "#/profile", { fresh: true, ready: ".rem-calendar button" });
let got = false;
page.once("download", () => { got = true; });
await clickWhenStable(page, page.locator(".rem-calendar button").first());
const none = await until(page, () => /No upcoming reminders to add yet/.test((document.getElementById("toast") || {}).textContent || ""));
check(none && !got, "with no upcoming reminders there is no file, only a plain sentence");

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
expectNoConsoleNoise(noise, { ignore: [/Failed to load resource/] });
await finish("ICS EXPORT");
