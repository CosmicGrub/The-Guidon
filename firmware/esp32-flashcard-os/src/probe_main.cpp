/*
 * GUIDON Flashcard OS - display controller probe
 * ================================================
 * ONE JOB: answer, empirically, which of the two conflicting display specs
 * the user gave us is actually true of this physical board:
 *
 *   (A) "ILI9341, 240x320, 4-wire SPI + resistive touch (XPT2046)"
 *   (B) pin-mapping table's own claim: "Driver ST7796S, 320x480 native"
 *
 * Deliberately does NOT use TFT_eSPI or any other display library, and does
 * NOT assume either driver's init sequence. It talks raw 4-wire SPI using
 * only the pin mapping HARDWARE.md documents as confirmed (MOSI/SCLK/CS/DC
 * = 13/14/15/2, MISO=12 shared with touch, no hardware reset - tied to EN),
 * and issues MIPI-DCS-standard read commands that both ILI9341 and ST7796
 * implement identically at the protocol level:
 *
 *   0x04  RDDID  - Read Display ID           (mfr id, driver ver, driver id)
 *   0x09  RDDST  - Read Display Status
 *   0x0A  RDDPM  - Read Display Power Mode
 *   0x0C  RDDCOLMOD - Read Display Pixel Format
 *   0x0F  RDDSDR - Read Display Self-Diagnostic Result
 *   0xDA  RDID1  - Read ID1 (LCD module manufacturer)
 *   0xDB  RDID2  - Read ID2 (LCD module driver version)
 *   0xDC  RDID3  - Read ID3 (LCD module driver ID)
 *
 * Genuine ILI9341 parts reliably answer RDDID with bytes that read as
 * 0x93 0x41 (the part number itself, in hex) after the leading dummy byte
 * every RDDID read requires. Real ST7796S silicon almost never echoes its
 * own part number back through RDDID/RDID3 the same tidy way (a lot of
 * ST77xx-family clones return 0x00 0x00 0x00 or a generic-looking
 * 0x85/0x52 pattern on that command) - so this probe's job is to CAPTURE
 * the raw bytes and print them, not to assume a match. A clean, non-zero,
 * non-0xFF, repeatable RDDSDR (self-diagnostic) result on its own is also
 * meaningful: it proves the pin mapping/SPI wiring is right (the chip is
 * alive and answering) independent of which chip it turns out to be -
 * that already resolves the OTHER open question (whether the confirmed-
 * hardware pin table is trustworthy at all).
 *
 * Safe to run: read-only display commands, never touches flash, and a full
 * 4MB backup of the device's existing GameSuite Arcade OS firmware was
 * taken (gamesuite_full_dump.bin) before this was ever uploaded.
 */

#include <Arduino.h>
#include <SPI.h>

// ---- Confirmed pin mapping (HARDWARE.md) --------------------------------
static const int PIN_MOSI = 13;
static const int PIN_SCLK = 14;
static const int PIN_CS   = 15;
static const int PIN_DC   = 2;
static const int PIN_MISO = 12; // shared with touch
static const int PIN_BL   = 27; // active-HIGH backlight
// No TFT reset pin - tied to EN per the confirmed table. That means a
// probe that gets no response could ALSO mean "board needs its own EN-tied
// power-on reset", not just "wrong pins" - noted in the printed output.

static SPIClass tftSpi(VSPI); // bus identity doesn't matter, all pins are explicit below

static void csLow()  { digitalWrite(PIN_CS, LOW); }
static void csHigh() { digitalWrite(PIN_CS, HIGH); }

// Sends a command byte (DC low), then reads `n` bytes back with DC high.
// MIPI DCS read commands require one dummy clock/byte before real data on
// most of these controllers - both are captured so nothing is discarded.
static void readCmd(uint8_t cmd, uint8_t *out, size_t n) {
  SPISettings settings(1000000, MSBFIRST, SPI_MODE0); // slow + safe for bring-up
  tftSpi.beginTransaction(settings);
  csLow();
  digitalWrite(PIN_DC, LOW);
  tftSpi.transfer(cmd);
  digitalWrite(PIN_DC, HIGH);
  for (size_t i = 0; i < n; i++) out[i] = tftSpi.transfer(0x00);
  csHigh();
  tftSpi.endTransaction();
}

