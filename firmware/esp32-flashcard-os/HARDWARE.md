# Hardware — GUIDON Flashcard OS (ESP32 handheld fork)

This document is the single source of truth for the physical device this
firmware targets: what chip it is, how it's wired, and — because this
project started with a real, unresolved spec contradiction — exactly how
each fact below was established and how confident you should be in it.

## The device

A handheld study device that shipped with third-party "GameSuite Arcade
OS" firmware (an ESP32-based retro-arcade/game-emulation firmware — not
part of this repo; its own strings identify it as "GameSuite"/"ArcadeOS",
recovered from a full flash read before this fork ever touched the board,
see "Recovering the original firmware" below). This fork replaces that
firmware entirely with a minimal flashcard browser built on GUIDON's own
content.

## SoC

| Field | Value | How confirmed |
|---|---|---|
| Chip | ESP32-D0WD-V3, dual-core Xtensa LX6 @ 240MHz | `esptool.py chip-id` against the physical board (revision v3.1) |
| SRAM | 520KB total, **no PSRAM** | User-provided spec; no `BOARD_HAS_PSRAM` anywhere in this fork accordingly |
| Flash | 4MB external | `esptool.py flash-id` against the physical board: manufacturer `c4`, device `6016`, 4MB |
| Radios | Wi-Fi 2.4GHz b/g/n, BT 4.2 | User-provided spec. **Unused by this firmware** — a pure offline flashcard viewer has no need for either; no `WiFi.begin()`/BT init anywhere in this fork |
| USB | Type-C, CH340 USB-serial bridge | Confirmed via Windows device manager (`USB-SERIAL CH340`) while flashing over COM12 |

## Display + touch — the spec contradiction, and how it was resolved

The two sources this project started from disagreed outright:

- A generic prose description: **"ILI9341 display, 240×320, 4-wire SPI +
  resistive touch (almost certainly XPT2046)."**
- The user's own pin-mapping table, described as cross-referenced against
  the real, working NerdMiner/NM Miner firmware for this exact board:
  **"Driver ST7796S, 320×480 native."**

Different controller chip, different resolution. Per the explicit
instruction that came with this task, no driver code was written before
this was resolved **empirically against the physical device** — not
guessed, and not resolved by just trusting whichever source read more
authoritative.

### Step 1 — driver-agnostic raw-SPI ID probe (`env:probe`)

`src/probe_main.cpp` talks 4-wire SPI directly (no TFT_eSPI, no assumption
about either driver's init sequence) using only the pin table's own claim
for the wiring, and issues the MIPI-DCS read commands both ILI9341 and
ST7796 implement at the protocol level (RDDID, RDDST, RDDPM, RDID1-3,
etc.). Full raw output: [`docs/probe_serial_output.log`](docs/probe_serial_output.log).

Result:

- `RDDID`/`RDID1`/`RDID2`/`RDID3` all read back `0xFF 0xFF...` — **not**
  ILI9341's signature (a genuine ILI9341 reliably echoes its own part
  number, `0x93 0x41`, through RDDID). All-`0xFF` on these specific reads
  is a widely-reported ST77xx-family clone-panel fingerprint instead.
- `RDDST` and `RDDPM` came back **real, consistent, non-floating,
  repeatable** values (`0x00 0x71 0x80 0x00 0x00` and `0x18 0x00` across
  five consecutive polls) — proof the pin mapping is wiring real SPI to a
  real, live, responding display controller. That's already a meaningful
  result on its own: it confirms the pin table is trustworthy wiring,
  independent of which chip turns out to be on the other end.

Suggestive (ST7796 over ILI9341), not conclusive on its own.

### Step 2 — decisive GRAM round-trip (`env:bringup`)

`src/bringup_main.cpp` drives the panel for real via TFT_eSPI, configured
exactly as the pin table claims (`ST7796_DRIVER`, 320×480), and writes
five small color blocks — all four corners plus center — then reads each
one back with TFT_eSPI's `readPixel()` (a real SPI `RAMRD` round trip, no
framebuffer involved — there is none, no PSRAM). Two of the five points
(`(0,479)` and `(319,479)`) are in address space that **does not exist at
all** on a 320-row panel; a true ILI9341/240×320 panel wrongly driven as
320×480 would show clipped/garbled/blank reads there. Full output:
[`docs/bringup_serial_output.log`](docs/bringup_serial_output.log).

