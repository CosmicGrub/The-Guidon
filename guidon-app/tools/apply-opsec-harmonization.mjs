import fs from 'node:fs';

function mustReplace(src, from, to, label) {
  if (src.includes(to)) return src;
  if (!src.includes(from)) throw new Error(`missing anchor: ${label}`);
  return src.replace(from, to);
}

// 1) Static route/nav/tour registration in the large shell.
{
  const p='guidon-app/src/index.html'; let s=fs.readFileSync(p,'utf8');
  s=mustReplace(s,
    '    { hash: "#/moi", label: "MOI Import", ico: "upload", render: (m) => G.moiImport.render(m) },\n    { hash: "#/board", label: "Board", ico: "layers", render: (m) => G.board.render(m) },',
    '    { hash: "#/moi", label: "MOI Import", ico: "upload", render: (m) => G.moiImport.render(m) },\n    { hash: "#/cyber-opsec", label: "Cybersecurity & OPSEC", ico: "shield", render: (m) => G.opsec.render(m) },\n    { hash: "#/board", label: "Board", ico: "layers", render: (m) => G.board.render(m) },', 'route');
  s=mustReplace(s,
    'hashes: ["#/train", "#/board", "#/group", "#/records", "#/calendar", "#/doctrine", "#/creeds", "#/prt", "#/recite", "#/dictionary", "#/library", "#/moi"]',
    'hashes: ["#/train", "#/board", "#/group", "#/records", "#/calendar", "#/doctrine", "#/cyber-opsec", "#/creeds", "#/prt", "#/recite", "#/dictionary", "#/library", "#/moi"]', 'nav');
  const moiDemo=`    "#/moi":       { d:"Import your board's MOI and get a study plan built from exactly what it assigns.",
                     w:"Paste or upload the MOI, then Find my topics — Review shows exactly what matched, needs a second look, or wasn't found." },`;
  const opsecDemo=moiDemo+`
    "#/cyber-opsec": { d:"Practice public, unclassified Cybersecurity and OPSEC fundamentals with board questions, scenarios, and a local knowledge audit.",
                     w:"Review the safety boundary first, then use scenarios, the 10-question audit, or jump into the Cybersecurity & OPSEC board-question category." },`;
  s=mustReplace(s,moiDemo,opsecDemo,'guided-tour metadata');
  fs.writeFileSync(p,s);
}

// 2) MOI import: reject/flag before parsing/persistence; only screened text enters matcher.
{
  const p='guidon-app/src/app-modules/moi-import.js'; let s=fs.readFileSync(p,'utf8');
  s=s.replace('Soldier handed a real MOI has no way to see it filtered down to ONLY what\n   their own board actually assigned.', 'Soldier working from an authorized public or synthetic study MOI needs a way\n   to see it filtered down to ONLY what that study document assigns.');
  const old=`      findBtn.addEventListener("click", () => {
        const combined = [pdfText, ta.value].filter(Boolean).join("\\n");
        if (!combined.trim()) { try { util.toast("Add some MOI text first — upload a PDF or paste text."); } catch (e) {} return; }
        runMatching(combined);
      });`;
  const neu=`      findBtn.addEventListener("click", () => {
        const combined = [pdfText, ta.value].filter(Boolean).join("\\n");
        if (!combined.trim()) { try { util.toast("Add some MOI text first — upload a PDF or paste text."); } catch (e) {} return; }
        const screened = G.opsecGuard && G.opsecGuard.sanitizeInput ? G.opsecGuard.sanitizeInput(combined, { redactContact: true }) : { text: combined, blocked: false, requiresReview: false, redactions: [] };
        if (screened.blocked || screened.requiresReview) {
          errorBox.textContent = G.opsecGuard ? G.opsecGuard.decisionMessage(screened) : "Sensitive-looking input cannot be processed here.";
          errorBox.hidden = false;
          try { util.toast("MOI import stopped — review the OPSEC warning."); } catch (e) {}
          return;
        }
        if (screened.redactions && screened.redactions.length) {
          errorBox.textContent = G.opsecGuard.decisionMessage(screened);
          errorBox.hidden = false;
        }
        runMatching(screened.text);
      });`;
  s=mustReplace(s,old,neu,'moi screening');
  const upload=`      stage.appendChild(el("div.panel", { style: "margin-top:10px" }, [
        el("div.eyebrow", { text: "Upload a PDF or text file" }), fileInput, fileStatus, errorBox ]));`;
  const uploadNew=`      stage.appendChild(el("div.panel", { style: "margin-top:10px;border-left:3px solid var(--amber)" }, [
        el("div.eyebrow", { text: "Public / synthetic study material only" }),
        el("p.hint", { text: "Do not paste or upload classified information, CUI, real operational orders/rosters, mission grids, or sensitive personnel data. GUIDON blocks marked sensitive material and flags likely aggregation risks before parsing; this screen is not a classification or public-release determination." }) ]));
      stage.appendChild(el("div.panel", { style: "margin-top:10px" }, [
        el("div.eyebrow", { text: "Upload a PDF or text file" }), fileInput, fileStatus, errorBox ]));`;
  s=mustReplace(s,upload,uploadNew,'moi warning');
  fs.writeFileSync(p,s);
}

