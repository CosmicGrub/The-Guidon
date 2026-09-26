/* ==== js/06-opsec-cyber-curriculum.js ==== */
/* GUIDON — Cybersecurity & OPSEC: the #/cyber-opsec screen.

   ROADMAP 3g E split: this file used to BOTH push cards/terms/scenarios into
   the seed at load AND own this screen - a genuine hybrid, since a
   "content-pack" module must not touch the DOM or a route. The content
   (34 board cards, 20 dictionary terms, 4 scenarios) now lives in
   06-opsec-cyber-curriculum-content.js ("emit":"build", runs at build time);
   this file keeps the original name and id (opsec-cyber-curriculum) because
   07-cyber-fundamentals.js's "requires" and its G.opsec.render load-time
   patch point at that id. By the time this file's <script> runs, the seed
   already carries every pack's content (whether merged at build time or, in
   an unbuilt dev checkout, not at all) - so this reads seed.board.questions
   the same way any other screen does, instead of keeping its own copy. */
(function () {
  "use strict";
  var G = window.G = window.G || {};
  var seed = window.GUIDON_SEED;
  if (!seed) return;

  var CATEGORY = "Cybersecurity & OPSEC";
  function cardsInBank() {
    return (seed.board && Array.isArray(seed.board.questions) ? seed.board.questions : []).filter(function (q) { return q.category === CATEGORY; });
  }
  var scenarioList = seed.scenarios && Array.isArray(seed.scenarios.scenarios) ? seed.scenarios.scenarios : null;

  /* Each question names the board card that teaches it, so the feedback shown
     after an answer is that card's own answer and source - one set of facts and
     one set of citations, not a second copy that can drift. `why` replaces the
     card's answer only where the card's wording would not read as a reply. */
  var selfCheck = [
    { q:"A document is marked CUI. What should you do before pasting it into GUIDON?", choices:["Paste it, because GUIDON keeps everything on this device","Do not paste it; use authorized handling systems and procedures","Remove the CUI banner and paste the rest"], answer:1, card:"opsec-cyber-33" },
    { q:"Can GUIDON's automatic text check decide that a document is free of CUI or safe to share?", choices:["Yes","Only if it finds no unit identification code","No"], answer:2, card:"opsec-cyber-10" },
    { q:"What is the safest response to an unknown USB drive near a government workstation?", choices:["Connect it to identify the owner","Do not connect it and follow local reporting/handling procedures","Use a personal laptop"], answer:1, card:"opsec-cyber-16" },
    { q:"Why can fitness-app route sharing be an OPSEC concern?", choices:["It can reveal location/timing patterns","It reduces battery life","It changes promotion points"], answer:0, card:"opsec-cyber-07" },
    { q:"GUIDON keeps everything on your device. Does that by itself approve it for use on a government network?", choices:["Yes","No","Only on Wi-Fi"], answer:1, card:"opsec-cyber-22" },
    { q:"What is the correct view of legacy FOUO markings?", choices:["FOUO is automatically one specific CUI category","FOUO is a legacy marking that must be handled under applicable transition/current guidance","FOUO means classified"], answer:1, card:"opsec-cyber-13" },
    { q:"What should happen after CUI or personal information is accidentally sent over an unauthorized channel?", choices:["Hide it if deleted quickly","Contain further dissemination and follow organizational incident-reporting procedures","Post a correction publicly"], answer:1, card:"opsec-cyber-12" },
    { q:"What does UCMJ Article 103a address?", choices:["Espionage","Routine password expiration","Promotion eligibility"], answer:0, card:"opsec-cyber-31" },
    { q:"What is the preferred roster identifier in GUIDON?", choices:["Full legal name and DoD ID","Initials/callsign/roster number","Home address"], answer:1, card:"opsec-cyber-26",
      why:"GUIDON is an unofficial study tool, not a personnel system. Keep roster entries to initials, a callsign, or a roster number; sensitive personnel records belong in authorized systems." },
    { q:"What is an OPSEC aggregation risk?", choices:["Multiple harmless-looking facts combine to reveal critical information","A file is too large","A password contains symbols"], answer:0, card:"opsec-cyber-04" },
  ];

  /* The seed already had an "OPSEC & Information Security" category (the
     five-step OPSEC process, the Critical Information List, the fullest CUI
     card). This page used to practice only the category this module adds, so
     the strongest existing cards sat outside the curriculum. */
  var RELATED_CATEGORY = "OPSEC & Information Security";

  function render(mount) {
    var util=G.util, el=util.el; util.clear(mount);
    function say(msg){ try{ if(util.announce) util.announce(msg); }catch(e){} }
    mount.appendChild(el("div.section-title",{},[el("h2",{text:"Cybersecurity & OPSEC"}),el("div.rule")]));
    mount.appendChild(el("p.hint",{text:"Practice public, unclassified Army/DoD information-protection fundamentals. This is training — not a classification authority, legal opinion, incident-response substitute, or authorization to use GUIDON on a government network."}));

    var warn=el("div.panel",{style:"margin-bottom:10px;border-left:3px solid var(--amber)"});
    warn.appendChild(el("div.eyebrow",{text:"Operational safety boundary"}));
    warn.appendChild(el("p",{text:"Use only public or synthetic training information here. Never paste classified information, CUI, real operational orders/rosters, real mission grids, or sensitive identifiers into this training module."}));
    mount.appendChild(warn);

    var cardCount = cardsInBank().length;
    var relatedCount=seed.board.questions.filter(function(q){return q.category===RELATED_CATEGORY;}).length;
    var stats=el("div.panel-grid-2",{},[
      el("div.panel",{},[el("div.eyebrow",{text:"Board bank"}),el("div.v",{text:cardCount+" Cyber/OPSEC questions"+(relatedCount?" + "+relatedCount+" OPSEC & information security":"")})]),
      el("div.panel",{},[el("div.eyebrow",{text:"Scenario lane"}),el("div.v",{text:"4 decision scenarios"})])
    ]); mount.appendChild(stats);

    var scPanel=el("div.panel",{style:"margin-top:10px"}); scPanel.appendChild(el("h3",{text:"Interactive scenarios"}));
    ["sc-opsec-social-engineering","sc-cyber-removable-media","sc-opsec-fitness-tracking","sc-cui-spillage-reporting"].forEach(function(id){
      var sc=scenarioList&&scenarioList.find(function(s){return s.id===id;}); if(!sc)return;
      var row=el("div.card",{style:"margin-top:8px"},[el("div.k",{text:sc.title}),el("div.hint",{text:sc.scene})]);
      var b=el("button.btn.sm.ghost",{type:"button",text:"Open in Train →","aria-label":"Open "+sc.title+" in Train",style:"margin-top:6px"});
      var note=el("p.hint",{role:"status",style:"margin-top:6px;display:none"});
      /* This used to set the hash and flash "Open scenario: <title>" for two
         seconds - the Soldier landed on the whole Train catalog and had to
         find the scenario by hand. G.engine._pending is the shell's own
         open-this-scenario hand-off (Board Drill's "related scenario" link
         uses it), so Train opens straight into it. */
      b.addEventListener("click",function(){
        var visible=true;
        try{ visible=!G.store||!G.store.scenarios||G.store.scenarios().some(function(s){return s.id===id;}); }catch(e){}
        if(!visible){
          note.textContent="This scenario is written for E4 to E6, and your Focus tier in Settings is hiding it. Set Focus tier to All ranks to open it.";
          note.style.display=""; say(note.textContent); return;
        }
        if(G.engine) G.engine._pending=id;
        location.hash="#/train";
      });
      row.appendChild(b); row.appendChild(note); scPanel.appendChild(row);
    }); mount.appendChild(scPanel);

    /* ---- 10-question self-check ----
       It used to clear and redraw on every answer with no focus handling and
       no spoken feedback: the button a keyboard user had just pressed was
       destroyed (focus fell to the page body, ten times over), nobody was told
       whether an answer was right, and the only result was an unannounced
       "Score: n / 10". Now every answer is followed by a feedback panel - right
       or not, the correct choice, why, and the source - which takes focus and
       is announced; "Next question" moves focus to the next question. */
    var audit=el("div.panel",{style:"margin-top:10px"}); audit.appendChild(el("h3",{text:"10-question knowledge audit"})); /* the Guided Tour's text for this page calls it "the 10-question audit" */
    var body=el("div"); audit.appendChild(body); var idx=0,score=0,missed=[];
    function cardFor(item){ var qs = (seed.board && seed.board.questions) || []; for(var i=0;i<qs.length;i++) if(qs[i].id===item.card) return qs[i]; return null; }
    function focusOn(node){ try{ node.focus({preventScroll:false}); }catch(e){} }
    function draw(takeFocus){
      util.clear(body);
      if(idx>=selfCheck.length){
        var done=el("p.k",{tabindex:"-1","data-selfcheck":"score",text:"You got "+score+" of "+selfCheck.length+"."});
        body.appendChild(done);
        if(missed.length){
          body.appendChild(el("p.hint",{text:"Worth another look:"}));
          var ul=el("ul",{style:"margin:4px 0 8px 18px;padding:0"});
          missed.forEach(function(n){ var it=selfCheck[n]; ul.appendChild(el("li",{style:"margin:3px 0",text:it.q+" — "+it.choices[it.answer]})); });
          body.appendChild(ul);
        }
        var again=el("button.btn.sm",{type:"button",text:"Run again"});
        again.addEventListener("click",function(){idx=0;score=0;missed=[];draw(true);});
        body.appendChild(again);
        say(done.textContent+(missed.length?" "+missed.length+" to look at again.":""));
        if(takeFocus) focusOn(done);
        return;
      }
      var item=selfCheck[idx], answered=false, buttons=[];
      var qEl=el("p.k",{id:"opsec-selfcheck-q",tabindex:"-1","data-selfcheck":"question",text:"Question "+(idx+1)+" of "+selfCheck.length+": "+item.q});
      body.appendChild(qEl);
      var group=el("div",{role:"group","aria-labelledby":"opsec-selfcheck-q"});
      var fbBox=el("div");
      item.choices.forEach(function(c,i){
        var b=el("button.btn.sm.ghost",{type:"button",text:c,"aria-pressed":"false",style:"display:block;margin-top:6px;text-align:left"});
        b.addEventListener("click",function(){
          if(answered) return; answered=true;
          var right=i===item.answer; if(right) score++; else missed.push(idx);
          b.setAttribute("aria-pressed","true");
          buttons.forEach(function(x,j){
            /* aria-disabled, not disabled: a disabled button that holds focus drops it to the page body. */
            x.setAttribute("aria-disabled","true");
            if(j===item.answer) x.textContent=item.choices[j]+" — correct answer";
            else if(j===i) x.textContent=item.choices[j]+" — your answer";
          });
          var card=cardFor(item);
          var verdict=right?"Correct.":"Not quite.";
          var fb=el("div.feedback."+(right?"good":"warn"),{tabindex:"-1","data-selfcheck":"feedback",style:"margin-top:10px"});
          fb.appendChild(el("p.k",{style:"margin:0 0 4px",text:verdict}));
          fb.appendChild(el("p",{style:"margin:0 0 4px",text:"The answer is: "+item.choices[item.answer]}));
          var why=item.why||(card&&card.a)||"";
          if(why) fb.appendChild(el("p.hint",{style:"margin:0 0 4px",text:why}));
          /* A board card's citation is a structured array (ROADMAP item F Wave 2); G.board.sourceText is the one renderer, so this prints what Board Drill prints. */
          if(card) fb.appendChild(el("p.hint",{style:"margin:0",text:"Source: "+G.board.sourceText(card)}));
          fbBox.appendChild(fb);
          var last=idx===selfCheck.length-1;
          var next=el("button.btn.sm",{type:"button",text:last?"See your score":"Next question",style:"margin-top:8px"});
          next.addEventListener("click",function(){idx++;draw(true);});
          fbBox.appendChild(next);
          say(verdict+" The answer is: "+item.choices[item.answer]+".");
          focusOn(fb);
        });
        buttons.push(b); group.appendChild(b);
      });
      body.appendChild(group); body.appendChild(fbBox);
      if(takeFocus){ say("Question "+(idx+1)+" of "+selfCheck.length+"."); focusOn(qEl); }
    }
    draw(false); mount.appendChild(audit);

    // .btn-row .btn is flex-shrink:0 app-wide, so a label this long stays one
    // line and overflows a folded phone (344px). Same fix as .qz-back .btn-row .btn.
    var LONG_LABEL="flex-shrink:1;min-width:0;max-width:100%";
    var practice=el("div.btn-row",{style:"gap:8px;flex-wrap:wrap;margin-top:10px"});
    var board=el("button.btn.primary",{type:"button",style:LONG_LABEL,text:"Practice Cybersecurity & OPSEC questions ("+cardCount+")"});
    board.addEventListener("click",function(){if(G.board)G.board._filterCat=CATEGORY;location.hash="#/board";}); practice.appendChild(board);
    if(relatedCount){
      var related=el("button.btn",{type:"button",style:LONG_LABEL,text:"Practice OPSEC & information security questions ("+relatedCount+")"});
      related.addEventListener("click",function(){if(G.board)G.board._filterCat=RELATED_CATEGORY;location.hash="#/board";}); practice.appendChild(related);
    }
    mount.appendChild(practice);
  }

  G.opsec = G.opsec || {};
  G.opsec.CATEGORY = CATEGORY;
  G.opsec.selfCheck = selfCheck.slice();
  G.opsec.render = render;
})();
