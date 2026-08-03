# GUIDON — Promotion Points, Career Pathways & Channels: Research Findings

**Date:** 2026-07-23
**Purpose:** Research requested for the MOS Career Center / onboarding MOS dropdown — promotion point requirements, per-MOS career progression, and the correct channels a Soldier goes through.
**Status:** Research only. **No app code was changed on the basis of this yet** — see §1, which is a significant enough finding that it deserves a deliberate, verified implementation pass rather than a quiet patch.

---

## 1. HEADLINE FINDING — the app's promotion points calculator is structurally outdated

GUIDON's points module (`pointsCalculator`, v0.1.0) currently models:

| Category | App's max |
|---|---|
| Military Training | 340 |
| Awards, Decorations & Achievements | 160 |
| Military Education | 200 |
| Civilian Education | 100 |
| Board Score (DA Form 3356) | 150 |

**This does not match AR 600-8-19 as it currently stands** (current edition effective **6 April 2026**). Three problems:

### 1a. The category caps are wrong, and they differ by rank
The single most-missed detail: **SGT and SSG have different caps**, so the same Soldier has two different totals. Verified against the DA-published *Guide to Enlisted Promotion Boards* (V3, 1 Jan 2026) which cites AR 600-8-19 Tables 3-2 through 3-7 and paras 3-17/3-18 directly, and independently corroborated by two further sources:

