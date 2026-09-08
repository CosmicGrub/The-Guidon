/*
 * GUIDON Flashcard OS - touch diagnostic
 * ========================================
 * Not part of the shipped app. The real firmware reported taps doing
 * nothing on the physical device - finger and stylus, hard and soft,
 * repeatedly. A stylus not helping rules out "resistive panel just needs
 * firmer point pressure" (that's the one failure mode a stylus reliably
 * fixes), which leaves two real candidates: the touch controller isn't
 * responding to the SPI bus at all (wiring), or it IS responding but the
 * stored calibration (env:flashcardos's ensureTouchCalibrated() found
 * data already in NVS on a boot nobody in this session watched happen -
 * never independently confirmed good) maps real touches to garbage
 * coordinates.
 *
 * This prints BOTH raw ADC readings (tft.getTouchRaw/getTouchRawZ() -
 * before any calibration math, straight off the XPT2046) and the
 * calibrated tft.getTouch() result, continuously, fast enough to catch a
 * tap - so which of the two failure modes this actually is shows up
 * directly in the serial log instead of being guessed at:
 *
 *   - raw x/y/z NEVER change no matter how/where/how hard the screen is
 *     touched -> the touch controller isn't answering SPI at all. Pin
 *     mapping, shared-bus contention with the display CS, or a solder/
 *     ribbon issue on the touch line - a wiring problem, not software.
 *   - raw z jumps clearly on contact (and x/y move) but getTouch() never
 *     reports a hit, or reports wildly inconsistent/off-screen
 *     coordinates -> the controller is fine; the stored calibration is
 *     bad. Send "C" over serial to wipe it and redo calibrateTouch()
 *     fresh, actively watched this time.
 *
 * Serial commands (type + Enter):
 *   C  - clear stored calibration (NVS) and immediately re-run
 *        tft.calibrateTouch() (tap the 4 on-screen corner targets)
 *   R  - print the currently stored raw calibration array, if any
 */

#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <Preferences.h>

TFT_eSPI tft = TFT_eSPI();
Preferences prefs;

static void printStoredCalibration() {
  uint16_t calData[5];
  size_t stored = prefs.getBytes("touchcal", calData, sizeof(calData));
  if (stored == sizeof(calData)) {
    Serial.printf("stored calibration: [%u, %u, %u, %u, %u]\n",
                  calData[0], calData[1], calData[2], calData[3], calData[4]);
  } else {
    Serial.println("no stored calibration found in NVS.");
  }
}

static void runFreshCalibration() {
  prefs.remove("touchcal");
  Serial.println("cleared stored calibration. Starting calibrateTouch() - ");
  Serial.println("tap each of the 4 corner targets on screen now.");
  uint16_t calData[5];
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.drawString("Tap each corner target", tft.width() / 2, 30);
  tft.calibrateTouch(calData, TFT_WHITE, TFT_RED, 18);
  prefs.putBytes("touchcal", calData, sizeof(calData));
  tft.setTouch(calData);
  Serial.printf("new calibration saved: [%u, %u, %u, %u, %u]\n",
                calData[0], calData[1], calData[2], calData[3], calData[4]);
  tft.fillScreen(TFT_BLACK);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("GUIDON Flashcard OS - touch diagnostic");
  Serial.println("Printing raw ADC (x,y,z) + calibrated getTouch() every 150ms.");
  Serial.println("Commands: C = clear + recalibrate now, R = show stored calibration");
  Serial.println();

  prefs.begin("guidon", false);
  tft.init();
  tft.setRotation(0);

  uint16_t calData[5];
  size_t stored = prefs.getBytes("touchcal", calData, sizeof(calData));
  if (stored == sizeof(calData)) {
    tft.setTouch(calData);
    Serial.printf("Loaded existing calibration: [%u, %u, %u, %u, %u]\n",
                  calData[0], calData[1], calData[2], calData[3], calData[4]);
  } else {
    Serial.println("No existing calibration - getTouch() will use TFT_eSPI's");
    Serial.println("built-in placeholder values until 'C' is sent.");
  }

  tft.fillScreen(TFT_NAVY);
  tft.setTextColor(TFT_WHITE, TFT_NAVY);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.drawString("Touch diagnostic - watch serial", tft.width() / 2, tft.height() / 2 - 10);
  tft.drawString("Tap anywhere, any pressure", tft.width() / 2, tft.height() / 2 + 14);
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'C' || c == 'c') runFreshCalibration();
    else if (c == 'R' || c == 'r') printStoredCalibration();
  }

  uint16_t rawX, rawY;
  uint8_t rawTouched = tft.getTouchRaw(&rawX, &rawY);
  uint16_t rawZ = tft.getTouchRawZ();

  uint16_t calX, calY;
  uint8_t calTouched = tft.getTouch(&calX, &calY, 600);

  // Printed EVERY cycle, touched or not, on purpose - a flatline here no
  // matter what happens at the physical screen is itself the diagnosis
  // (touch controller not answering SPI at all), and that absence is only
  // visible if "nothing changed" is actually logged, not suppressed.
  Serial.printf("raw x=%4u y=%4u z=%4u rawTouched=%u  |  cal x=%4u y=%4u touched=%u\n",
                rawX, rawY, rawZ, rawTouched, calX, calY, calTouched);

  if (calTouched) {
    tft.fillCircle(calX, calY, 4, TFT_GREEN);
  }

  delay(150);
}
