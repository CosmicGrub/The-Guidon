/**
 * Legal package (GUIDON_COMMAND_LEGAL_PACKAGE.md): the claims about WHAT GUIDON
 * SHIPS - the training content, the network posture, the host-served guest page,
 * the workflows. Pure node: the real content packs are merged the way the build
 * merges them, the real source files are read, the real room server is started.
 *
 * Each assertion carries the id of the claim it stands behind ([LP-102] is
 * claim LP-102 in tools/legal-package-claims.json); tools/verify-legal-package.mjs
 * --run reads those lines. The claims here are the ones no existing suite was
 * written to prove:
 *
 *   - the Cybersecurity & OPSEC curriculum really defines what the package says
 *     it defines, explains RMF/ATO, treats UCMJ Articles 92, 103a and 134 the way
 *     the audit matrix says, and has the CUI spillage scenario it points to;
 *   - "no telemetry / cloud backend": an inventory of every network primitive in
 *     the shipped source, with the reason each is allowed (a new one fails this
 *     suite until someone reads it), plus a scan for analytics / crash / ad
 *     vendors in the source and in package.json;
 *   - the room host's only web page is the guest join page;
 *   - the package's "does not claim to detect NIPRNet / DoDIN" and "not an ATO";
 *   - the release-candidate checklist items that are statements about the tree
 *     (navigation, floors, no leftover helper workflow).
 *
 * What a test here cannot show is written into the claim itself (verification
 * "partial", with a "gap"), never implied.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finish } from "./testkit.mjs";
import { check, tag, list } from "./legal-package-kit.mjs";
import { readSeed } from "./seed-io.mjs";
import { mergeContentPacks } from "./content-pack-engine.mjs";
import { renderCitation } from "./cite-schema.mjs";
import { startRoomServer } from "./room-server.mjs";

const APP = fileURLToPath(new URL("../", import.meta.url));
const REPO = path.resolve(APP, "..");
const read = (rel) => readFileSync(path.join(APP, rel), "utf8");
const LEGAL = readFileSync(path.join(REPO, "GUIDON_COMMAND_LEGAL_PACKAGE.md"), "utf8");

/* ---- the shipped bank: static seed + every build-time content pack ---- */
const { data } = readSeed(path.join(APP, "src/index.html"));
const merged = mergeContentPacks(data, path.join(APP, "src/app-modules"));
const broken = merged.modules.filter((m) => m.error);
check(broken.length === 0, "the content packs merge cleanly (the bank this suite reads is the bank the build ships)", () => broken.map((m) => m.file + ": " + m.error).join("; "));
const cards = data.board.questions;
const CAT = "Cybersecurity & OPSEC";
const cyber = cards.filter((q) => q.category === CAT);
// A board card's citation is a structured array since ROADMAP item F Wave 2; this suite reasons about the text a Soldier reads.
const srcText = (q) => renderCitation(q.source);
const card = (id) => cards.find((q) => q.id === id) || { id, q: "", a: "", source: "" };
const scenario = (id) => (data.scenarios.scenarios || []).find((s) => s.id === id);
const term = (a) => (data.acronyms.terms || []).find((t) => String(t.a).toUpperCase() === a) || { a, d: "" };
const scenarioText = (s) => { if (!s) return ""; const parts = [s.title, s.scene]; Object.values(s.nodes || {}).forEach((n) => { parts.push(n.prompt, n.outcome); (n.choices || []).forEach((c) => parts.push(c.text, c.feedback)); }); return parts.filter(Boolean).join("\n"); };

