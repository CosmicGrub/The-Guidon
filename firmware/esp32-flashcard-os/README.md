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
prev/next), and a settings screen (backlight brightness + an install QR
for the full GUIDON app). All 984 of GUIDON's board-question flashcards,
across all 78 subjects, browsable offline from a microSD card.

What this firmware **deliberately is not**: GUIDON itself. No board
drills, no grading, no SRS scheduling, no settings sprawl, no Study
Rooms, no library, no calendar. If a future change wants any of that,
that's a real scope decision to make explicitly — not something to grow
in by accretion.

## Getting content onto the device

GUIDON's flashcard content lives inside `guidon-app/src/index.html` (the
`window.GUIDON_SEED` blob — see that app's own `tools/seed-io.mjs`). This
firmware never embeds that JSON directly (2.56MB of it, on a chip with
520KB of RAM and no PSRAM); instead:

```bash
cd firmware/esp32-flashcard-os
node tools/extract-cards.mjs      # -> ./sdcard/cards.ndjson + categories.json
```

See [`tools/extract-cards.mjs`](tools/extract-cards.mjs)'s own header for
the on-SD format and why it's shaped the way it is (streamed one card at
a time, never loaded whole).

Getting those two files onto the device's actual microSD card doesn't
require a separate SD card reader — it goes over the same USB-serial
link used for flashing:

```bash
pio run -e sdloader -t upload --upload-port COM12   # flash the one-time loader
python tools/push-to-sd.py COM12                     # pushes both files
pio run -e flashcardos -t upload --upload-port COM12 # reflash the real app
```

(If you *do* have a card reader handy, just copying `sdcard/cards.ndjson`
and `sdcard/categories.json` onto the card's root the normal way works
identically — the loader exists for when you don't.)

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
│   └── qr_install.h        # generated - see tools/gen-install-qr.py
├── tools/
│   ├── extract-cards.mjs   # GUIDON_SEED.board.questions -> lean NDJSON
│   ├── gen-install-qr.py   # verified QR generation (never at runtime)
│   └── push-to-sd.py       # host side of sdloader_main.cpp's protocol
├── sdcard/                 # extract-cards.mjs output (gitignored - device content)
├── docs/                   # bring-up serial logs + the QR preview image
├── HARDWARE.md             # pin map, the ILI9341/ST7796 resolution, SD caveat
└── README.md                # this file
```
