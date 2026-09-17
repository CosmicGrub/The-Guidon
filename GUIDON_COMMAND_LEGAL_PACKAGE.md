# GUIDON Command / Legal / OPSEC Review Package

> **DRAFT FOR REVIEW — NOT A LEGAL OPINION, SECURITY CERTIFICATION, ATO, NETWORK CONNECTION APPROVAL, PUBLIC-RELEASE AUTHORIZATION, OR DOD/ARMY ENDORSEMENT.**
>
> This package documents design controls and testable repository facts so a commander, Command Judge Advocate (CJA), S2/OPSEC officer, cybersecurity representative, privacy official, or Public Affairs reviewer can make the determinations that belong to their authorities.

## Memorandum for Record Template

**MEMORANDUM FOR** Commander / Command Judge Advocate / S2 OPSEC Officer / Cybersecurity Representative / Public Affairs Representative

**SUBJECT:** Technical and Information-Protection Review of GUIDON, an Unofficial Leader-Development Study Application

1. **Purpose.** This memorandum provides a review package for GUIDON, an unofficial and independently developed study application. It describes the application's architecture, built-in content policy, local-data controls, OPSEC/CUI safeguards, networking boundary, and known limitations. It does **not** request or represent Department of Defense or Department of the Army endorsement.

2. **Architecture.** The distributable study experience is designed to operate offline and client-side. Core study data and user progress are maintained locally rather than through a GUIDON-operated cloud account or telemetry service. Network-capable Study Rooms are a separate, user-enabled local-room feature and are accompanied by an explicit warning that offline-first design does not itself authorize operation or connection on DoD/Army enterprise networks.

3. **Built-in content policy.** Repository-maintained study content is limited by project policy to publicly released, unclassified government publications and synthetic/fictional training examples. The project does not intentionally seed real operational orders, real rosters, real mission grids, classified information, or CUI. Public-source provenance does not by itself constitute a public-release determination for every possible derivative compilation; OPSEC aggregation and other release considerations remain relevant.

4. **User-entered information.** GUIDON instructs users not to enter classified information, CUI, real operational orders/rosters, mission grids, sensitive identifiers, or information not authorized for storage on the device. The MOI import path screens text **before** the matching/persistence pipeline. Marked classified/CUI-looking material is stopped rather than rewritten into a purportedly safe document. Direct identifiers such as contextual UICs, contextual DoD IDs/EDIPI, SSNs, telephone numbers, and email addresses can be detected/redacted locally. Likely future operational-date/location combinations are flagged for removal or fictionalization.

5. **Important limitation of automated screening.** The input guard is a prevention aid only. It is not a classification authority, CUI determination, declassification process, sanitization authority, public-release review, privacy review, or legal opinion. Information may be sensitive because of context or aggregation even when no configured pattern is detected. A user who is uncertain must not move the information into a personal study tool and should use established organizational security/privacy/records channels.

6. **Squad roster boundary.** The roster is intentionally limited to lightweight readiness-date tracking and asks users to use initials, callsigns, or roster numbers rather than full legal names. Sensitive identifiers and narrative personnel information are expressly prohibited. The roster remains excluded from normal GUIDON study-data backups by design.

7. **Study Rooms network boundary.** The Study Rooms UI permanently states that the feature is for personal/off-duty local Wi-Fi by default and must not be used on DoD/Army enterprise networks unless the organization has explicitly authorized the application and connection under its cybersecurity/network-connection process. GUIDON does not claim to detect NIPRNet/DoDIN automatically, and does not represent local-only operation as an Authorization to Operate (ATO).

8. **Training module.** The `#/cyber-opsec` section contains public/unclassified board-study questions, glossary terms, synthetic decision scenarios, and a local knowledge self-check. Legal-awareness content distinguishes Article 92, Article 103a (espionage), and Article 134 rather than presenting ordinary cybersecurity mistakes as automatically criminal.

9. **Requested review.** Reviewers are requested to evaluate the implementation and identify any organization-specific restrictions, required notices, public-release concerns, privacy concerns, connection-approval requirements, or content that should be revised before command-sponsored or government-system use is contemplated.

### Reviewer Findings

- [ ] No objection to personal/off-duty use as an unofficial study aid, subject to local policy.
- [ ] Additional OPSEC review required.
- [ ] Additional cybersecurity/network authorization review required.
- [ ] Additional privacy review required.
- [ ] Additional Public Affairs/public-release review required.
- [ ] Additional legal review required.
- [ ] Changes required before further use/presentation: __________________________________________

**Reviewer name/title:** __________________________________________  
**Office/role:** _________________________________________________  
**Date:** __________________  **Signature:** ______________________

---

## Audit Matrix