/* ---- the sensitive-text check's own statement of policy ---- */
const G = {}; const win = { G }; win.window = win;
vm.runInContext(readFileSync(path.join(APP, "src/app-modules/05-opsec-guard.js"), "utf8"), vm.createContext({ window: win, G, console, document: { readyState: "loading", addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, navigator: { webdriver: true }, setTimeout() { return 0; }, clearTimeout() {} }), { filename: "05-opsec-guard.js" });
const DISCLAIMER = String(G.opsecGuard.DISCLAIMER);

/* ======================================================================
   Content policy and the first-run statement's wording
   ====================================================================== */
{
  const says = /limited to publicly released, unclassified sources and synthetic examples/.test(DISCLAIMER);
  const synth = card("opsec-cyber-34");
  check(says && /fictional/.test(synth.a),
    tag("LP-018", "LP-093") + " the project's content policy is stated in the app itself - the built-in curriculum is 'limited to publicly released, unclassified sources and synthetic examples' - and the curriculum teaches the same rule for training data (fictional units, people, grids and non-operational dates)",
    () => "disclaimer: " + DISCLAIMER.slice(0, 200) + " | card 34: " + synth.a);
}
{
  const c28 = card("opsec-cyber-28"), c27 = card("opsec-cyber-27");
  check(/limited to publicly released, unclassified sources/.test(DISCLAIMER) && /^No\./.test(c28.a) && /aggregation/.test(c28.a) && /public-release/.test(c28.a) && /derivative compilation/.test(c28.q) && /public-release review/i.test(c27.q),
    tag("LP-147") + " a public-source-only policy is stated in the app, together with an explicit warning that citing a public publication does not make a derivative compilation safe: aggregation, privacy and public-release rules can still apply (card opsec-cyber-28)",
    () => "card 28: " + c28.q + " -> " + c28.a);
}

/* ======================================================================
   The Cybersecurity & OPSEC curriculum
   ====================================================================== */
{
  const c1 = card("opsec-cyber-01"), c2 = card("opsec-cyber-02"), c3 = card("opsec-cyber-03"), c4 = card("opsec-cyber-04");
  const defines = /^What is critical information/.test(c2.q) && /adversary needs/.test(c2.a) && /^What is an OPSEC indicator/.test(c3.q) && /reveal critical information/.test(c3.a)
    && /aggregation/i.test(c4.q) && /combined/.test(c4.a);
  const protective = /protective measures/.test(c1.a) && /protective measures/.test(term("OPSEC").d);
  check(defines && protective && cyber.some((q) => q.id === c2.id),
    tag("LP-102") + " the curriculum has a definition card for critical information, one for indicators and one for aggregation, and describes protective measures as part of the OPSEC process (the process card and the OPSEC dictionary entry)",
    () => "cards 01-04: " + [c1, c2, c3, c4].map((c) => c.id + "=" + (c.q || "(missing)")).join(" | "));
}
{
  const rmf = card("opsec-cyber-20"), ato = card("opsec-cyber-21"), net = card("opsec-cyber-22");
  check(/Risk Management Framework/.test(rmf.a) && /authorization decision/.test(ato.a) && /offline-first/.test(ato.a) && /^No\./.test(net.a) && /Risk Management Framework/.test(term("RMF").d) && /Authorization to Operate/.test(term("ATO").d),
    tag("LP-115") + " the curriculum explains the RMF and an Authorization to Operate (what each is), says an app does not gain an ATO merely by being offline-first, and the dictionary carries both terms",
    () => "cards 20-22: " + [rmf, ato, net].map((c) => c.id + "=" + c.a.slice(0, 60)).join(" | "));
}
{
  const c8 = card("opsec-cyber-08"), c9 = card("opsec-cyber-09"), c13 = card("opsec-cyber-13");
  check(/^What is CUI/.test(c8.q) && /safeguarding/.test(c8.a) && /^No\./.test(c9.a) && /legacy marking/.test(c13.a) && /Controlled Unclassified Information/.test(term("CUI").d) && /legacy/.test(term("FOUO").d),
    tag("LP-120") + " the curriculum defines CUI (what it is, that it is not classified information, that FOUO is a legacy marking) and the dictionary carries CUI and FOUO",
    () => "cards 08/09/13: " + [c8, c9, c13].map((c) => c.id + "=" + c.a.slice(0, 50)).join(" | "));
}
{
  const s = scenario("sc-cui-spillage-reporting");
  const good = s && s.nodes["end-good"] && s.nodes["end-good"].outcome;
  const choice = s && s.nodes.n2 && s.nodes.n2.choices.find((c) => c.goto === "end-good");
  check(!!s && /Stop further dissemination/.test(choice && choice.text) && /do not forward it again/.test(choice.text) && /follow your organization's security\/privacy\/cyber incident-reporting procedures/.test(choice.text) && /Contain first, then report/.test(choice.feedback) && /responsible security\/privacy\/cyber personnel/.test(good),
    tag("LP-122") + " the CUI incident scenario (sc-cui-spillage-reporting) has the right answer 'stop further dissemination, do not forward it again ... follow your organization's incident-reporting procedures', with the feedback 'contain first, then report'",
    () => "scenario: " + (s ? JSON.stringify(choice) : "missing"));
}
{
  const removable = scenario("sc-cyber-removable-media"), social = scenario("sc-opsec-social-engineering");
  check(!!removable && /USB drive/.test(scenarioText(removable)) && /authorized media/.test(scenarioText(removable)) && !!social && /social-media/.test(scenarioText(social)) && /verify/.test(scenarioText(social)) && /suspicious contact/.test(scenarioText(social)),
    tag("LP-108") + " removable-media and social-engineering training exist as scenarios (an unknown USB drive; a friendly stranger asking for unit movements) with the right answers",
    () => "removable: " + !!removable + ", social: " + !!social);
}
{
  // UCMJ: Article 92, 103a and 134 in the module, and nothing in it that presents an ordinary mistake as automatically criminal.
  const c29 = card("opsec-cyber-29"), c30 = card("opsec-cyber-30"), c31 = card("opsec-cyber-31"), c32 = card("opsec-cyber-32");
  const cyberText = cyber.map((q) => [q.q, q.a, srcText(q), q.concept].join(" ")).concat(["sc-opsec-social-engineering", "sc-cyber-removable-media", "sc-opsec-fitness-tracking", "sc-cui-spillage-reporting"].map((id) => scenarioText(scenario(id)))).join("\n");
  const article92 = cyber.filter((q) => /Article 92|Art\. 92|§ 892/.test([q.q, q.a, srcText(q)].join(" ")));
  check(/general order or regulation/.test(c29.a) && /dereliction of duty/.test(c29.a) && /subject to the elements and facts/.test(c29.a) && article92.length >= 2,
    tag("LP-151") + " the curriculum describes Article 92 generally (failure to obey a lawful order or regulation, dereliction of duty, 'subject to the elements and facts of the case')",
    () => "card 29: " + c29.a);
  check(/^Is every cybersecurity mistake automatically an Article 92 offense/.test(c30.q) && /^No\./.test(c30.a) && /depends on/.test(c30.a) && /mental state/.test(c30.a) && /qualified legal guidance/.test(c30.a),
    tag("LP-151", "LP-073") + " and states expressly that not every cybersecurity mistake is automatically an Article 92 offense: 'No. Criminal or disciplinary liability depends on the applicable duty/order, required mental state, facts, and legal elements'",
    () => "card 30: " + c30.q + " -> " + c30.a);
  const all103 = []; // every string anywhere in the shipped bank that names Article 103a
  const walk = (v, where) => { if (typeof v === "string") { if (/103a|903a/.test(v)) all103.push({ where, v }); } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, where + "[" + i + "]")); else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], where + "." + k); };
  walk(data, "seed");
  const outside = all103.filter((h) => !/opsec-cyber-31|espionage/i.test(JSON.stringify(cards.find((q) => h.v === q.q || h.v === q.a || h.v === srcText(q) || (Array.isArray(q.source) && q.source.some((e) => e.pub === h.v)) || h.v === q.concept) || h.v)));
  const curriculumSrc = read("src/app-modules/06-opsec-cyber-curriculum.js");
  const selfCheck103 = (curriculumSrc.match(/q:"[^"]*103a[^"]*"[^}]*}/g) || []);
  check(/^Espionage\./.test(c31.a) && /should not be used as a generic label/.test(c31.a) && all103.length >= 1 && outside.length === 0 && selfCheck103.every((s) => /choices:\["Espionage"/.test(s)),
    tag("LP-155", "LP-073") + " Article 103a is identified as espionage and nothing else: every place the shipped bank names it (" + all103.length + ") is the espionage card or says 'espionage', and its self-check question's right answer is 'Espionage'",
    () => "outside the espionage card: " + list(outside.map((o) => o.where)) + " | card 31: " + c31.a);
  const art134 = cyber.filter((q) => /Article 134|Art\. 134|§ 934/.test([q.q, q.a, srcText(q)].join(" ")));
  check(art134.length === 1 && art134[0].id === "opsec-cyber-32" && /^The General Article addresses/.test(c32.a) && /subject to applicable elements and law/.test(c32.a) && !/punish|confinement|sentence|discharge|maximum/i.test(c32.a) && !/134/.test(curriculumSrc),
    tag("LP-159", "LP-073") + " inside the Cybersecurity & OPSEC module Article 134 has exactly one card, a high-level General Article description with no penalties or offenses listed, and no self-check question",
    () => "cards naming Article 134: " + art134.map((q) => q.id).join(",") + " | " + c32.a);
  const predicts = /court[- ]martial|will be prosecuted|automatically (?:a |an )?(?:criminal|crime|offense)|punitive/i.exec(cyberText.replace(/Is every cybersecurity mistake automatically an Article 92 offense\?/, ""));
  check(!predicts, tag("LP-073") + " nothing else in the module - its 34 cards and 4 scenarios - predicts a court-martial, a prosecution or an automatic offense" .replace("34 cards and 4 scenarios", "cards and scenarios"), () => "found: " + (predicts && predicts[0]));
  // The audit matrix's own cite strings agree with the app's.
  const agrees = (cite, c) => srcText(c).includes(cite) && LEGAL.includes(cite);
  const because = (cite) => " the section number in the audit matrix (" + cite + ") is the one the app's own card cites - the two agree (whether it is the right section is a legal check, see the claim's gap)";
  check(agrees("10 U.S.C. § 892", c29), tag("LP-150") + because("10 U.S.C. § 892"), () => "card source: " + srcText(c29));
  check(agrees("10 U.S.C. § 903a", c31), tag("LP-154") + because("10 U.S.C. § 903a"), () => "card source: " + srcText(c31));
  check(agrees("10 U.S.C. § 934", c32), tag("LP-158") + because("10 U.S.C. § 934"), () => "card source: " + srcText(c32));
}
{
  const floor = 30; // the package's own number: "at least 30 canonical board questions"
  const ids = (merged.packs["opsec-cyber-curriculum-content"] || {}).cardIds || [];
  check(cyber.length >= floor && ids.length >= floor && ids.every((id) => cyber.some((q) => q.id === id)),
    tag("LP-164") + " the Cybersecurity & OPSEC category holds at least 30 canonical board questions (counted in the merged bank the app ships), and every card the curriculum pack contributes is in it",
    () => "category has " + cyber.length + " cards; pack contributed " + ids.length);
}

