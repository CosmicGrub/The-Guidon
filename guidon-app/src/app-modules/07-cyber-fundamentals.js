/* ==== js/07-cyber-fundamentals.js ==== */
/* GUIDON — Cybersecurity Fundamentals: the runtime half. Wraps
   G.opsec.render (owned by 06-opsec-cyber-curriculum.js) to add a second,
   clearly-labeled section to the existing #/cyber-opsec screen — the 2026-09
   OPSEC/legal audit's own placement recommendation — rather than a new route
   or nav item.

   ROADMAP 3g E split: the board cards and dictionary terms this section
   reports now live in 07-cyber-fundamentals-content.js ("emit":"build",
   runs at build time); this file only reads the already-merged seed at
   render time, the same way the original file's card-count and dictionary
   stats always did read the seed for everything BUT its own literal data. */
(function () {
  "use strict";
  var G = window.G = window.G || {};
  var seed = window.GUIDON_SEED;
  if (!seed) return;
  if (!G.opsec || typeof G.opsec.render !== "function") return;

  var CATEGORY = "Cybersecurity Fundamentals";
  // Just the keys 07-cyber-fundamentals-content.js added/merged, so this
  // screen can report accurate live counts and pull each term's *current*
  // (already-merged) definition, without keeping a second copy of ~11 long
  // definitions here that could drift from the one the seed actually ships.
  var TERM_KEYS_UPPER = ["RAAS", "INTP", "VPN", "IOT", "GFE", "PED", "VISHING", "DEEPFAKE", "ZERO TRUST", "GENAI.MIL", "CDAO"];

  function cardsInBank() {
    return (seed.board && Array.isArray(seed.board.questions) ? seed.board.questions : []).filter(function (q) { return q.category === CATEGORY; });
  }
  function termsInBank() {
    var terms = (seed.acronyms && Array.isArray(seed.acronyms.terms)) ? seed.acronyms.terms : [];
    return terms.filter(function (t) { return TERM_KEYS_UPPER.indexOf(String(t.a || "").toUpperCase()) !== -1; });
  }

  var selfCheck = [
    {"q":"Which of these is a category of malicious code, according to DoD cyber-awareness training?","choices":["Firewall","Trojan horse","Access control list","Digital signature"],"answer":1,"why":"DoD training identifies viruses, worms, Trojan horses, macros, and scripts as malicious-code categories, with ransomware treated as a related but distinct type; a firewall, an access control list, and a digital signature are protective controls, not malicious code.","card":"cyberfund-mal-02"},
    {"q":"What makes 'double extortion' more dangerous than basic ransomware encryption alone?","choices":["It encrypts files twice for stronger protection","Attackers steal data before encrypting it and threaten to leak it even if the ransom is paid","It only targets government networks","It requires two separate ransom payments to two different accounts"],"answer":1,"why":"Double extortion adds data theft and a public-release threat on top of encryption, so paying to unlock files does not remove the risk that the stolen copy is leaked anyway.","card":"cyberfund-mal-04"},
    {"q":"Can a Soldier be an insider threat without intending to cause harm?","choices":["No, insider threat always requires deliberate intent","Yes — negligent or unwitting misuse of authorized access can cause the same harm an Insider Threat Program is meant to prevent","No, only civilians can be unwitting insider threats","Yes, but only if classified information is involved"],"answer":1,"why":"DoD's own definition covers access used 'wittingly or unwittingly' to cause harm, so careless handling of information by a trusted insider counts alongside deliberate acts like espionage.","card":"cyberfund-ins-01"},
    {"q":"A teammate has unexplained sudden wealth and has been asking for information outside their need-to-know. What should you do?","choices":["Confront them directly and demand an explanation","Ignore it since you have no proof of wrongdoing","Report the behavior through your organization's insider threat policy and security channels","Post your concerns on a personal social media account to warn others"],"answer":2,"why":"DoD Cyber Awareness training lists unexplained affluence and off-need-to-know information requests as reportable insider-threat indicators; the correct response is to report through established channels, not to investigate or confront on your own.","card":"cyberfund-ins-03"},
    {"q":"A phishing e-mail has perfect spelling and professional formatting. Does that mean it's safe to trust?","choices":["Yes, professional writing proves it's legitimate","No, generative AI tools can now produce fluent, convincing content","Only if it has an official-looking government logo","Yes, as long as it doesn't ask for a password"],"answer":1,"why":"Current DoD training warns that malicious actors can use generative AI to create very convincing e-mails and messages, so polished writing is no longer proof a message is legitimate.","card":"cyberfund-ai-01"},
    {"q":"You get a voicemail that sounds exactly like your supervisor, urgently demanding you send login information right now. What is the correct response?","choices":["Comply immediately since the voice is familiar","Do not act on it through that channel; verify through a phone number or contact method you already know is legitimate","Send only part of the information to limit the risk","Call back the number left in the voicemail to confirm it"],"answer":1,"why":"AI voice-cloning can make an impostor sound nearly identical to someone you know, so a familiar voice does not confirm identity; verify through a contact method you already trust before acting.","card":"cyberfund-ai-04"},
    {"q":"You're working on your government laptop over free Wi-Fi at a coffee shop. What should you do?","choices":["Just start working, it's only for a few minutes","Connect through the government VPN before doing any work","Disable the laptop's firewall so pages load faster","Ask the coffee shop staff for their Wi-Fi router's admin password"],"answer":1,"why":"DoD training warns that information sent over public Wi-Fi can be exposed to theft or malware and that fake wireless access points are used for deception, so use public or free Wi-Fi only with the government VPN.","card":"cyberfund-tel-01"},
    {"q":"Which of these accessories is permitted on your government-furnished telework computer under current DoD guidance?","choices":["A personal Bluetooth mouse","A personal wireless webcam","A wired USB keyboard","A peripheral from a manufacturer your organization has prohibited"],"answer":2,"why":"Current DoD guidance permits only specific wired connections, such as a wired keyboard, mouse, or headset through USB; Bluetooth and other wireless peripherals and peripherals from prohibited manufacturers are not permitted.","card":"cyberfund-tel-05"},
    {"q":"According to DoD's cyber awareness training, what is currently the biggest security weakness in home IoT devices like smart speakers and security cameras?","choices":["Their high purchase price","Default passwords that are never changed","Their small physical size","Excessive data usage"],"answer":1,"why":"DoD Cyber Awareness training identifies default passwords as the leading weakness in these devices, warning that an unsecured device can be compromised within minutes of connecting to the internet and become an attack vector against other equipment on the same network.","card":"cyberfund-iot-01"},
    {"q":"Why does federal IoT guidance call out devices with unchangeable default credentials as a specific vulnerability?","choices":["They cost more to manufacture","Known factory defaults let attackers log in without authorization or recruit the device into a botnet","They use more electricity than other devices","They cannot be labeled with an asset tag"],"answer":1,"why":"A default credential an owner cannot change is a documented attack path: attackers who know the factory default can log in directly or assemble many identical devices into a botnet used for denial-of-service attacks.","card":"cyberfund-iot-02"},
    {"q":"Can a personal smartwatch be brought into a SCIF if it's switched to airplane mode first?","choices":["Yes, airplane mode removes the risk","No — personally-owned PEDs are not allowed in a SCIF regardless of mode","Only if a supervisor gives verbal approval","Yes, as long as it stays in a bag"],"answer":1,"why":"SCIF rules bar personal Portable Electronic Devices outright because they can still be hacked, carry malware, or capture audio, video, or photos, and powering a device off or using airplane mode is not treated as removing that risk.","card":"cyberfund-scif-01"},
    {"q":"When using an unclassified laptop in a collateral classified space, which peripheral is allowed?","choices":["A wireless Bluetooth headset with a microphone","A personally-owned wired headset without a microphone","A wireless webcam","Any personal wireless peripheral, as long as it's password protected"],"answer":1,"why":"Collateral classified space rules prohibit all wireless headsets, microphones, and webcams; a personally-owned wired headset without a microphone is one of the few personal peripherals explicitly allowed.","card":"cyberfund-scif-03"},
    {"q":"Under Zero Trust, what does \"never trust, always verify\" mean for you personally?","choices":["Once you log in, you stay trusted for the rest of the day","Every access request is checked based on current conditions, not assumed safe because you're already on the network","Only new employees need to be verified","Verification only applies to classified systems"],"answer":1,"why":"Zero Trust replaces the old idea of a trusted network interior with continuous, per-request verification for every user and device.","card":"cyberfund-zt-01"},
    {"q":"Which password practice matches current guidance?","choices":["A short password with lots of symbols, changed every 60 days","A long passphrase (up to 64 characters), not forced to change on a fixed schedule","No minimum length as long as it has a number","A password reused across every system for consistency"],"answer":1,"why":"Current guidance favors length over complexity and drops mandatory periodic rotation, requiring a change only when there is evidence of compromise.","card":"cyberfund-zt-04"},
    {"q":"Can you use your personal ChatGPT or Gemini account to help draft a work document on a government device?","choices":["Yes, personal AI accounts are just as secure","No — use the DoD's sanctioned platform, GenAI.mil, instead","Only if you delete the chat afterward","Yes, as long as the document is unclassified"],"answer":1,"why":"A personal commercial AI account isn't authorized or accredited to receive government data; GenAI.mil exists as the sanctioned alternative.","card":"cyberfund-ai2-02"},
    {"q":"An AI tool is approved to handle Controlled Unclassified Information (CUI). Can you also type classified information into it?","choices":["Yes, if it already handles CUI it can handle classified too","No — a tool and its hosting environment must be specifically accredited for that classification level; CUI approval does not extend to it","Yes, as long as a supervisor verbally approves it","Only for TOP SECRET information"],"answer":1,"why":"Accreditation is level-specific under DoD's Impact Level framework. Being approved for CUI does not mean a tool is cleared for classified information — that requires its own specific accreditation.","card":"cyberfund-ai2-03"}
  ];

  /* Wraps rather than replaces the existing screen: the original module's
     render still draws its own section first (scenarios, its own 34-card
     bank, its own 10-question audit); this appends a second, separately
     labeled section below it on the same #/cyber-opsec route. */
  var originalRender = G.opsec.render;
  function render(mount) {
    originalRender(mount);
    var util = G.util, el = util.el;
    function say(msg) { try { if (util.announce) util.announce(msg); } catch (e) {} }

    mount.appendChild(el("div.section-title", { style: "margin-top:18px" }, [el("h2", { text: "Cybersecurity Fundamentals" }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text: "Newer topics from current DoD cyber-awareness training that the section above does not cover: malicious code and ransomware, insider threat, AI-enabled social engineering and deepfakes, telework/mobile security, IoT, SCIF/PED handling, Zero Trust, and sanctioned generative-AI tool use." }));

    var cards = cardsInBank(), terms = termsInBank();
    var stats = el("div.panel-grid-2", {}, [
      el("div.panel", {}, [el("div.eyebrow", { text: "Board bank" }), el("div.v", { text: cards.length + " Cybersecurity Fundamentals questions" })]),
      el("div.panel", {}, [el("div.eyebrow", { text: "Dictionary" }), el("div.v", { text: terms.length + " new/expanded terms" })])
    ]);
    mount.appendChild(stats);

    var audit = el("div.panel", { style: "margin-top:10px" }); audit.appendChild(el("h3", { text: selfCheck.length + "-question knowledge audit" }));
    var body = el("div"); audit.appendChild(body); var idx = 0, score = 0, missed = [];
    function cardFor(item) { var qs = (seed.board && seed.board.questions) || []; for (var i = 0; i < qs.length; i++) if (qs[i].id === item.card) return qs[i]; return null; }
    function focusOn(node) { try { node.focus({ preventScroll: false }); } catch (e) {} }
    function draw(takeFocus) {
      util.clear(body);
      if (idx >= selfCheck.length) {
        var done = el("p.k", { tabindex: "-1", "data-selfcheck": "cyberfund-score", text: "You got " + score + " of " + selfCheck.length + "." });
        body.appendChild(done);
        if (missed.length) {
          body.appendChild(el("p.hint", { text: "Worth another look:" }));
          var ul = el("ul", { style: "margin:4px 0 8px 18px;padding:0" });
          missed.forEach(function (n) { var it = selfCheck[n]; ul.appendChild(el("li", { style: "margin:3px 0", text: it.q + " — " + it.choices[it.answer] })); });
          body.appendChild(ul);
        }
        var again = el("button.btn.sm", { type: "button", text: "Run again" });
        again.addEventListener("click", function () { idx = 0; score = 0; missed = []; draw(true); });
        body.appendChild(again);
        say(done.textContent + (missed.length ? " " + missed.length + " to look at again." : ""));
        if (takeFocus) focusOn(done);
        return;
      }
      var item = selfCheck[idx], answered = false, buttons = [];
      var qEl = el("p.k", { id: "cyberfund-selfcheck-q", tabindex: "-1", "data-selfcheck": "cyberfund-question", text: "Question " + (idx + 1) + " of " + selfCheck.length + ": " + item.q });
      body.appendChild(qEl);
      var group = el("div", { role: "group", "aria-labelledby": "cyberfund-selfcheck-q" });
      var fbBox = el("div");
      item.choices.forEach(function (c, i) {
        var b = el("button.btn.sm.ghost", { type: "button", text: c, "aria-pressed": "false", style: "display:block;margin-top:6px;text-align:left" });
        b.addEventListener("click", function () {
          if (answered) return; answered = true;
          var right = i === item.answer; if (right) score++; else missed.push(idx);
          b.setAttribute("aria-pressed", "true");
          buttons.forEach(function (x, j) {
            x.setAttribute("aria-disabled", "true");
            if (j === item.answer) x.textContent = item.choices[j] + " — correct answer";
            else if (j === i) x.textContent = item.choices[j] + " — your answer";
          });
          var card = cardFor(item);
          var verdict = right ? "Correct." : "Not quite.";
          var fb = el("div.feedback." + (right ? "good" : "warn"), { tabindex: "-1", "data-selfcheck": "cyberfund-feedback", style: "margin-top:10px" });
          fb.appendChild(el("p.k", { style: "margin:0 0 4px", text: verdict }));
          fb.appendChild(el("p", { style: "margin:0 0 4px", text: "The answer is: " + item.choices[item.answer] }));
          var why = item.why || (card && card.a) || "";
          if (why) fb.appendChild(el("p.hint", { style: "margin:0 0 4px", text: why }));
          // A board card's citation is a structured array (ROADMAP item F Wave 2); G.board.sourceText is the one renderer, so this prints what Board Drill prints.
          if (card) fb.appendChild(el("p.hint", { style: "margin:0", text: "Source: " + G.board.sourceText(card) }));
          fbBox.appendChild(fb);
          var last = idx === selfCheck.length - 1;
          var next = el("button.btn.sm", { type: "button", text: last ? "See your score" : "Next question", style: "margin-top:8px" });
          next.addEventListener("click", function () { idx++; draw(true); });
          fbBox.appendChild(next);
          say(verdict + " The answer is: " + item.choices[item.answer] + ".");
          focusOn(fb);
        });
        buttons.push(b); group.appendChild(b);
      });
      body.appendChild(group); body.appendChild(fbBox);
      if (takeFocus) { say("Question " + (idx + 1) + " of " + selfCheck.length + "."); focusOn(qEl); }
    }
    draw(false); mount.appendChild(audit);

    var LONG_LABEL = "flex-shrink:1;min-width:0;max-width:100%";
    var practice = el("div.btn-row", { style: "gap:8px;flex-wrap:wrap;margin-top:10px" });
    var board = el("button.btn.primary", { type: "button", style: LONG_LABEL, text: "Practice Cybersecurity Fundamentals questions (" + cards.length + ")" });
    board.addEventListener("click", function () { if (G.board) G.board._filterCat = CATEGORY; location.hash = "#/board"; }); practice.appendChild(board);
    mount.appendChild(practice);
  }
  G.opsec.render = render;

  G.opsec.fundamentals = { CATEGORY: CATEGORY, cards: cardsInBank(), terms: termsInBank(), selfCheck: selfCheck.slice() };
})();
