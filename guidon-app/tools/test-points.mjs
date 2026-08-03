/**
 * Asserts the promotion-point maths against AR 600-8-19 (6 March 2026).
 *
 * Every row below was read off the regulation PDF (ARN43646), tables 3-2, 3-3
 * and 3-4. This file is the reason the app is allowed to state these numbers
 * without hedging: earlier builds interpolated between two anchor values and
 * correctly labelled the result an estimate. The anchors were right; the curve
 * between them was not linear, so the interpolated middle rows were wrong.
 *
 * Hand-transcribed regulation data is exactly the kind of thing that rots
 * silently, so it gets a test with the real rows in it.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

/* AR 600-8-19 table 3-2 — weapons qualification, promotion to SGT. */
const T32 = {
  rifle: { 40:160, 39:153, 38:145, 37:138, 36:130, 35:123, 34:115, 33:108, 32:100,
           31:93, 30:85, 29:78, 28:70, 27:63, 26:55, 25:48, 24:40, 23:33 },
  pistol: { 30:160, 29:146, 28:132, 27:118, 26:104, 25:90, 24:76, 23:62, 22:48, 21:33 },
  pistolVal: { 40:160, 39:152, 38:144, 37:136, 36:128, 35:120, 34:112, 33:104, 32:96,
               31:88, 30:80, 29:72, 28:64, 27:56, 26:48, 25:40, 24:33 },
};

/* AR 600-8-19 table 3-3 — weapons qualification, promotion to SSG. */
const T33 = {
  rifle: { 40:110, 39:107, 38:104, 37:101, 36:98, 35:91, 34:84, 33:77, 32:70,
           31:63, 30:56, 29:52, 28:48, 27:44, 26:40, 25:36, 24:32, 23:28 },
  pistol: { 30:110, 29:101, 28:92, 27:83, 26:74, 25:65, 24:56, 23:47, 22:38, 21:28 },
  pistolVal: { 40:110, 39:104, 38:99, 37:93, 36:88, 35:82, 34:77, 33:71, 32:65,
               31:60, 30:55, 29:50, 28:46, 27:41, 26:37, 25:32, 24:28 },
};

/* AR 600-8-19 table 3-4 — record AFT aggregate score to points (SGT and SSG). */
const T34 = [
  [500,500,120],[499,495,117],[494,490,114],[489,485,111],[484,480,108],[479,475,105],
  [474,470,102],[469,465,99],[464,460,96],[459,455,93],[454,450,90],[449,445,87],
  [444,440,84],[439,435,81],[434,430,78],[429,425,75],[424,420,72],[419,415,69],
  [414,410,66],[409,405,63],[404,400,60],[399,395,57],[394,390,54],[389,385,51],
  [384,380,48],[379,375,45],[374,370,42],[369,365,39],[364,360,36],[359,355,33],
  [354,350,30],[349,345,27],[344,340,24],[339,335,21],[334,330,18],[329,325,15],
  [324,320,12],[319,315,9],[314,310,6],[309,305,3],[304,300,1],
];

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(600);