| Baseline | Repository safeguard / evidence target | What the control demonstrates | Limitation / reviewer action |
|---|---|---|---|
| **AR 530-1 — Operations Security** | Public/synthetic seed policy; OPSEC disclaimer; MOI pre-persistence guard; aggregation-risk flag; synthetic Cyber/OPSEC scenarios | The product is designed to avoid seeding operational details and to interrupt obvious sensitive-input/aggregation patterns | Automated detection cannot determine all critical information or aggregation risk. Unit critical-information lists and local OPSEC guidance remain authoritative. |
| **DoDD 5205.02E — DoD OPSEC Program** | OPSEC curriculum defines critical information, indicators, aggregation, and protective measures; scenarios use fictional facts | Training reinforces the OPSEC process without reproducing an actual mission | Does not constitute an organizational OPSEC assessment or program review. |
| **AR 25-2 — Army Cybersecurity** | No new telemetry/cloud backend; removable-media/social-engineering training; Study Rooms official-network warning; local sensitive-input controls | Demonstrates defensive design intent and user-facing cybersecurity boundaries | Does not create an ATO, approved software-list status, or connection approval for an Army/DoD system. Local authorization remains required. |
| **DoDI 8510.01 — RMF for DoD IT** | Training explains RMF/ATO; network warning explicitly says offline-first is not authorization | Prevents the application from representing architecture choices as authorization decisions | The applicable AO/system owner determines authorization requirements for government-system use. |
| **DoDI 5200.48 — CUI Program** | CUI definitions/training; marked CUI-looking input hard-stopped; incident scenario directs users to contain and follow organizational reporting procedures | Discourages unauthorized placement/dissemination and avoids claiming regex-based declassification | CUI designation/handling is authority-, category-, marking-, and context-dependent. The guard cannot make a CUI determination. |
| **DoDI 5400.11 / Privacy Act framework** | Squad roster minimizes fields, asks for initials/callsigns/roster numbers, rejects configured identifiers, excludes roster from normal backup | Data minimization and local-storage design reduce collection/dissemination risk | Local storage does not automatically determine Privacy Act applicability or satisfy every privacy/records requirement. Do not use GUIDON as a system of record. |
| **AR 360-1 — Public Affairs** | Product labels itself unofficial/independent and disclaims DoD/Army endorsement | Reduces risk that users mistake the app for an official Army product or official release | This is not a PA clearance. Organization-specific public-release/branding review may still be required. |
| **DoDI 5230.09 — Clearance of DoD Information for Public Release** | Public-source-only project policy plus explicit warning that derivative aggregation can still require review | Avoids the false rule that “public source = every new compilation automatically releasable” | Authorized officials determine whether particular DoD information proposed for release requires review/clearance. |
| **UCMJ Article 92 — 10 U.S.C. § 892** | Training describes Article 92 generally and expressly states that not every cybersecurity mistake automatically establishes an offense | Avoids giving users a misleading criminal-liability conclusion | Case-specific elements, orders/duties, mental state, defenses, and disposition require qualified legal review. |
| **UCMJ Article 103a — 10 U.S.C. § 903a** | Training identifies Article 103a as espionage only | Prevents misuse of Article 103a as a generic “information mishandling” label | No case-specific criminal-law assessment is made. |
| **UCMJ Article 134 — 10 U.S.C. § 934** | High-level General Article awareness card only | Provides board-study awareness without predicting liability | Application of Article 134 is offense- and fact-specific and requires legal analysis. |

## Verification Checklist for a Release Candidate

- [ ] `#/cyber-opsec` appears in the declared route and Board Prep navigation.
- [ ] The Cyber/OPSEC bank contains at least 30 canonical board questions; current design target is 34.
- [ ] Four synthetic Cyber/OPSEC scenarios load through the canonical scenario bank.
- [ ] Twenty required Cyber/OPSEC terms are present after deduplication/update.
- [ ] The 10-question self-check renders locally.
- [ ] Marked `SECRET`, `CONFIDENTIAL`, and CUI-looking samples are blocked by the ingestion guard.
- [ ] Contextual UIC/DoD-ID and SSN/contact samples are not persisted unchanged through guarded inputs.
- [ ] A future operational date + location sample is flagged for review rather than certified “safe.”
- [ ] MOI import screens text before `runMatching()` and persistence.
- [ ] Squad roster identifier changes reject configured sensitive-input findings.
- [ ] Study Rooms shows the official-network authorization warning regardless of room state.
- [ ] No helper/patch workflow remains in the final branch.
- [ ] Full CI, Desktop, and iOS gates are green on the exact merge head.

## References for Reviewer Verification

Use the current official versions and local command supplements when reviewing. Principal federal/DoD/Army baselines considered by this package include AR 530-1, AR 25-2, AR 360-1, DoDI 5200.48, DoDI 8510.01, DoDI 5230.09, DoDD 5205.02E, DoDI 5400.11, and the current UCMJ/Manual for Courts-Martial. The presence of a citation in GUIDON does not convert this package into an official interpretation of that authority.