static void printBytes(const char *label, uint8_t cmd, uint8_t *b, size_t n) {
  Serial.printf("  %-9s (cmd 0x%02X): ", label, cmd);
  for (size_t i = 0; i < n; i++) Serial.printf("0x%02X ", b[i]);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(1500); // let the USB-serial (CH340) enumerate before we start printing

  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_DC, OUTPUT);
  pinMode(PIN_BL, OUTPUT);
  csHigh();
  digitalWrite(PIN_DC, HIGH);
  digitalWrite(PIN_BL, HIGH); // backlight on - harmless for a read-only probe

  tftSpi.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, PIN_CS);

  Serial.println();
  Serial.println("=========================================================");
  Serial.println(" GUIDON Flashcard OS - display controller probe");
  Serial.println(" Pins: MOSI=13 SCLK=14 CS=15 DC=2 MISO=12 BL=27 (active-HIGH)");
  Serial.println(" No hardware reset line (tied to EN) - reading immediately.");
  Serial.println("=========================================================");
}

void loop() {
  uint8_t rddid[4] = {0};   readCmd(0x04, rddid, 4);
  uint8_t rddst[5] = {0};   readCmd(0x09, rddst, 5);
  uint8_t rddpm[2] = {0};   readCmd(0x0A, rddpm, 2);
  uint8_t colmod[2] = {0};  readCmd(0x0C, colmod, 2);
  uint8_t rddsdr[2] = {0};  readCmd(0x0F, rddsdr, 2);
  uint8_t rdid1[2] = {0};   readCmd(0xDA, rdid1, 2);
  uint8_t rdid2[2] = {0};   readCmd(0xDB, rdid2, 2);
  uint8_t rdid3[2] = {0};   readCmd(0xDC, rdid3, 2);

  Serial.println();
  Serial.println("---- raw read-back (first byte after each cmd is the MIPI dummy byte) ----");
  printBytes("RDDID",  0x04, rddid, 4);
  printBytes("RDDST",  0x09, rddst, 5);
  printBytes("RDDPM",  0x0A, rddpm, 2);
  printBytes("COLMOD", 0x0C, colmod, 2);
  printBytes("RDDSDR", 0x0F, rddsdr, 2);
  printBytes("RDID1",  0xDA, rdid1, 2);
  printBytes("RDID2",  0xDB, rdid2, 2);
  printBytes("RDID3",  0xDC, rdid3, 2);

  bool allZero = true, allFF = true;
  uint8_t all[] = {rddid[1], rddid[2], rddid[3], rddst[1], rddpm[1], rdid1[1], rdid2[1], rdid3[1]};
  for (uint8_t v : all) { if (v != 0x00) allZero = false; if (v != 0xFF) allFF = false; }

  Serial.println("---- interpretation ----");
  if (allZero) {
    Serial.println("  All-zero response: either the panel doesn't answer these DCS reads on");
    Serial.println("  this MISO line (some clone ST7796 modules genuinely don't), or the wiring");
    Serial.println("  needs the board's own power-on reset (no dedicated TFT_RST here, tied to");
    Serial.println("  EN). Not conclusive by itself - see rddsdr/rddpm across repeated boots.");
  } else if (allFF) {
    Serial.println("  All-0xFF response: MISO is floating / not actually connected on this line,");
    Serial.println("  or CS/DC framing is off. Treat pin mapping as UNCONFIRMED, don't proceed.");
  } else {
    Serial.println("  Non-trivial, non-floating response - the pin mapping is wiring real SPI");
    Serial.println("  to a real, responding display controller. Good sign for the pin table.");
  }

  if (rddid[2] == 0x93 && rddid[3] == 0x41) {
    Serial.println("  RDDID bytes 0x93 0x41 present -> matches ILI9341's own part number.");
    Serial.println("  VERDICT: ILI9341, likely 240x320.");
  } else if (rdid3[1] != 0x00 && rdid3[1] != 0xFF) {
    Serial.printf("  RDID3 (driver ID) = 0x%02X - does not match ILI9341's 0x41. Consistent\n", rdid3[1]);
    Serial.println("  with a non-ILI9341 controller (e.g. ST7796) that doesn't echo its part");
    Serial.println("  number through RDDID/RDID3 - many ST77xx-family clones don't.");
    Serial.println("  VERDICT: NOT ILI9341. Pin table's ST7796S/320x480 claim is the better fit.");
  } else {
    Serial.println("  No ILI9341 signature found and no other conclusive ID either. See raw");
    Serial.println("  bytes above; report them back rather than guessing further.");
  }
  Serial.println("=========================================================");

  delay(3000);
}