/* ======================================================================
   Navigation
   ====================================================================== */
{
  const html = read("src/index.html");
  const group = /\{\s*id:\s*"prep",\s*label:\s*"Board Prep",\s*hashes:\s*\[([^\]]*)\]/.exec(html);
  const route = /\{\s*hash:\s*"#\/cyber-opsec",\s*label:\s*"Cybersecurity & OPSEC"/.test(html);
  check(!!group && group[1].includes('"#/cyber-opsec"') && route,
    tag("LP-163") + " #/cyber-opsec is a declared route (labelled 'Cybersecurity & OPSEC') and sits in the 'Board Prep' navigation group",
    () => "Board Prep group: " + (group ? group[1].slice(0, 120) : "not found") + "; route declared: " + route);
}

/* ======================================================================
   No telemetry, no cloud backend
   ====================================================================== */
const SHIPPED = ["src/index.html", "src/guest.html"]
  .concat(readdirSync(path.join(APP, "src")).filter((f) => /\.js$/.test(f)).map((f) => "src/" + f))
  .concat(readdirSync(path.join(APP, "src/app-modules")).filter((f) => /\.js$/.test(f)).map((f) => "src/app-modules/" + f));
/** Source without comments, and without the one giant line that is the content seed (content is not code). */
function codeOf(rel) {
  return read(rel).split("\n").map((l) => (l.length > 20000 ? "" : l)).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
}
{
  const PRIMS = { "fetch(": /\bfetch\s*\(/g, "XMLHttpRequest": /XMLHttpRequest/g, "sendBeacon": /sendBeacon/g, "new WebSocket(": /new\s+WebSocket\s*\(/g, "new EventSource(": /new\s+EventSource\s*\(/g, "importScripts(": /importScripts\s*\(/g, "dynamic import(": /(?<![\w.$])import\(\s*["'`]/g };
  const found = {};
  for (const rel of SHIPPED) {
    const code = codeOf(rel);
    for (const [name, re] of Object.entries(PRIMS)) { const n = (code.match(re) || []).length; if (n) found[name + " in " + rel] = n; }
  }
  // The complete, reviewed inventory. A NEW network call anywhere in the shipped source fails this suite until a person reads it and adds a row here.
  const ALLOWED = {
    "fetch( in src/index.html": [1, "the app loading its own bundled data by relative path (fetchJSON), never a remote address"],
    "fetch( in src/sw.js": [3, "the service worker: it answers only same-origin requests (checked below) - it is how the app opens with no signal"],
    "fetch( in src/app-modules/library.js": [2, "the Library checking for / reading its own bundled reference PDFs by relative path"],
    "new WebSocket( in src/room-web.js": [1, "Study Rooms, off unless the person turns the switch on in Settings; connects to another device on the same Wi-Fi"],
    "new WebSocket( in src/guest.html": [1, "the guest join page, which only exists while a host device serves it on the local network"],
  };
  const unknown = Object.keys(found).filter((k) => !ALLOWED[k]);
  const changed = Object.keys(ALLOWED).filter((k) => found[k] !== ALLOWED[k][0]);
  const sw = codeOf("src/sw.js");
  const sameOriginOnly = /if\s*\(\s*url\.origin\s*!==\s*self\.location\.origin\s*\)\s*return;/.test(sw);
  const fetchArgs = [];
  for (const rel of ["src/index.html", "src/app-modules/library.js"]) { const code = codeOf(rel); let m; const re = /\bfetch\s*\(\s*([^,)]+)/g; while ((m = re.exec(code))) fetchArgs.push(rel + ": fetch(" + m[1].trim() + ")"); }
  const okArgs = fetchArgs.every((a) => /fetch\((path|d\.pdfAsset|DOCS\[0\]\.pdfAsset)\)$/.test(a));
  check(unknown.length === 0 && changed.length === 0 && sameOriginOnly && okArgs,
    tag("LP-012", "LP-013", "LP-107") + " every network primitive in the shipped source is accounted for: " + Object.keys(ALLOWED).length + " reviewed uses (own bundled files by relative path; a service worker that ignores any other origin; the LAN-only Study Rooms sockets), and no XMLHttpRequest, sendBeacon, EventSource or importScripts anywhere",
    () => "not in the reviewed inventory: " + list(unknown) + "; count changed: " + list(changed.map((k) => k + " now " + found[k])) + "; service worker same-origin guard: " + sameOriginOnly + "; fetch arguments: " + list(fetchArgs));
  // Vendor DOMAINS and package names, never bare words: "sentry" is a guard post in the doctrine, "implausible" contains "plausible".
  const VENDORS = /google-analytics\.com|googletagmanager\.com|\bgtag\s*\(|sentry\.io|@sentry\/|bugsnag|crashlytics|\bfirebase(?:app|io|analytics|-analytics)?\b|mixpanel|amplitude\.com|segment\.(?:io|com)|datadoghq|newrelic|hotjar|fullstory|posthog|matomo|plausible\.io|admob|applovin|doubleclick|facebook\.net|appsflyer|instabug/i;
  const hits = SHIPPED.filter((rel) => VENDORS.test(read(rel).split("\n").filter((l) => l.length < 20000).join("\n")));
  const pkg = JSON.parse(read("package.json"));
  const deps = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies));
  const depHits = deps.filter((d) => VENDORS.test(d));
  const gradle = existsSync(path.join(APP, "android/app/build.gradle")) ? read("android/app/build.gradle") : "";
  const cargo = existsSync(path.join(APP, "src-tauri/Cargo.toml")) ? read("src-tauri/Cargo.toml") : "";
  const nativeHits = [gradle, cargo].filter((t) => VENDORS.test(t)).length;
  check(hits.length === 0 && depHits.length === 0 && nativeHits === 0,
    tag("LP-013", "LP-107") + " no analytics, crash-reporting or advertising library is in the shipped source, in package.json's dependencies, in the Android build file or in the desktop crate list (" + SHIPPED.length + " source files and " + deps.length + " dependencies scanned)",
    () => "vendor names found in " + list(hits) + " / " + list(depHits) + " / native " + nativeHits);
}

/* ======================================================================
   What the host serves; the ATO / NIPRNet statements
   ====================================================================== */
{
  const GUEST = path.join(APP, "dist/guest.html");
  if (!existsSync(GUEST)) check(false, tag("LP-066") + " (needs dist/guest.html - run npm run build)", "dist/guest.html is missing - run npm run build");
  else {
    const guestBytes = readFileSync(GUEST);
    const srv = await startRoomServer({ loopback: true, port: 0, guest: GUEST, quiet: true });
    try {
      const base = "http://127.0.0.1:" + srv.port;
      const guestPaths = ["/", "/guest.html", "/j/ALPHA-BRAVO-42"];
      const otherPaths = ["/index.html", "/web/index.html", "/app.html", "/sw.js", "/manifest.webmanifest", "/dist/guidon-standalone.html", "/docs/AR_600-20_Army_Command_Policy.pdf", "/src/index.html", "/..%2findex.html", "/%2e%2e/package.json", "/api", "/admin", "/favicon.ico", "/robots.txt"];
      const got = {};
      for (const p of guestPaths.concat(otherPaths, ["/health", "/ws"])) {
        const r = await fetch(base + p);
        got[p] = { status: r.status, type: r.headers.get("content-type") || "", body: Buffer.from(await r.arrayBuffer()) };
      }
      const guestOk = guestPaths.every((p) => got[p].status === 200 && got[p].body.equals(guestBytes));
      const others = otherPaths.filter((p) => got[p].status === 200 || /html/i.test(got[p].type));
      const htmlServed = Object.entries(got).filter(([, r]) => /html/i.test(r.type)).map(([p, r]) => [p, r.body.equals(guestBytes)]);
      check(guestOk && others.length === 0 && htmlServed.every(([, same]) => same) && /json/.test(got["/health"].type) && got["/ws"].status === 426,
        tag("LP-066") + " the room host's web server serves ONE page - the guest join page, byte for byte at /, /guest.html and /j/<code> - and nothing else GUIDON-shaped: " + otherPaths.length + " other paths (the app, its service worker, its documents, a path-traversal try) answer 404, and the only other answers are a JSON health check and 'upgrade required' for the room socket",
        () => "guest paths ok: " + guestOk + "; other paths that answered: " + list(others) + "; html responses: " + JSON.stringify(htmlServed));
    } finally { await srv.close().catch(() => {}); }
  }
}
{
  // "in every room state its footer repeats ..." : tools/test-guest-page.mjs reads the footer in the join, waiting, in-round and ended states in a real
  // browser. The states it cannot easily reach (turned down, kicked, host left, link lost) share one drawing path, so the footer is checked where the
  // page draws it: once, after the dispatch that picks the state, not inside any one state's branch.
  const g = read("src/guest.html");
  const dispatch = g.indexOf("else drawRoom(root, st);");
  const footer = g.indexOf('el("footer.gp-notice"');
  const between = dispatch >= 0 && footer > dispatch ? g.slice(dispatch, footer) : "";
  const terminal = /function drawTerminal[\s\S]*?\n  \}\n/.exec(g);
  const kinds = ["host-left", "network-lost", "rejected", "kicked"].filter((k) => terminal && terminal[0].includes('"' + k + '"'));
  check(dispatch > 0 && g.split('el("footer.gp-notice"').length === 2 && !/\b(?:if|else|for|while|function|switch)\b/.test(between.replace("else drawRoom(root, st);", "").replace(/\/\*[\s\S]*?\*\//g, "")) && kinds.length === 4
      && g.includes("Personal or explicitly authorized networks only. GUIDON is an unofficial, independent study aid and is not endorsed by the Department of Defense, the U.S. Army, or any government agency.") && /function drawIdle[\s\S]*?gp-boundary/.test(g),
    tag("LP-068", "LP-183") + " the guest page draws its unofficial / not-endorsed / authorized-networks-only footer once, right after the code that picks which state to draw - so it is on the screen in every state the page has (join, waiting, seated, in a round, ended, turned down, removed, host left, link lost) - and draws the boundary panel on its join screen",
    () => "dispatch at " + dispatch + ", footer at " + footer + ", code between: " + JSON.stringify(between.slice(0, 200)) + ", terminal states found: " + kinds.join(","));
}
{
  const netModules = ["src/app-modules/studygroup.js", "src/room-web.js", "src/room-tauri.js", "src/app-modules/room-schema.js", "src/guest.html"];
  const detect = netModules.filter((rel) => /NIPR|DoDIN|SIPR/i.test(read(rel)));
  const UI_DETECT = /(?:detect(?:s|ed)?|recogni[sz]es?|identif(?:y|ies))[^.\n]{0,60}(?:NIPR|DoDIN|SIPR|enterprise network|government network|DoD network)|(?:NIPR|DoDIN|SIPR|enterprise network|government network|DoD network)[^.\n]{0,60}(?:detected|auto-?detect|automatically detect)/i;
  const claimsDetect = SHIPPED.filter((rel) => UI_DETECT.test(read(rel).split("\n").filter((l) => l.length < 20000).join("\n")));
  check(detect.length === 0 && claimsDetect.length === 0,
    tag("LP-069") + " GUIDON does not detect the network it is on or claim to: none of the networking modules (Study Rooms, the room sockets, the guest page) mentions NIPRNet, DoDIN or SIPR at all, and no shipped text says it detects one",
    () => "networking modules that mention it: " + list(detect) + "; text claiming detection: " + list(claimsDetect));
  // Sentences whose subject is GUIDON itself. (The curriculum ASKS "does local-only storage make an application approved for DoD networks?" and answers No - that is the opposite of a claim.)
  const ATO_CLAIM = /\bGUIDON\b[^.\n]{0,40}\b(?:has|holds|carries|received|is granted|is issued|operates under)\b[^.\n]{0,20}\b(?:ATO|Authorization to Operate)\b|\bGUIDON\b[^.\n]{0,30}\b(?:is|has been|was)\s+(?:approved|authorized|accredited|certified|cleared)\b[^.\n]{0,25}\b(?:DoD|Army|government|NIPR|enterprise)\b/i;
  const atoHits = SHIPPED.filter((rel) => ATO_CLAIM.test(read(rel).split("\n").filter((l) => l.length < 20000).join("\n")));
  const seedText = JSON.stringify(data);
  const guestText = read("src/guest.html"), groupText = read("src/app-modules/studygroup.js");
  check(atoHits.length === 0 && !ATO_CLAIM.test(seedText) && /not an ATO or a network authorization/.test(guestText) && /not an ATO or network authorization/.test(groupText) && /does not gain an ATO merely by being offline-first/.test(seedText),
    tag("LP-070") + " nothing GUIDON ships presents local-only operation as an ATO or a network approval - and the places that speak to it (the Study Rooms screen, the guest page, the curriculum) each say it is NOT one",
    () => "text that claims an ATO / approval: " + list(atoHits));
}

/* ======================================================================
   Release-candidate hygiene
   ====================================================================== */
{
  const wfDir = path.join(REPO, ".github", "workflows");
  const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  const HELPER = /\b(?:helper|patch|hotfix|scratch|tmp|temp|one-?off|apply-?fix)\b/i;
  const suspicious = files.filter((f) => HELPER.test(f.replace(/\.ya?ml$/, "")) || HELPER.test((/^name:\s*(.*)$/m.exec(readFileSync(path.join(wfDir, f), "utf8")) || [, ""])[1]));
  check(suspicious.length === 0,
    tag("LP-184") + " no workflow in .github/workflows is named or titled like a one-off helper or patch job (" + files.length + " workflows checked)",
    () => "looks like a helper/patch workflow: " + list(suspicious));
}

await finish("LEGAL PACKAGE CONTENT");