Result: **all five points matched exactly**, including both row-479
corners.

```
top-left     (0,0)   wrote 0xF800 read 0xF800  MATCH
top-right  (319,0)   wrote 0x07E0 read 0x07E0  MATCH
center   (160,240)   wrote 0xFFE0 read 0xFFE0  MATCH
bot-left   (0,479)   wrote 0x001F read 0x001F  MATCH
bot-right(319,479)   wrote 0xF81F read 0xF81F  MATCH
```

### Verdict

**ST7796S, 320×480, confirmed against the physical device.** The pin
table's own claim was right; the generic top-of-message "ILI9341,
240×320" description was wrong and is not used anywhere in this fork.
`platformio.ini`'s `[display_flags]` section reflects this.

Touch (XPT2046) was never in dispute — only the display driver/resolution
was — so the touch controller identity from the original spec stands.

## Confirmed pin mapping

| Signal | GPIO | Notes |
|---|---|---|
| TFT MOSI | 13 | shared bus with touch |
| TFT SCLK | 14 | shared bus with touch |
| TFT CS | 15 | |
| TFT DC | 2 | |
| TFT MISO | 12 | shared bus with touch |
| TFT Reset | *(none)* | tied to EN, not a driven GPIO — `TFT_RST=-1` |
| TFT Backlight | 27 | active-**HIGH**, PWM-driven by this firmware (see Settings) |
| Touch CS | 33 | |
| Touch CLK/MOSI/MISO | 14/13/12 | same physical bus as the display |
| Touch IRQ | 36 | input-only pin on ESP32 — correct for an IRQ line |

This is the user's own "confirmed hardware" table, unchanged. It matches
— pin-for-pin, including the no-reset-tied-to-EN detail and the
active-HIGH backlight — the well-documented **Sunton ESP32-3248S035**
3.5″ board family, which independently corroborates both the pin table
itself and the ST7796S/320×480 finding above (that's a real, common board
in that family, not a coincidence).

## SD card — CS pin confirmed, plus two real bugs found and fixed during bring-up

