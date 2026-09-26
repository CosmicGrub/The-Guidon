# GUIDON Flashcard OS

A minimal ESP32 firmware fork of [GUIDON](../../guidon-app) for a specific
handheld device, replacing that device's original "GameSuite Arcade OS"
firmware. It is deliberately **not** a port of the full GUIDON app — see
[Scope](#scope) below.

Branch: `esp32-flashcard-os`. Hardware, the ILI9341-vs-ST7796 spec
contradiction and how it was resolved, and the full pin map live in
[HARDWARE.md](HARDWARE.md) — read that first if you're touching display
or touch code.

## Scope

Quoting the actual instruction this was built against, so scope creep is
a deliberate future decision, not a quiet accident: *"you don't need to
try to do anything advanced, because this isn't advanced advice by any
means — just: all the flashcards, and the ability to sort and navigate
between topics/subjects."*

What this firmware **is**: a touchscreen flashcard browser. Three
screens — subject list, card view (question, tap to reveal answer,
prev/next), and a settings screen (backlight brightness, the deck picker
described below, and an install QR for the full GUIDON app). The current
canonical GUIDON board-question bank, including release-time supplements,
browsable offline by subject from a microSD card.

What this firmware **deliberately is not**: GUIDON itself. No board
drills, no grading, no SRS scheduling, no settings sprawl, no Study
Rooms, no library, no calendar. If a future change wants any of that,
that's a real scope decision to make explicitly — not something to grow
in by accretion.

The one control that scope decision has since allowed onto the settings
screen is the **deck picker**, and it is there for a rule, not for
convenience: the full GUIDON app hides every MOS-specific card (92A, 68W,
...) until a Soldier opts in, and the handheld must not be the place that
rule quietly stops holding. See [Decks](#decks-mos-lanes).

## Getting content onto the device

GUIDON's flashcard content lives inside `guidon-app/src/index.html` (the
`window.GUIDON_SEED` blob — see that app's own `tools/seed-io.mjs`). This
firmware never embeds that JSON directly (2.56MB of it, on a chip with
520KB of RAM and no PSRAM); instead:

```bash
cd firmware/esp32-flashcard-os
node tools/extract-cards.mjs      # -> ./sdcard/cards.ndjson + categories.json + lanes.json
```

See [`tools/extract-cards.mjs`](tools/extract-cards.mjs)'s own header for
the on-SD format and why it's shaped the way it is (streamed one card at
a time, never loaded whole).

The exporter checks what it is about to write against the app's committed
content manifest (`guidon-app/tools/content-manifest.json`: total cards,
cards per category, the bank fingerprint). If the deck is short, long or a
different bank, it stops, says which figure is off, and writes nothing - a
handheld once shipped 61 cards behind the app without anyone noticing. If
the app's content really did change, regenerate the manifest first:
`cd guidon-app && node tools/content-manifest.mjs --write`.

Getting those two files onto the device's actual microSD card doesn't
require a separate SD card reader — it goes over the same USB-serial
link used for flashing:

```bash
pio run -e sdloader -t upload --upload-port COM12   # flash the one-time loader
python tools/push-to-sd.py COM12                     # pushes the card files (all three)
pio run -e flashcardos -t upload --upload-port COM12 # reflash the real app
```

(If you *do* have a card reader handy, just copying `sdcard/cards.ndjson`,
`sdcard/categories.json` and `sdcard/lanes.json` onto the card's root the
normal way works identically — the loader exists for when you don't.)

## Decks (MOS lanes)

The full GUIDON app shows a Soldier only the cards that are for everyone,
and shows an MOS deck (92A, 68W, ...) only once they opt in. The handheld
does the same with **decks**:

- The **Standard deck** holds every card that carries no MOS tag — and not
  one that does. This is what the device shows when it starts.
- Each MOS deck the app registers is a deck of its own, holding exactly the
  cards tagged for that MOS.
- The Soldier picks the deck in **cfg** (Settings): one button, "Deck - tap
  to change", shows the current deck and its card count; each tap moves to
  the next deck and back round to the Standard deck. The subject list then
  shows only that deck's subjects (its header reads "92A deck", so an MOS
  deck is never mistaken for the standard one). The pick is remembered
  across restarts (NVS key `lane`); a remembered deck that is no longer on
  the card falls back to the Standard deck, never to an MOS one.
- The deck button appears only when the card carries a `lanes.json`. With no
  `lanes.json` the device behaves exactly as it did before decks existed:
  every subject in one list, and the Settings screen unchanged. Older
  firmware (flashed before decks) reading the new card files ignores the
  extra information and shows everything as it always did.
- A `lanes.json` that does not list the Standard (`default`) deck — one that
  was cut down or only partly copied to the card, so it holds MOS decks alone
  — is treated exactly like no `lanes.json`: decks stay off. The device never
  starts on, or falls back to, "the first deck in the file", because that could
  be an MOS deck the Soldier never chose. (The exporter refuses to write such a
  file in the first place.)

How the exporter works it out, and how it is checked, is in
[`tools/lanes.mjs`](tools/lanes.mjs): the MOS decks are read from the same
registry the app uses (`00-mos-decks-core.js`, not a second list), and before
any file is written every deck is counted back from the very text about to be
written and compared with the content manifest — the Standard deck must hold
no MOS card, each MOS deck must hold exactly the cards its code tags, and the
figures must add up to the manifest (`byMos`, per category, total). Any
mismatch stops the export and writes nothing, the same way a short deck does.

Memory: the deck logic is [`src/lanes.h`](src/lanes.h) — plain C++, about 1.5
KB of RAM (a table of up to 16 decks and a 2-byte deck mask per subject).
`lanes.json` is read through an ArduinoJson filter that keeps only each deck's
id, label and count, so the subject lists inside it are dropped as they
stream past. Cards are never held, as before.

CI: `.github/workflows/firmware.yml` compiles `env:flashcardos` with a pinned
PlatformIO whenever anything under `firmware/` changes (release builds also
compile it), and then runs `guidon-app/tools/test-esp32-lanes.mjs` — including
the ArduinoJson parser test — where a missing library is a failure, not a skip.

Limits (held by `guidon-app/tools/test-esp32-lanes.mjs` against both the
exporter and these sources): at most 16 decks, deck ids up to 11 characters,
deck labels up to 40 characters (the exporter shortens a longer registry
label, e.g. drops a trailing "(...)"), at most 128 subjects (the same
`MAX_CATEGORIES` as before, now enforced by the exporter instead of silently
cutting the list).

### Trying decks on the physical device (not yet done)

Everything below has been built and tested off the device — the firmware
compiles, the deck logic runs on a desktop against the real export — but
**nothing has been flashed or run on the handheld itself.** To try it:

1. `node tools/extract-cards.mjs` (from this folder). It prints the decks, e.g.
   `lanes.json  3 decks: default ..., 68W ..., 92A ...`.
2. Put the three files on the card exactly as in [Getting content onto the
   device](#getting-content-onto-the-device) — the sdloader steps, or a card
   reader. `push-to-sd.py` sends `lanes.json` on its own when it exists.
3. `pio run -e flashcardos -t upload --upload-port COMxx` (reflash the app).
   First boot after this needs no new touch calibration.
4. Check, in order:
   - The subject list opens on the **Standard deck** with the normal title and
     none of the "68W —" / "92A —" subjects in it.
   - **cfg**: the deck button sits under the backlight row; the QR, its URL and
     the "Scan for the full GUIDON app" line are all still fully on screen (the
     rows above them were packed tighter to make room — this is the thing most
     worth a look), and the QR still scans.
   - Tap the deck button: it moves to an MOS deck (name and card count change).
     **Back**: the header now reads "68W deck" (or whichever) and only that
     deck's subjects are listed. Open a card and page through it.
   - Restart the device (or power it off and on): it should come back on the MOS
     deck you left it on. Tap through to the Standard deck and restart again:
     it should come back on the Standard deck.
   - Remove `lanes.json` from the card and restart: every subject in one list,
     no deck button, Settings as it looked before.
   - The serial log (115200) prints `Decks: N on the card, showing "..."` at boot
     and `Deck: <id> (<n> subjects)` on every tap, which settles anything the
     screen does not make obvious.
   Not checked anywhere else: how the MOS subject names' long dash (for example
   `92A — MOS Fundamentals`) draws in the device's built-in font. It was
   already in the subject list before decks, so it is not new, but an MOS deck
   is now where a Soldier will see it.

## Building and flashing

[PlatformIO](https://platformio.org/) targeting a generic `esp32dev`
board (no named board def matches this handheld exactly; see
`platformio.ini`'s own comment on why that's still correct). Four
environments — `probe` and `bringup` were this project's own hardware
bring-up steps (already run once against the physical device, see
HARDWARE.md), `sdloader` is the content-loading utility above, and
`flashcardos` is the real, shipped firmware:

```bash
cd firmware/esp32-flashcard-os
pio run -e flashcardos                                  # build
pio run -e flashcardos -t upload --upload-port COM12     # flash
```

First boot walks you through a one-time touch calibration (tap four
on-screen corner targets) — that's TFT_eSPI's own standard
`calibrateTouch()`, stored to NVS afterward so it only happens once.

## What's actually been verified so far

Full end-to-end bring-up against the physical device, in order:

- Real hardware, confirmed via `esptool.py`: ESP32-D0WD-V3, 4MB flash —
  exactly matches spec.
- Full original firmware backed up before this fork ever wrote to the
  board (see HARDWARE.md's "Recovering the original firmware").
- Display driver/resolution contradiction resolved empirically against
  the physical device (not guessed) — ST7796S/320×480 confirmed via a
  GRAM read/write round-trip test. Full readout in HARDWARE.md.
- Install QR generated with a real library (Python `qrcode`) and verified
  via an **independent** decoder (OpenCV) round-tripping back to the
  exact target URL before being embedded — see
  [`tools/gen-install-qr.py`](tools/gen-install-qr.py) and the standing
  project rule it documents (guidon-app's own `#/share` screen carries
  the identical rule, after an earlier hand-rolled in-app QR encoder
  shipped unscannable codes and was pulled before release).
- SD card's CS pin confirmed (GPIO5) and two real bugs found and fixed
  during bring-up — an intermittent-response race needing a retry loop,
  and a silent write stall from UART RX buffer overflow during content
  push. Full story in HARDWARE.md's "SD card" section; the actual push
  succeeded end to end — [`docs/sdloader_success.log`](docs/sdloader_success.log).
- `flashcardos` compiles clean (RAM 12.6%, flash 30.3% on a 4MB/no-PSRAM
  target), was flashed to the physical device with real content already
  on its microSD card, and its own serial log confirms a clean full boot:
  display init, touch calibration loaded, SD card found, **all 78
  categories loaded**, subject list shown —
  [`docs/flashcardos_boot_output.log`](docs/flashcardos_boot_output.log).
- **Touch: RESOLVED**, confirmed against the physical device with real
  content — subject list, card view, and navigating between them all
  register taps correctly. Three real, separate bugs, stacked: (1) a
  stack overflow in `drawCard()` that crashed the device the instant a
  card was opened, (2) the backlight's 5kHz PWM was genuinely
  desensitizing the resistive touch ADC via switching noise (0 touch
  hits/4s at 5kHz vs. 23/4s at 30kHz, measured directly), and (3) the
  real root cause behind "works everywhere except after SD loads a real
  card deck" — TFT_eSPI and the SD card were both defaulting to the same
  VSPI hardware peripheral via two separate `SPIClass` objects, and
  `SD.begin()` silently stole the display/touch object's pin routing out
  from under it. Fixed with one build flag (`-DUSE_HSPI_PORT=1`), moving
  the display/touch onto their own dedicated HSPI peripheral. Full
  root-cause writeup, including the isolation test that proved it, is in
  HARDWARE.md's "Touch" section.
- Display SPI clock pushed to 80MHz — the ESP32's undivided APB clock,
  the literal fastest its SPI peripheral can produce — and verified
  clean via the same GRAM round-trip test, not assumed safe. See
  HARDWARE.md's "Display SPI clock" section.

- **Decks (added later, off-device only):** `flashcardos` still compiles clean
  with the deck picker in (RAM 13.1%, flash 30.9%, up from 12.6% / 30.3%), and
  the deck logic in `src/lanes.h` is compiled and run on a desktop against the
  real export. That work was done with no device attached, so the picker, the
  saved deck and the tighter settings layout have **not** been seen on the
  handheld yet — see [Trying decks on the physical device](#trying-decks-on-the-physical-device-not-yet-done).

**Not directly observed by this session** (no camera on the physical
device): the actual on-screen visual layout — subject list rows, card
view text wrapping, the settings/QR screen — hasn't been visually
confirmed *correct* here, only that the firmware reaches and reports each
state correctly over serial and that touch input itself is fully
functional (state transitions, card navigation, all confirmed live with
the user tapping the real device). Worth a visual pass on the physical
device to confirm layout/legibility, on top of the "does it work at all"
question this session already answered.

## Repo layout

```
firmware/esp32-flashcard-os/
├── platformio.ini          # 4 envs: probe, bringup, sdloader, flashcardos
├── src/
│   ├── probe_main.cpp      # raw-SPI display ID probe (bring-up only)
│   ├── bringup_main.cpp    # ST7796/320x480 GRAM round-trip test (bring-up only)
│   ├── sdloader_main.cpp   # one-time serial->SD content loader (utility)
│   ├── main.cpp            # the real firmware
│   ├── lanes.h             # deck (MOS lane) logic - plain C++, also run on a desktop by host-test/
│   └── qr_install.h        # generated - see tools/gen-install-qr.py
├── host-test/
│   └── lanes_test.cpp      # compiles + runs src/lanes.h off-device (guidon-app/tools/test-esp32-lanes.mjs)
├── tools/
│   ├── extract-cards.mjs   # GUIDON_SEED.board.questions -> lean NDJSON + decks
│   ├── lanes.mjs           # which deck each card is in, and the checks on it
│   ├── gen-install-qr.py   # verified QR generation (never at runtime)
│   └── push-to-sd.py       # host side of sdloader_main.cpp's protocol
├── sdcard/                 # extract-cards.mjs output (gitignored - device content)
├── docs/                   # bring-up serial logs + the QR preview image
├── HARDWARE.md             # pin map, the ILI9341/ST7796 resolution, SD caveat
└── README.md                # this file
```