const exposed = await page.evaluate(() => !!(window.G && window.G.pointsMath));
if (!exposed) { bad("G.pointsMath not exposed - cannot verify the tables"); }
else {
  ok("G.pointsMath exposed");

  // ---- Table 3-4: every published band, at both ends and the middle ----
  const aftBad = await page.evaluate((rows) => {
    const out = [];
    for (const [hi, lo, pts] of rows) {
      for (const sc of [lo, hi, Math.floor((lo + hi) / 2)]) {
        const got = window.G.pointsMath.aftPts(sc);
        if (got !== pts) out.push(`score ${sc}: expected ${pts}, got ${got}`);
      }
    }
    // Below the table floor a failing AFT earns nothing.
    if (window.G.pointsMath.aftPts(299) !== 0) out.push("299 should be 0");
    if (window.G.pointsMath.aftPts(0) !== 0) out.push("0 should be 0");
    return out;
  }, T34);
  aftBad.length === 0
    ? ok(`AFT table 3-4: all ${T34.length} bands correct (${T34.length * 3} probes)`)
    : bad(`AFT table 3-4: ${aftBad.length} mismatches; first: ${aftBad[0]}`);

  // ---- Tables 3-2 / 3-3: every published row, both ranks, all three cards ----
  for (const [rank, table, num] of [["SGT", T32, "3-2"], ["SSG", T33, "3-3"]]) {
    const wrong = await page.evaluate(({ rank, table }) => {
      const out = [];
      for (const type of Object.keys(table)) {
        for (const hits of Object.keys(table[type])) {
          const want = table[type][hits];
          const got = window.G.pointsMath.weaponPts(rank, +hits, type);
          if (got !== want) out.push(`${type} ${hits} hits: expected ${want}, got ${got}`);
        }
      }
      return out;
    }, { rank, table });
    const rows = Object.values(table).reduce((n, t) => n + Object.keys(t).length, 0);
    wrong.length === 0
      ? ok(`weapons table ${num} (${rank}): all ${rows} published rows correct`)
      : bad(`weapons table ${num} (${rank}): ${wrong.length} mismatches; first: ${wrong[0]}`);
  }

  // ---- Below-minimum and out-of-range behaviour ----
  const edges = await page.evaluate(() => {
    const w = window.G.pointsMath.weaponPts;
    return {
      belowMinRifle: w("SGT", 22, "rifle"),      // table 3-2 stops at 23 hits
      belowMinPistol: w("SGT", 20, "pistol"),    // table stops at 21 hits
      overMax: w("SGT", 99, "rifle"),            // clamps to the 40-hit row
      zero: w("SGT", 0, "rifle"),
      unknownType: w("SGT", 40, "nonsense"),     // falls back to rifle
    };
  });
  edges.belowMinRifle === 0 ? ok("below minimum qualifying hits scores 0 (rifle)") : bad("22 rifle hits scored " + edges.belowMinRifle);
  edges.belowMinPistol === 0 ? ok("below minimum qualifying hits scores 0 (pistol)") : bad("20 pistol hits scored " + edges.belowMinPistol);
  edges.overMax === 160 ? ok("hits above the table clamp to the maximum row") : bad("99 hits scored " + edges.overMax);
  edges.zero === 0 ? ok("zero hits scores 0") : bad("0 hits scored " + edges.zero);
  edges.unknownType === 160 ? ok("unknown weapon type falls back to rifle") : bad("fallback gave " + edges.unknownType);

  // ---- Category maximums, against the regulation ----
  const caps = await page.evaluate(() => {
    const P = window.G.pointsMath.PPW;
    return { total: P.total,
      SGT: { ...P.SGT.caps, weapons: P.SGT.weaponsMax, aft: P.SGT.aftMax },
      SSG: { ...P.SSG.caps, weapons: P.SSG.weaponsMax, aft: P.SSG.aftMax } };
  });
  const want = {
    total: 800,
    SGT: { training: 280, awards: 145, civEd: 135, weapons: 160, aft: 120 },
    SSG: { training: 230, awards: 165, civEd: 160, weapons: 110, aft: 120 },
  };
  const capErr = [];
  if (caps.total !== want.total) capErr.push(`total ${caps.total} != 800`);
  for (const rk of ["SGT", "SSG"]) {
    for (const k of Object.keys(want[rk])) {
      if (caps[rk][k] !== want[rk][k]) capErr.push(`${rk}.${k} ${caps[rk][k]} != ${want[rk][k]}`);
    }
  }
  capErr.length === 0
    ? ok("category maximums match AR 600-8-19 para 3-15 to 3-18")
    : bad("cap mismatches: " + capErr.join(", "));
}

await browser.close();
server.close();
console.log("\n" + (fails ? `POINTS: ${fails} FAILURE(S)` : "POINTS: all passed"));
process.exit(fails ? 1 : 0);