| Category | SGT (E-5) | SSG (E-6) |
|---|---|---|
| **Military Training** | **280** | **230** |
| — Weapons qualification | 160 | 110 |
| — AFT (Army Fitness Test) | 120 | 120 |
| **Awards, Decorations & Achievements** | **145** | **165** |
| **Military Education** | **240** | **245** |
| — Resident training | 110 | 115 |
| — PME (Commandant's List 20 / DHG 40) | 20/40 | 20/40 |
| — Computer-based training | 90 | 90 |
| **Civilian Education** | **135** | **160** |
| **TOTAL** | **800** | **800** |

### 1b. There is no longer a "board score" points category
Leadership points were **removed** for SSG semi-centralized boards and replaced with a **"Yes"/"No" validation vote**. SGT boards are administrative points only. The app's 150-point "Board Score (DA Form 3356)" category no longer reflects how the system scores.

Separately — and this is the part worth keeping — **150 additional promotion points** are added on top of the 800-point total, outside the category caps, for:
- E-4s recommended for SGT who are **BLC graduates**
- E-5s recommended for SSG who are **ALC graduates**

### 1c. ACFT → AFT
The **Army Fitness Test replaced the ACFT on 1 June 2025**, and promotions have used AFT scores since **1 October 2025**. Five events (3-rep-max deadlift, hand-release push-up, sprint-drag-carry, plank, two-mile run); passing 300 for most specialties, **350 for combat specialties**.

**Common error to avoid:** fitness points are *not* raw score ÷ 5. A 500 AFT is worth 80 points, not 100. IPPS-A applies the conversion automatically from the record score — so a calculator should ask for the *points* (0–120) or replicate the real table, not divide.

### 1d. Weapons points are hit-count based, not badge based
AR 600-8-19 uses hit-count tables — 40/40 hits = 160 (SGT) / 110 (SSG), stepping down per hit. A minimum-qualifying 23 hits is only ~33 points for SGT. Qualification is **valid 24 months**. The Soldier must be correctly associated with their primary weapon in **ATIS** before qualifying or the score scores zero.

### Other confirmed point rules worth encoding
- **Combat zone service:** 2 points/month, max 30 (SGT) / 60 (SSG) — counts inside the awards cap
- **Correspondence / computer-based:** 1 point per 5 hours, **whole courses only** (no sub-course credit), no duplicates
- **Ranger / Special Forces / Sapper:** 40 points, all phases complete
- **Other ATRRS courses:** 4 points per week (40 training hours)
- **NOT authorized points:** MOS-producing courses, badge-producing courses, BCT, AIT, new equipment training, language training, OCS, WOCC
- **Civilian degree bonus:** +20 points (timing rules apply — must be earned before SGT if competing for SGT; while holding SGT if competing for SSG)
- **Credentialing:** max 50 — MOS-enhancing 15 each, professional development 10 each, personal 5 each; mandatory MOS credentials earn nothing
- **DLPT 1/1:** 25 points, valid 12 months
- **CLEP / DANTES / ACT proficiency:** 2 points per credit hour

---

## 2. CUTOFF SCORES — why these must NOT be hardcoded into GUIDON

**Recommendation: do not ship per-MOS cutoff numbers in an offline app.**

- HQDA publishes cutoff scores **monthly**, per MOS, for SGT and SSG — released around the **20th of the prior month**, effective the **1st**.
- They are set by **manning math** (slots available vs. eligible Soldiers in that MOS), *not* by Soldier quality. Your points don't move; the cutoff does.
- Spread is enormous and volatile. Example from the July 2026 HQDA memo: **11B SGT 236 / SSG 430**. Other MOSs in the same month sat in the 600s.
- Two codes matter:
  - **24** = not enough eligible Soldiers — *everyone eligible promotes*
  - **798** = no promotions needed this month — *door closed regardless of score*

A cutoff table baked into a single-file offline app would be **wrong within 30 days** and confidently misleading — the worst failure mode for board-prep material. GUIDON already flags the FY26 MOS shortage data as perishable; cutoffs are perishable on a **monthly**, not semi-annual, cycle.

**What to build instead:** explain the mechanism, the 24/798 codes, the monthly rhythm, the fact that cutoffs are MOS-specific and manning-driven — and point the Soldier at the authoritative live source (HRC, via S-1). That is durable and doesn't rot.

---

## 3. ELIGIBILITY & PME GATES (stable — safe to encode)

| Rank | TIG | TIS | PME required |
|---|---|---|---|
| SGT (E-5) | 12 months | — | — |
| SSG (E-6) | 18 months | — | **BLC** (pin-on requirement) |
| SFC (E-7) | 36 months | 8 yrs | **ALC** (pin-on requirement) |
| MSG (E-8) | 36 months | 12 yrs | **SLC** (pin-on requirement) |
| SGM (E-9) | 36 months | 16 yrs | **MLC** (eligibility) / **SGM-A** (pin-on) |

*(TIG/TIS figures above are drawn from an ARNG implementation table — Regular Army primary/secondary-zone specifics should be confirmed against AR 600-8-19 directly before display.)*

**Select–Train–Educate–Promote (STEP):** PME is a *pin-on* gate, not a nice-to-have. A Soldier can sit on the list with the points and still not pin without the school.

**Flags:** A Soldier with a flag of any type may still be *considered* by the board, but **cannot be selected or promoted** until it's lifted. Not waivable.

---

## 4. THE CHANNELS — who a Soldier actually goes to, and for what

This is the part most Soldiers get wrong, and it maps cleanly onto GUIDON's existing sections.

| Need | Go to | Notes |
|---|---|---|
| Points wrong / missing in IPPS-A | **Unit S-1 / HR specialist** (via first-line leader) | S-1 keys the transactions. Most "missing points" are a data problem, not a policy problem. |
| Missing award, NCOER, DA 1059, certificate | **S-1 → iPERMS upload** | Source docs must be in iPERMS *before* being keyed in IPPS-A. Must be full PDF scans — photos of documents are rejected. |
| Course completions not showing | **ATRRS first, then S-1 CRM case** | ATRRS is the authoritative source; IPPS-A only displays it. Fix ATRRS, allow ~2 weeks, then S-1 raises a CRM case. |
| Weapons / AFT score wrong | **Unit training NCO / armorer → ATIS** | Must be in ATIS ≥48 hrs before the administrative cut-off. Confirm primary weapon is associated with you. |
| Reclassification, reenlistment, bonuses, MOS shortage/SRB info | **Career Counselor (79S)** | Owns RETAIN. The three-gate reclass rule (out-call + in-call + line-score) is checked here. |
| Assignments, branch-level career management | **HRC branch manager for your MOS** | Assignment and career-field questions, not local admin. |
| Denial of board consideration / removal from list | **Chain of command → promotion authority** (DA 4187 + DA 4856) | You get **at least 30 days** to submit a rebuttal, and may consult a **judge advocate**. |
| Board file / packet | **My Board File** (mbf.hrc.army.mil) — available 24/7 | Review and **certify** your file before the board. Upload the packet as one PDF, type "Letter to the Board". |
| Enlistment / prior-service accession | **Recruiter** | Not a promotion channel — worth stating plainly, since Soldiers sometimes ask recruiters promotion questions. |

**Promotion approval authority:** SGT/SSG — LTC or higher. SFC/MSG — COL or higher. SGM — (ARNG) The Adjutant General.

**Key systems, and what each is actually for:**
- **IPPS-A** (`my.ippsa.army.mil`) — personnel/pay system of record; where your promotion points live. Search "OML/Promotion Points".
- **iPERMS** (`iperms.hrc.army.mil`) — your official record; what board members see.
- **ATRRS** — course registration and the authoritative course-completion feed.
- **ATIS** — weapons qualification and AFT data.
- **My Board File / ASBS** — board packet review and certification.

**The one rule that matters most:** if it isn't in the system by the administrative cut-off, it doesn't count — regardless of whether you did it. Integrations must be completed by the **26th of the month**.

---

## 5. RECOMMENDED BUILD (in priority order)

1. **Rewrite the points calculator to current AR 600-8-19** — dual SGT/SSG caps, AFT not ACFT, hit-count weapons, remove the board-score category, add the +150 BLC/ALC bonus outside the caps. *This is a correctness fix on the app's single most-used practical tool.*
2. **Add a "Cutoff scores explained" panel** — the mechanism, 24/798, monthly rhythm, and where to look it up live. Explicitly **no hardcoded numbers**.
3. **Add a "Channels" reference** (the §4 table) — cross-linked from the MOS Career Center and the Points section.
4. **Add the PME/TIG/TIS gate table** to the MOS Career Center's existing NCOES ladder.
5. Re-verify the TIG/TIS figures against AR 600-8-19 directly for Regular Army before display.

---

## 6. SOURCING & CONFIDENCE

| Claim | Confidence | Basis |
|---|---|---|
| 800-point total, both ranks | **High** | Multiple independent sources incl. DA-published guide |
| Dual SGT/SSG category caps (280/230 etc.) | **High** | DA-published guide citing AR tables + 2 independent corroborations |
| Board-score category removed / Yes-No vote | **High** | DA-published guide, explicit changelog entry |
| +150 BLC/ALC points outside caps | **High** | DA-published guide para 2-4(e) + independent corroboration |
| AFT replaced ACFT, effective for promotions 1 Oct 2025 | **High** | Independent source, consistent with app's own acronym data |
| Cutoffs monthly, MOS-specific, 24/798 codes | **High** | HQDA COS memos + trackers quoting them |
| TIG/TIS table | **Medium** | Drawn from an **ARNG** implementation guide — confirm RA specifics |
| Per-MOS cutoff values | **Deliberately not captured** | Perishable monthly; would be wrong within 30 days |

**Caveat worth carrying:** the most authoritative document retrieved (*Guide to Enlisted Promotion Boards*, V3) is **Illinois ARNG**-specific. Its point tables cite AR 600-8-19 directly and were independently corroborated for the Regular Army, but any figure used in-app should be checked against AR 600-8-19 itself. Several widely-circulated calculator sites disagree with each other and with the regulation — at least one still publishes the pre-2026 structure GUIDON currently uses.