The user's pin table covered display + touch only; it said nothing about
the microSD slot's wiring. Based on the Sunton ESP32-3248S035 match above,
this fork assumed the SD card sits on the ESP32's **default VSPI** pins
(MOSI 23 / SCLK 18 / MISO 19 — separate bus from the display's HSPI-style
pins above), with CS on one of a short list of candidates that vary across
board revisions in that family: 5, 4, 22, 21, 26, 25. Both `env:sdloader`
and the real firmware (`main.cpp`'s `beginSdCard()`) sweep all six at
boot rather than hardcoding one guess.

**Confirmed: `SD_CS = 5`.** With no card inserted, all six candidates
failed identically at `CMD0`/`GO_IDLE_STATE` — the signature of "nothing
in the slot," not "wrong pin." Once a card was physically inserted, CS=5
started answering — but **inconsistently across otherwise-identical
resets**: a real (if initially unformatted) card response on some boots,
dead silence at CMD0 on others, same pin, same wiring, same code. That
pattern is a marginal-contact/SPI-power-on-race symptom, not a pin
problem (a wrong pin fails the same way every time). Fix: both
`trySdCandidates()`/`beginSdCard()` now retry each candidate up to 5×
with a 100ms settle delay before moving on, rather than writing off a
correct pin because of one flaky poll — reliable ever since.

**The card itself was blank (no FAT volume).** `SD.begin(..., true)`'s
`format_if_empty` argument formats it automatically the first time a
candidate pin gets a real (if filesystem-less) response — see
`sdloader_main.cpp`/`main.cpp`. Actual card size once mounted: **~488,156
MB** (a 512GB-class card — 512 × 1000³ ÷ 1024² ≈ 488,281 MB, matching
within rounding).

**A silent write stall during the first content push, diagnosed and
fixed.** The very first `push-to-sd.py` run reported 100% of
`cards.ndjson`'s bytes sent, then never received a `DONE` confirmation.
Root cause: the host reporting "100% sent" only means bytes left *its own*
buffer, not that the device has consumed them — and the ESP32 Arduino
core's default UART RX ring buffer (256B) can overflow during a burst
while the device is blocked inside `f.write()` doing the SD card's own
housekeeping, silently dropping bytes with no error on either side. Two
fixes, both now in `sdloader_main.cpp`: `Serial.setRxBufferSize(8192)`
before `Serial.begin()`, and the device itself now prints its own
`... N/M bytes written` progress every 2s during a PUT, so "still working,
slowly" is distinguishable from "actually stuck" on the very first look
at the log, not diagnosed by guesswork. With both fixes, the full push
(662,534 bytes of `cards.ndjson` + 4,331 bytes of `categories.json`)
completed and confirmed in full — ~11KB/s over the 4MHz SD SPI clock,
consistent with SD-write-bound (not USB-bound) throughput.

Full logs: [`docs/sdloader_success.log`](docs/sdloader_success.log) (the
successful push) and [`docs/flashcardos_boot_output.log`](docs/flashcardos_boot_output.log)
(the real firmware's own boot, with real content: `SD: card found on
CS=5.` / `Loaded 78 categories.` / `Ready - showing subject list.`).

## Touch — a real firmware bug, not a hardware fault

The real firmware shipped with taps that appeared to do nothing at all -
finger and stylus, hard and soft, repeatedly. Diagnosed against the
physical device with a dedicated raw-SPI touch probe (`env:touchtest`,
`src/touchtest_main.cpp`) that prints both `tft.getTouchRaw()`/
`getTouchRawZ()` (straight XPT2046 ADC, no calibration math) and the
calibrated `tft.getTouch()` result continuously, while the screen was
actually tapped, dragged and pressed across its full surface with both
finger and stylus.

**Result: the touch controller works perfectly.** Baseline (untouched) `z`
sits at 10-20; under real contact it jumped to 1000-2300+, and raw x/y
swept smoothly across their full range in direct correlation with where
the screen was actually touched. `getTouch()` returned sane, in-range
calibrated coordinates throughout - a stylus not helping was the correct
tell that this was never a "resistive panel needs firmer point pressure"
problem (the one failure mode a stylus reliably fixes); it ruled that out
in favor of something in software, not the panel itself.

**Root cause: a stack overflow in `drawCard()`.** That function declared
`char qLines[40][80]` (3200 bytes) and `char aLines[80][80]` (6400 bytes)
as stack-local variables - 9600 bytes alone, before its other locals or
the call chain through `loop()`/`wordWrap()`/TFT_eSPI's own drawing calls,
against the ESP32 Arduino core's default 8192-byte loop-task stack. The
FIRST tap that actually opened a card (transitioning off the subject
list, where `drawCard()` had never yet run) overflowed the stack and the
device silently rebooted mid-redraw - fast enough, and landing right back
on the same subject list, to look exactly like the tap had never
registered. Every subsequent tap hit the same fate the instant it tried
to open a card, which is exactly the reported symptom.

Fixed two ways, both in `src/main.cpp`:
1. `qLines`/`aLines` are now `static`, not stack-local - the actual fix.
   Safe because every call fully repopulates exactly `qN`/`aN` entries via
   `wordWrap()` before anything reads them, and nothing ever reads past
   that count.
2. `getArduinoLoopTaskStackSize()` (a weak symbol `cores/esp32/main.cpp`
   provides for exactly this) overridden to return 16384 instead of the
   8192 default, as headroom against this exact failure mode recurring as
   the UI grows, not as the fix itself.

**Also improved while diagnosing:** touch handling switched from a fixed
180ms post-touch cooldown to edge-triggered detection (`loop()`'s
`wasTouched` bool - an action fires once on the touch-DOWN edge, not
again until release-then-repress, however long a press is held). The old
cooldown was guarding against one held press firing twice, which
edge-triggering solves structurally instead of with a timer, removing an
artificial floor on how fast two deliberate taps could ever register.

### Second, more fundamental bug: PWM backlight noise desensitizing touch

The stack-overflow fix above turned out not to be the whole story - after
shipping it, the user reported taps STILL not registering at all,
including on the subject list itself (a screen `drawCard()`'s bug never
touched). Rather than theorize further, this was instrumented directly in
`main.cpp`'s own `setup()`/`loop()` (not a side sketch) with a live
touch-poll window run against the physical device in real time, tapped by
the user on request:

| Backlight config | Touch hits in 4s of active tapping |
|---|---|
| PWM @ 5kHz (original) | **0** |
| Plain digital HIGH (no PWM at all) | 12 |
| PWM @ 30kHz | 23 |

That's conclusive: the original 5kHz `ledcSetup()` backlight PWM was
genuinely desensitizing the resistive touch controller's ADC via
switching noise - a real, documented interaction on cheaper boards where
backlight and touch share power/ground planes without generous
decoupling. 5kHz sits close enough to the touch read's own sampling
cadence to alias badly; 30kHz (still well within the ESP32 LEDC
peripheral's normal range at 8-bit duty resolution) sits far enough
outside it to leave touch fully clean while keeping real PWM dimming
(not just an on/off backlight). Fixed by raising `BL_PWM_FREQ` from 5000
to 30000 in `src/main.cpp` - one constant, no structural change. Full
raw logs for all three configurations:
[`docs/touch_pwm_5khz_broken.log`](docs/touch_pwm_5khz_broken.log),
[`docs/touch_pwm_disabled_working.log`](docs/touch_pwm_disabled_working.log),
[`docs/touch_pwm_30khz_working.log`](docs/touch_pwm_30khz_working.log).

This also resolves an apparent contradiction from earlier bring-up: a
touch calibration was already sitting in NVS the very first time this
session checked, despite 5kHz PWM being active from that firmware's
first boot too. Calibration's own retry-until-you-hit-it interaction
(the user pressing repeatedly until a corner target registers) can still
occasionally get a clean reading through 5kHz-level noise; a single
un-repeated UI tap, the normal interaction this app actually needs, much
less reliably can - which is exactly why calibration once succeeded
while every-day taps afterward did not.

## Display SPI clock — pushed to the chip's actual ceiling, verified

Bring-up originally shipped a conservative `SPI_FREQUENCY` (27MHz) with a
"raise once bring-up is clean" note. Once it was: rather than pick a
commonly-cited "safe" number for ST7796 boards without testing it against
*this* physical unit (the same mistake the original ILI9341-vs-ST7796
question would have been, had it not been tested), `env:bringup`'s GRAM
read/write round-trip test (see above) was re-run at increasing clocks
against the real device.

**80MHz - the ESP32's undivided APB clock, the fastest SPI clock the
chip's peripheral can produce at all - passed cleanly**, all five
round-trip points matching exactly. That's not a conservative choice
raised as far as felt comfortable; it's the literal hardware ceiling,
confirmed reliable on this unit, so `SPI_FREQUENCY=80000000` is what
`platformio.ini` ships. (`SPI_READ_FREQUENCY` stays at 16MHz - reads only
matter for this verification test itself, not for anything the UI does at
runtime, so there was no reason to risk destabilizing the test that
proves the write clock is trustworthy. `SPI_TOUCH_FREQUENCY` stays at
2.5MHz for a different reason: that's the XPT2046 touch controller's own
commonly-reliable ceiling, a genuinely different piece of silicon on a
separate SPI transaction pattern from the ST7796 display bus - already
confirmed reliable during touch bring-up above, and touch responsiveness
turned out to be a software problem (see above), not a clock-speed one.)

## Backlight

GPIO 27, active-HIGH, driven via `ledcWrite` PWM (not a bare digital
on/off) so the Settings screen's brightness control is a real dimmer, not
two states. Default 80%, adjustable in 10% steps, persisted in NVS
(`Preferences`, namespace `guidon`, key `bl`) so it survives a reboot.

## Recovering the original firmware

Before this fork ever wrote to the board, its complete existing firmware
was read off with:

```
esptool.py --port COM12 read-flash 0 0x400000 gamesuite_full_dump.bin
```

That dump (4MB, the device's full flash) is **not checked into this repo**
(it's a binary firmware image, not source this project owns) but exists
outside it. To restore the original GameSuite Arcade OS firmware exactly:

```
esptool.py --port <PORT> write-flash 0x0 gamesuite_full_dump.bin
```
