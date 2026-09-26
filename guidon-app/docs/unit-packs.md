# Unit decks: a study deck for your own unit

A **unit deck** is a small file of study cards about *your* unit: standing SOP
facts, local policies, unit history and lineage, local promotion-board study
material. A leader, the S3 or an NCOIC writes it once and hands it to Soldiers
as a file. Each Soldier adds it on their own device, and its cards show up in
Board Drill, Quiz, Rapid Fire and Search as an extra deck they can switch off.

This page is for the person who **writes** the deck. Soldiers only need the
last section.

> **A unit deck is not Army doctrine and GUIDON does not check it.** It is your
> unit's own material. It is only as accurate as the person who wrote it, and
> the unit's real orders and the current publications always win. Every card
> from a unit deck is labeled **Unit deck: (name)** so nobody mistakes it for
> doctrine.

---

## What may go in, and what may not

**Good things to put in a deck**

- Local SOP facts a Soldier should know cold: formation times, where to turn
  in a form, who approves what.
- Unit history and lineage: how the unit got its name, its motto's meaning, its
  honors.
- Local promotion-board study material: the topics your board asks, how the
  board runs.

**Never put in a deck**

| Do not include | Why |
|---|---|
| Classified information or Controlled Unclassified Information (CUI), or anything with a classification or handling marking | A study deck sits on personal devices. GUIDON is not approved for either. |
| Personal data: Social Security numbers, DoD ID numbers, home addresses, personal phone numbers, personal email addresses | Nothing about individual Soldiers belongs in a study deck. |
| A roster, a duty list, an alert roster, or any list of Soldiers' names | Same reason. GUIDON refuses a deck that looks like one. |
| Real operational details: future movements, real grids, real locations of unit activities | OPSEC. |
| The words of a unit song, creed or anything else somebody may own the copyright to | GUIDON ships no lyrics, and a deck cannot carry text to recite (see "Recitation titles" below). |
| Anything that needs an approval you have not got: release approval, command approval, legal or public-affairs review | Get the approval first. GUIDON cannot know. |

**You are responsible for what is in your deck.** GUIDON runs a check when a
Soldier adds it (below), but that check is a safety net that misses things. It
is not a review, a clearance, or a release decision.

---

## Building a deck