// 3) Squad roster: no sensitive identifier persistence.
{
  const p='guidon-app/src/app-modules/leader.js'; let s=fs.readFileSync(p,'utf8');
  s=s.replace('Use initials or a roster number, not full names. Keep it to dates. Do not put medical, legal, SHARP, financial or performance narrative in here - that belongs in the systems built for it, with the access controls that come with them.', 'Use initials, a callsign, or a roster number — not full legal names. Keep it to dates. Do not enter CUI, classified information, UICs, DoD IDs, SSNs, phone numbers, email/address data, or medical, legal, SHARP, financial, or performance narrative. Those belong only in authorized systems and processes.');
  const old='nameIn.addEventListener("change", function () { sol.name = nameIn.value.trim(); persist(); buildSummary(); });';
  const neu='nameIn.addEventListener("change", function () { const candidate = nameIn.value.trim(); const screened = G.opsecGuard && G.opsecGuard.sanitizeInput ? G.opsecGuard.sanitizeInput(candidate, { redactContact: true }) : { text:candidate, blocked:false, requiresReview:false, redactions:[] }; if (screened.blocked || screened.requiresReview || (screened.redactions && screened.redactions.length)) { nameIn.value = sol.name || ""; try { util.toast(G.opsecGuard ? G.opsecGuard.decisionMessage(screened) : "Use only initials, a callsign, or a roster number."); } catch (e) {} return; } sol.name = screened.text; persist(); buildSummary(); });';
  s=mustReplace(s,old,neu,'roster screening');
  fs.writeFileSync(p,s);
}

// 4) Study Rooms: permanent official-network boundary warning.
{
  const p='guidon-app/src/app-modules/studygroup.js'; let s=fs.readFileSync(p,'utf8');
  const old=`  function render(mount) {
    util().clear(mount);
    rt.mount = mount;
    mount.appendChild(el("div.section-title", {}, [el("h2", { text: "Study group" }), el("div.rule")]));
    var rootEl = el("div.sg-root");`;
  const neu=`  function render(mount) {
    util().clear(mount);
    rt.mount = mount;
    mount.appendChild(el("div.section-title", {}, [el("h2", { text: "Study group" }), el("div.rule")]));
    var netWarn = el("div.panel.sg-network-boundary", { style: "margin-bottom:10px;border-left:3px solid var(--amber)" });
    netWarn.appendChild(el("div.eyebrow", { text: "Personal / explicitly authorized networks only" }));
    netWarn.appendChild(el("p", { text: "Do not host or join GUIDON Study Rooms on DoD/Army enterprise networks unless your organization has explicitly authorized this application and connection under its cybersecurity and network-connection process. By default, use personal/off-duty local Wi-Fi. Offline-first design is not an ATO or network authorization. References: AR 25-2; DoDI 8510.01." }));
    mount.appendChild(netWarn);
    var rootEl = el("div.sg-root");`;
  s=mustReplace(s,old,neu,'study-room warning');
  fs.writeFileSync(p,s);
}

console.log('OPSEC harmonization patch applied');
