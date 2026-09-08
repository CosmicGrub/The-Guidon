/*
 * GUIDON Flashcard OS - ST7796/320x480 GRAM round-trip bring-up test
 * ====================================================================
 * env:probe's ID-register read got a real signal (RDDST/RDDPM answered
 * with consistent, non-floating data - the pin map genuinely reaches a
 * live controller) but not a clean chip-ID match either way (RDDID/RDID1-3
 * all read 0xFF, which is a known ST7796-clone fingerprint rather than a
 * genuine ILI9341's - ILI9341 reliably echoes 0x93 0x41 there).
 *
 * This is the decisive follow-up: actually drive the panel via TFT_eSPI
 * configured exactly as the pin table claims (ST7796_DRIVER, 320x480), and
 * round-trip real pixels through GRAM at row 470 - address space with NO
 * physical meaning on a 320-row (ILI9341) panel. TFT_eSPI's ST7796 driver
 * will happily SEND a RASET command asking for row 470; whether that
 * produces a working, readable pixel or garbage/clipping is entirely a
 * function of whether the silicon underneath actually has 480 rows of
 * GRAM. That makes the readback a hardware fact, not an inference.
 *
 * Five color blocks: all four corners (worst-case addressing) plus dead
 * center. Each is written, then read back with TFT_eSPI's own readPixel()
 * (a real SPI RAMRD round trip, not a framebuffer readback - there is no
 * framebuffer here, no PSRAM on this chip) and compared to the color that
 * was actually written. All five matching is the strongest evidence this
 * fork can gather without a photo of the physical screen.
 */

#include <Arduino.h>
#include <TFT_eSPI.h>

TFT_eSPI tft = TFT_eSPI();

struct ProbePoint {
  const char *label;
  int16_t x, y;
  uint16_t color;
};

// 320x480 portrait geometry per the pin table's own claim. (0,0) and
// (319,0) are in-bounds on ANY candidate panel; (0,479) and (319,479) only
// exist at all if the panel truly has 480 rows.
static ProbePoint points[] = {
  {"top-left     (0,0)",     4,   4,   TFT_RED},
  {"top-right  (319,0)",     315, 4,   TFT_GREEN},
  {"center   (160,240)",     160, 240, TFT_YELLOW},
  {"bot-left   (0,479)",     4,   475, TFT_BLUE},
  {"bot-right(319,479)",     315, 475, TFT_MAGENTA},
};

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("=========================================================");
  Serial.println(" GUIDON Flashcard OS - ST7796/320x480 GRAM round-trip test");
  Serial.printf(" TFT_eSPI compiled for: %dx%d\n", TFT_WIDTH, TFT_HEIGHT);
  Serial.println("=========================================================");

  tft.init();
  tft.setRotation(0); // portrait, 320 wide x 480 tall, matches `points` above
  tft.fillScreen(TFT_BLACK);

  for (auto &p : points) {
    tft.fillRect(p.x - 4, p.y - 4, 8, 8, p.color);
  }
  delay(50); // let the panel's own SPI write settle before reading back

  bool allPass = true;
  Serial.println();
  Serial.println("---- write -> read-back per point ----");
  for (auto &p : points) {
    uint16_t got = tft.readPixel(p.x, p.y);
    bool pass = (got == p.color);
    allPass &= pass;
    Serial.printf("  %-20s wrote 0x%04X read 0x%04X  %s\n",
                  p.label, p.color, got, pass ? "MATCH" : "MISMATCH");
  }

  Serial.println();
  if (allPass) {
    Serial.println("  ALL FIVE POINTS MATCH, including both row-479 corners.");
    Serial.println("  CONCLUSION: this panel genuinely has 320x480 addressable GRAM");
    Serial.println("  under the ST7796 driver. Pin table's spec (ST7796S, 320x480)");
    Serial.println("  is CONFIRMED. Do not use ILI9341/240x320 for the real firmware.");
  } else {
    Serial.println("  At least one point mismatched. If specifically the row-479");
    Serial.println("  corners failed while (0,0)/top-right/center passed, that means");
    Serial.println("  addressing breaks down past row ~319 - consistent with this");
    Serial.println("  actually being a 240x320 panel wrongly driven as 320x480.");
    Serial.println("  Falls back to trying ILI9341_DRIVER/240x320 next, NOT a guess -");
    Serial.println("  see which points passed above before re-running.");
  }
  Serial.println("=========================================================");
}

void loop() {
  delay(5000);
}