You need Node.js (the same one used for the rest of GUIDON's tools). Nothing
else, and nothing is sent anywhere.

### From a spreadsheet (CSV)

Save a spreadsheet as CSV. The first row is the header. The columns are:

| Column | Required | What it holds |
|---|---|---|
| `category` | yes | A short topic name, up to 40 characters ("Local SOP"). Cards are grouped by it. |
| `question` (or `q`) | yes | The question, up to 300 characters. |
| `answer` (or `a`) | yes | The answer, up to 1,200 characters. |
| `key points` | no | Up to 8 short points, separated by `|`. |
| `source` | no | Where the fact comes from, in your unit's own words ("Squadron SOP 2026, para 4"). |
| `id` | no, but use it | A short stable name for the card ("sop-001"): lower-case letters, digits and dashes. |

Put a few lines at the very top starting with `#` to describe the deck:

```
# id: pinecone-ridge-demo
# name: Pinecone Ridge Demo Squadron study deck
# unit: Pinecone Ridge Demo Squadron (fictional)
# version: 2026.09
# date: 2026-09-26
# recite: Squadron song
# recite: Squadron motto
id,category,question,answer,key points,source
sop-001,Local SOP,What time is Monday morning formation?,Formation is at 0630.,...
```

Then, from the `guidon-app` folder:

```
node tools/make-unit-pack.mjs my-unit-cards.csv --out my-unit.pack.json
```

The command checks the deck the same way GUIDON does when a Soldier adds it. If
something is wrong it says which card and which field, in plain words, and
writes nothing.

- Exit 0: the deck is good and the file was written.
- Exit 1: a limit or format problem (a field too long, a missing column).
- Exit 2: the sensitive-text check found something. Reword it and run it again.

Add `--check` to test a deck without writing a file. You can also give the
details on the command line instead of the `#` lines: `--id`, `--name`, `--unit`,
`--version`, `--date`, and `--recite "Unit song"` (as many times as you like).

### From a JSON file

The same command reads a JSON file. It can be a finished deck, or the easier
form: `version` and `date` instead of `packVersion` and `packDate`, `question`
and `answer` spelled out, and no format fields. A complete example is in
`tools/fixtures/unit-pack-authoring-example.json`, and the same deck as a
spreadsheet is `tools/fixtures/unit-pack-example.csv`. Both make exactly the
finished file `tools/fixtures/unit-pack-example.pack.json`. **That deck is
fictional** (a made-up "Pinecone Ridge Demo Squadron"); use it to see the
shape, then replace every word.

### Keep card ids steady

The `id` on each card is how GUIDON remembers a Soldier's progress on it. If you
change a card's wording, keep its id and its progress stays. If you delete a
card and reuse its id for a different question, Soldiers' progress will attach
to the wrong card. If you leave the `id` column out, the command numbers the
cards by row (c001, c002, ...), which breaks progress the day you reorder rows.

---

## The format, and its limits

A finished deck is one JSON file, **format `guidon-unit-pack`, version 1**. It is
data only: no code, no formatting, no images, and nothing GUIDON fetches. Angle
brackets and web addresses in a card are just text: shown as typed, never
clickable, never loaded. Any field GUIDON does not know is refused, so a typo
cannot slip through.

| Part | Rule |
|---|---|
| `format` | The text `guidon-unit-pack`. |
| `formatVersion` | The number `1`. A deck from a newer format is refused with a message to update GUIDON. |
| `id` | Deck id: 3 to 40 characters of lower-case letters, digits and single dashes. Pick a distinctive one ("alpha-troop-sop"); adding a deck with the same id replaces the old one. |
| `name` | Deck name, up to 60 characters. |
| `unit` | Optional unit label, up to 60 characters. |
| `packVersion` | Your version label, up to 20 characters (letters, digits, dots, dashes): "2026.09". |
| `packDate` | A real date, year-month-day: "2026-09-26". |
| `cards` | 1 to 200 cards, and no more than 30 different categories. |
| card `id` | 1 to 30 characters, lower-case letters, digits, dashes. Unique in the deck. |
| card `category` | Up to 40 characters. |
| card `q` | Question, up to 300 characters. No two cards may ask the same question. |
| card `a` | Answer, up to 1,200 characters (may have line breaks). |
| card `keyPoints` | Optional. Up to 8 points, up to 200 characters each. |
| card `source` | Optional. Up to 200 characters, your unit's own words. |
| `reciteTitles` | Optional. Up to 8 titles, up to 60 characters each. Titles only. |
| Whole file | Up to 256 KB. |

**How `source` is shown.** GUIDON reads the source with the same careful parser
it uses for its own cards. "AR 600-20, para 4-5" becomes a proper citation;
"Squadron SOP 2026" stays exactly as you wrote it, as a named source, never
turned into a fake regulation. GUIDON never adds an edition or a paragraph you
did not write, and never marks a unit card as a word-for-word quote.

---

## What GUIDON does when a Soldier adds your deck

1. **Reads it, and only as data.** A wrong format, a field too long, a field it
   does not know, or a newer format version stops the import with a plain
   message.
2. **Checks every word for things that do not belong.** If it finds *any* of
   these, the **whole deck is refused** and the message says which card and
   which field: classification or handling markings ("SECRET//NOFORN", "(CUI)",
   a banner line, a CUI block), Social Security and DoD ID numbers, unit
   identification codes with their label, telephone numbers, email addresses, a
   sentence with a future date and a place and a unit activity, and text that
   looks like a list of people's names. The check reads the words as typed; it
   never edits them.
3. **Shows a preview** (name, unit, version, how many cards and categories,
   sample cards) and a notice that the deck comes from the unit, GUIDON has not
   checked it for accuracy, it never leaves the device, and it is not for
   classified or controlled information.
4. **Adds it only when the Soldier taps "Add this deck".**

The check is a prevention aid. It looks for particular shapes. It cannot tell
that something is sensitive because of what it is, or because of what several
harmless facts add up to. It is a safety net for honest mistakes, not a defense
against someone who is trying to slip something past it. If you are unsure
whether something may go in a deck, it may not: ask your S2 or OPSEC officer.

---

## Recitation titles ("Unit song", "Unit motto")

Most units have a song, a creed or a motto Soldiers are expected to know. GUIDON
will not carry those words: they usually belong to somebody, and the app ships
no copyrighted text. A deck can only **suggest titles**. Once the deck is on,
each title shows in Recitation Drill under **My unit** as an empty "Add: Unit
song" prompt, and the Soldier types in their own copy, which stays on their own
device. Do not put the words in a deck, in a card or anywhere else.

---

## Handing it out

Give the file to Soldiers the way your unit already shares documents of that
kind (a shared drive, an email, a chat post). GUIDON does not host, send or
collect decks, and has no server to do it. Use only channels your unit already
approves for the information in the deck.

Tell Soldiers:

- it is the unit's material, not Army doctrine;
- which version it is (the version label and date show in Settings);
- to add the new one when you send an update.

**Updating.** Send a new file with the *same deck id* and a new version label.
When a Soldier adds it, it replaces the old one; their progress on cards that
are still in the deck is kept, and a deck they had switched off stays off.

---

## For Soldiers: adding and removing a unit deck

1. Open **Settings**, then **Study Preferences**, then **Unit decks**.
2. Tap **Add a unit deck**. Choose the file your unit gave you, or paste its text.
3. Tap **Check this deck**. If GUIDON refuses it, it tells you which card and
   which field. Nothing was saved; ask your unit for a corrected file.
4. Read the preview, then tap **Add this deck**.
5. The deck's cards now appear in Board Drill, Quiz, Rapid Fire and Search, each
   labeled **Unit deck: (name)**. **Readiness** has a separate **Unit Deck
   Readiness** row, and unit cards are not counted in your Board Readiness Score.
6. Use the switch beside the deck to turn it off or on.
7. **Remove deck** asks first. You choose whether to keep or delete your study
   progress on its cards (keep it if you might add the deck again). **Reset
   progress** clears your progress and keeps the deck.

Good to know:

- A deck stays on your device. It is not sent anywhere, and it is not shared into
  Study Rooms. It is not on the handheld flashcard device.
- Your decks are part of your own study data, so they are in a backup you export
  and come back when you restore it.
- In a Guest or Kiosk session you can add a deck, but nothing is saved. It is gone
  when the session ends.
- A deck that is switched on is always part of what you study. The narrowing that
  trims the built-in cards (your Focus tier setting, an MOS, an MOI plan set to "In Scope",
  Rapid Fire's "Match my rank") never hides it. Switch the deck off to hide it.
- Cards from a unit deck are not counted in Home's due count or in the weak-area
  lists, which are about the built-in cards.
- You can keep up to 10 unit decks.
