# Privacy Policy — GUIDON

**Last updated:** August 8, 2026

This is the Privacy Policy for **GUIDON** (Army Leader Development Trainer), distributed as a standalone HTML app, an installable web app (PWA), a Windows desktop app, and an Android app (package `app.guidon.trainer`). It applies to every version of GUIDON, since they all run from the same source and behave identically with respect to data.

**Developer / contact:** ctsolomon95@gmail.com — this is the point of contact for any privacy questions, requests, or concerns about GUIDON.

*(Publisher note for submission: fill in the developer/publisher name exactly as it appears in the Google Play Console listing before this policy is linked from the Play Store. See the submission note at the end of this document.)*

## The short version

GUIDON does not collect, transmit, sell, or share any personal data, because GUIDON has no server to send it to. There is no account, no sign-in, no analytics, no advertising, and no network connection of any kind between the app and anyone — including the developer. Everything GUIDON knows about you stays in storage on your own device, under your control, until you delete it.

## What GUIDON is

GUIDON is an offline, single-user reference and study tool for enlisted Soldiers preparing for promotion boards. It runs entirely client-side — there is no backend server, no cloud sync, and no remote database. The app's content-security policy (`connect-src 'self'`, no external origins permitted) technically blocks the app from making any outbound network request, and this is verified automatically before every release by walking every screen in the app and confirming zero network calls and zero policy violations occur.

## Data GUIDON stores, and where

Everything below is stored **only on your device** — never on a server, because no server exists.

- **Storage locations:** an on-device database (IndexedDB, database name `guidon`) holding your profile, saved answers, quiz/board-drill history, and progress; plus a small amount of on-device browser storage (localStorage) for interface preferences like your selected theme.
- **Profile information you enter:** things like your name, rank, MOS, ETS date, target board date, study weak points, and readiness answers, which you type in to personalize your action plan and drills.
- **Practice and progress data:** quiz attempts, Mock Board results, streaks, and scenario progress, generated as you use the app.
- **Squad roster (optional, leader-facing feature only):** if you use the roster feature, you may enter the names, ranks, and counseling dates of Soldiers you lead. This is the one place GUIDON stores information about people other than you, so it is handled with an extra layer of care — see the next section.

None of the above ever leaves your device automatically. GUIDON has no way to transmit it anywhere.

## The squad roster gets extra protection

Because the roster feature is the only place GUIDON stores data about someone other than the app's user, it is treated differently from everything else:

- If you ever export a backup of your GUIDON data (a JSON file you create yourself, entirely on-device, for your own safekeeping), **the squad roster is excluded by default.** Your own profile, progress, and drill history are included; roster entries about other people are not.
- Including the roster in a backup requires a separate, explicit opt-in action — it is never bundled in by accident.
- This default-exclude / explicit-opt-in behavior is checked automatically before every release.

## Backups are yours, not ours

GUIDON can generate a backup file (JSON) of your data on request. This file is created locally in your browser and saved to your device — the same way any file download works. GUIDON does not upload it anywhere; the developer never sees it. What you do with that file afterward — keep it, delete it, email it to yourself, put it on a shared drive — is entirely your choice and outside GUIDON's control. If you choose to share a backup file that includes the optional squad roster data, you are sharing information about other people, so consider that before doing so.

## No accounts, no analytics, no ads, no third parties

- No sign-up, login, or account system of any kind — the "profile" in GUIDON is just a local save file, not an identity tied to you.
- No analytics or usage tracking of any kind.
- No advertising and no ad SDKs.
- No crash-reporting or telemetry services.
- No third-party code that phones home. GUIDON does not embed any third-party analytics, advertising, or tracking libraries.
- No cookies used for tracking (GUIDON isn't a website with a backend to set them against).

## Why the Android app lists an "Internet" permission

The Android build declares the standard `INTERNET` permission because its embedded WebView component (Capacitor) needs it to serve the app's own interface to itself over your device's internal loopback connection — the same mechanism every WebView-based app uses to render its screens. It is not used, and cannot be used under the app's security policy, to send any data to any external server. If you inspect network activity while using GUIDON, you will see no outbound traffic.

## Deleting your data

- **Delete your profile from inside the app:** Settings → Manage account → Delete lets you erase your name, rank, MOS, action plan, and readiness answers immediately. (Your board-drill practice history is kept separate from your profile and is not affected by this action — see the next option to remove everything.)
- **Delete everything:** uninstalling the app (Android/desktop) or clearing site data for GUIDON in your browser (PWA/standalone) permanently erases the on-device database and all locally stored preferences. Because nothing is stored anywhere else, this is a complete and permanent deletion — there is no server-side copy for the developer to retain, and no way for the developer to recover or access it afterward.

## Security

Because GUIDON never transmits your data, there is no "in transit" exposure to secure — your data simply never leaves the device. On-device storage security (encryption at rest, device lock, etc.) is provided by your operating system and browser, the same as for any other locally stored app data.

## Children's privacy

GUIDON is a professional reference tool built for enlisted U.S. Army Soldiers and is not directed at children. It does not knowingly collect data from anyone, of any age, because it does not collect data at all.

## Changes to this policy

If GUIDON's data handling ever changes (for example, if a future version adds an optional online feature), this policy will be updated first, and the "Last updated" date above will change accordingly. As of the date above, GUIDON collects nothing and transmits nothing.

## Contact

Questions, requests, or concerns about this policy or GUIDON's data handling: **ctsolomon95@gmail.com**

---

*Submission note (not part of the policy itself): before this document is linked as GUIDON's privacy policy URL in the Google Play Console, it must be (1) hosted at a public, non-geofenced HTTPS URL — Play Console does not accept a local Markdown file or a PDF — and (2) updated to name the developer/publisher exactly as it appears on the Play Store listing. Hosting is not done as part of this change; it's a follow-up step before Play Store submission.*
