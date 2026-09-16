import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../src/app-modules/z-studygroup-multicategory.js"), "utf8");
let state = null;
const bank = [
  { id: "a", category: "TCCC" },
  { id: "b", category: "9-Line" },
  { id: "c", category: "Leadership" },
];
const G = {
  store: { boardQuestions: () => bank.slice() },
  studyGroup: {
    state: () => state,
    host: async (o) => { state = { deck: { category: o.category === "All" ? null : o.category } }; return { ok: true, opts: o }; },
    render: () => null,
  },
};
const context = { globalThis: { G }, G };
vm.createContext(context);
vm.runInContext(src, context, { filename: "z-studygroup-multicategory.js" });

let fail = 0;
function ok(cond, msg) { if (cond) console.log("ok - " + msg); else { console.error("FAIL - " + msg); fail++; } }
const m = G.studyGroup.multiCategory;
const wire = m.encode(["TCCC", "9-Line"]);
ok(wire === "Multi: TCCC + 9-Line", "encodes multiple categories in the existing string field");
ok(wire.length <= 80, "wire category stays within schema v1's 80-char limit");
ok(JSON.stringify(m.decode(wire)) === JSON.stringify(["TCCC", "9-Line"]), "round-trips category labels");
ok(m.encode(["TCCC"]) === "TCCC", "single-category representation is unchanged");
ok(m.encode(["All"]) === "All", "All representation is unchanged");

const hosted = await G.studyGroup.host({ mode: "relay", category: "All", categories: ["TCCC", "9-Line"] });
ok(hosted.ok && hosted.opts.category === wire, "host() accepts categories[] without changing its return contract");
const filtered = G.store.boardQuestions();
ok(filtered.length === 2 && filtered.every((q) => q.category === "TCCC" || q.category === "9-Line"), "active mixed room filters the existing local question-bank seam");
state = { deck: { category: "TCCC" } };
ok(G.store.boardQuestions().length === 3, "legacy single-category room leaves boardQuestions behavior unchanged");
state = null;
ok(G.store.boardQuestions().length === 3, "outside a mixed room the store is unchanged");

process.exitCode = fail ? 1 : 0;
