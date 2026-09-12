/*
 * GUIDON Flashcard OS - minimal firmware fork for a handheld ESP32-32E
 * device (see HARDWARE.md), replacing that device's prior "GameSuite
 * Arcade OS" firmware.
 *
 * SCOPE, DELIBERATELY NARROW (this is a direct quote of what was asked
 * for, kept here so a future edit doesn't quietly grow it back into a
 * second copy of the full GUIDON app): "you don't need to try to do
 * anything advanced, because this isn't advanced advice by any means -
 * just: all the flashcards, and the ability to sort and navigate between
 * topics/subjects." No board drills, no grading, no SRS scheduling, no
 * settings sprawl. Three screens: subject list -> card view -> settings
 * (backlight + the install QR). That's the whole app.
 *
 * Display: ST7796S, 320x480, driven via TFT_eSPI (driver/pins/geometry are
 * all build_flags in platformio.ini, NOT hardcoded here - see HARDWARE.md
 * for how ST7796S/320x480 was confirmed against the physical device,
 * displacing this project's own initial ILI9341/240x320 assumption).
 * Touch: XPT2046, shares the display's SPI bus, also via TFT_eSPI.
 *
 * Content: streamed from a microSD card (/cards.ndjson + /categories.json,
 * produced by tools/extract-cards.mjs from GUIDON's own board-question
 * bank) one card at a time. This chip has NO PSRAM and 520KB of SRAM total
 * - the full card bank is 2.56MB of JSON in the source app, so loading it
 * into RAM at once was never on the table. See extract-cards.mjs's own
 * header for the on-SD format this reads.
 */

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>
#include <Preferences.h>

#include "qr_install.h"

// Defense-in-depth on top of drawCard()'s qLines/aLines fix below: the
// ESP32 Arduino core's default loop-task stack is 8192 bytes
// (cores/esp32/main.cpp), and this override (a weak symbol the core
// explicitly provides for exactly this) doubles it. qLines/aLines being
// static already removed the one bug that actually bit this fork during
// bring-up (see that comment for the full story), but ArduinoJson's
// document handling and the nested wordWrap()/tft.draw* call chains
// during a card render still use real stack, and the margin on an 8KB
// budget was too thin to trust further UI growth against without
// re-litigating this exact failure mode.
size_t getArduinoLoopTaskStackSize(void) { return 16384; }

// ---- SD card pins -------------------------------------------------------
// NOT part of the user's own confirmed pin-mapping table (that table only
// covered display + touch). Inferred from the Sunton ESP32-3248S035 board
// family this hardware's display/touch pinout is an exact match for - that
// family's SD slot is wired to the ESP32's default VSPI pins (MOSI23/
// SCLK18/MISO19), varying only which pin is CS across board revisions.
// env:sdloader's own bring-up swept every plausible candidate against the
// real device and all six failed identically at CMD0 - conclusive for "no
// card was inserted at the time", NOT conclusive for which CS pin is
// right, since a failed CMD0 looks the same either way. beginSdCard()
// below does the same sweep here, so whichever pin turns out to be right
// once a card is actually inserted, this firmware finds it without a
// rebuild. See HARDWARE.md's "SD card" section for the full readout.
static const int SD_CS_CANDIDATES[] = {5, 4, 22, 21, 26, 25};
static int sdCsUsed = -1;

// See sdloader_main.cpp's identical retry loop for why this retries each
// candidate several times rather than once: bring-up against the real
// device showed the correct pin (CS=5) responding inconsistently across
// otherwise-identical resets - a marginal-contact/power-on-race symptom,
// not a wrong-pin symptom.
static const int SD_ATTEMPTS_PER_CANDIDATE = 5;

static bool beginSdCard() {
  for (int cs : SD_CS_CANDIDATES) {
    for (int attempt = 0; attempt < SD_ATTEMPTS_PER_CANDIDATE; attempt++) {
      SD.end();
      delay(100);
      // format_if_empty=true: only formats a card that already answered
      // CMD0 fine but carries no valid FAT volume; never touches a card
      // that just doesn't respond on that pin at all.
      if (SD.begin(cs, SPI, 4000000, "/sd", 5, true)) { sdCsUsed = cs; return true; }
    }
  }
  return false;
}

// ---- Backlight (PWM, TFT_BL from platformio.ini's build_flags = 27) ----
static const int BL_PWM_CHANNEL = 0;
// 5kHz (the original value here) measurably desensitized the resistive
// touch ADC - confirmed empirically on the physical device: 0/4s touch
// hits with 5kHz PWM active, 12/4s with the backlight held plain digital
// HIGH (no PWM at all). Testing a much higher frequency, well outside
// XPT2046's own sampling range, before falling back to no-PWM/no-dimming
// as the safe default. See HARDWARE.md's "Backlight PWM vs. touch" section.
static const int BL_PWM_FREQ = 30000;
static const int BL_PWM_RES_BITS = 8; // 0-255

TFT_eSPI tft = TFT_eSPI();
Preferences prefs;

// ---- Layout constants (320 wide x 480 tall, portrait) -------------------
static const int SCREEN_W = 320;
static const int SCREEN_H = 480;
static const int HEADER_H = 44;
static const int FOOTER_H = 52;
static const int ROW_H = 40;       // subject-list row height
static const int ROWS_PER_PAGE = 9; // (480 - header - footer) / ROW_H, rounded down with margin

static const uint16_t COL_BG = TFT_BLACK;
static const uint16_t COL_HEADER = 0x18E3; // dark slate
static const uint16_t COL_TEXT = TFT_WHITE;
static const uint16_t COL_DIM = 0x8410;    // mid grey
static const uint16_t COL_ACCENT = 0x04FF; // cyan-ish, echoes GUIDON's own accent color
static const uint16_t COL_BTN = 0x2965;
static const uint16_t COL_BTN_PRESSED = 0x39C7;

// ---- Category index (loaded once at boot from /categories.json) --------
struct Category {
  char name[44];
  uint16_t count;
  uint32_t offset; // byte offset of this category's first line in cards.ndjson
};
static const int MAX_CATEGORIES = 128;
static Category categories[MAX_CATEGORIES];
static int categoryCount = 0;

// ---- App state ------------------------------------------------------------
enum AppState { STATE_SUBJECTS, STATE_CARD, STATE_SETTINGS };
static AppState state = STATE_SUBJECTS;

static int subjectPage = 0;          // which page of the subject list
static int currentCategory = -1;     // index into categories[]
static int currentCardIndex = 0;     // 0-based within currentCategory
static bool answerRevealed = false;
static int scrollLine = 0;           // for the card body's wrapped-text scroll

static char cardQ[320];
static char cardA[2200];

static uint8_t backlightPct = 80; // persisted in NVS, default 80%

// Edge-triggered touch, not time-debounced: a fixed 180ms cooldown after
// every touch put an artificial floor under how fast two taps could ever
// register, even a firm, deliberate double-tap - the wrong tool for "don't
// fire twice from one held press", which is what it was actually guarding
// against. wasTouched tracks the touch-down edge instead: an action fires
// once when a press starts, not again until it's released and pressed
// again, however long the finger lingers in between. TFT_eSPI's own
// getTouch()/validTouch() already settle-filters spurious XPT2046 contact
// bounce at the read level (Touch.h), so no additional debounce delay is
// needed on top of that.
static bool wasTouched = false;

#ifdef DEBUG_TOUCH
static uint32_t lastDrawStartUs = 0;
static uint32_t lastDrawEndUs = 0;
static uint32_t lastDrawDurUs = 0;
#endif

// ---------------------------------------------------------------------------
// Backlight
// ---------------------------------------------------------------------------
static void applyBacklight() {
  uint32_t duty = (uint32_t)backlightPct * 255 / 100;
  ledcWrite(BL_PWM_CHANNEL, duty);
}

static void setBacklightPct(int pct) {
  if (pct < 5) pct = 5;    // never let a fat-finger tap go fully dark
  if (pct > 100) pct = 100;
  backlightPct = (uint8_t)pct;
  applyBacklight();
  prefs.putUChar("bl", backlightPct);
}

// ---------------------------------------------------------------------------
// Word wrap: fills `outLines` (each up to maxLineChars, caller-sized buffer
// of buffers) by measuring actual pixel width via tft.textWidth() against
// `maxWidthPx`, not a fixed character count - GUIDON's card text mixes
// short and long words and a fixed-char wrap either wastes space or
// overflows depending on font. Returns the number of lines produced.
// ---------------------------------------------------------------------------
static int wordWrap(const char *text, int maxWidthPx, char outLines[][80], int maxLines) {
  int lineCount = 0;
  char word[80];
  char line[80] = "";
  int wi = 0;
  bool done = false;
  const char *p = text;

  auto flushLine = [&](bool force) {
    if (lineCount < maxLines && (line[0] || force)) {
      strncpy(outLines[lineCount], line, 79);
      outLines[lineCount][79] = 0;
      lineCount++;
    }
    line[0] = 0;
  };

  while (!done) {
    char c = *p;
    if (c == ' ' || c == '\0' || c == '\n') {
      word[wi] = 0;
      if (word[0]) {
        char trial[80];
        if (line[0]) snprintf(trial, sizeof(trial), "%s %s", line, word);
        else snprintf(trial, sizeof(trial), "%s", word);
        if (tft.textWidth(trial) <= maxWidthPx || !line[0]) {
          strncpy(line, trial, 79);
          line[79] = 0;
        } else {
          flushLine(false);
          strncpy(line, word, 79);
          line[79] = 0;
        }
      }
      wi = 0;
      if (c == '\n') flushLine(true);
      if (c == '\0') done = true;
    } else if (wi < 78) {
      word[wi++] = c;
    }
    p++;
  }
  flushLine(false);
  return lineCount;
}

// ---------------------------------------------------------------------------
// SD content access
// ---------------------------------------------------------------------------
static bool loadCategories() {
  File f = SD.open("/categories.json", FILE_READ);
  if (!f) return false;

  JsonDocument doc; // ArduinoJson v7: grows as needed, freed when doc goes out of scope
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.printf("categories.json parse error: %s\n", err.c_str());
    return false;
  }

  categoryCount = 0;
  for (JsonObject c : doc.as<JsonArray>()) {
    if (categoryCount >= MAX_CATEGORIES) break;
    strncpy(categories[categoryCount].name, c["name"] | "?", 43);
    categories[categoryCount].name[43] = 0;
    categories[categoryCount].count = c["count"] | 0;
    categories[categoryCount].offset = c["offset"] | 0;
    categoryCount++;
  }
  return categoryCount > 0;
}

// Seeks to `category`'s first line, skips forward `index` more lines, and
// parses that line into cardQ/cardA. Sequential from a known offset - no
// random access needed, cards.ndjson lines are read forward only.
static bool loadCard(int categoryIdx, int index) {
  if (categoryIdx < 0 || categoryIdx >= categoryCount) return false;
  File f = SD.open("/cards.ndjson", FILE_READ);
  if (!f) return false;
  f.seek(categories[categoryIdx].offset);

  String line;
  for (int i = 0; i <= index; i++) {
    line = f.readStringUntil('\n');
    if (!line.length()) { f.close(); return false; }
  }
  f.close();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) {
    Serial.printf("card line parse error: %s\n", err.c_str());
    return false;
  }
  strncpy(cardQ, doc["q"] | "(missing question)", sizeof(cardQ) - 1);
  cardQ[sizeof(cardQ) - 1] = 0;
  strncpy(cardA, doc["a"] | "(missing answer)", sizeof(cardA) - 1);
  cardA[sizeof(cardA) - 1] = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Drawing: shared header/footer chrome
// ---------------------------------------------------------------------------
static void drawHeader(const char *title, bool showBack) {
  tft.fillRect(0, 0, SCREEN_W, HEADER_H, COL_HEADER);
  tft.setTextDatum(ML_DATUM);
  tft.setTextColor(COL_TEXT, COL_HEADER);
  if (showBack) {
    tft.fillRoundRect(4, 6, 74, HEADER_H - 12, 6, COL_BTN);
    tft.setTextFont(2);
    tft.drawString("< Back", 12, HEADER_H / 2);
    tft.setTextDatum(MC_DATUM);
    tft.drawString(title, SCREEN_W / 2 + 20, HEADER_H / 2);
  } else {
    tft.setTextFont(4);
    tft.drawString(title, 10, HEADER_H / 2);
  }
  // Settings gear, always top-right
  tft.fillRoundRect(SCREEN_W - 46, 6, 40, HEADER_H - 12, 6, COL_BTN);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_TEXT, COL_BTN);
  tft.drawString("cfg", SCREEN_W - 26, HEADER_H / 2);
}

// Returns true and fills *idx if the header's back button was hit.
static bool headerBackHit(int x, int y) { return x >= 4 && x <= 78 && y >= 6 && y <= HEADER_H - 6; }
static bool headerGearHit(int x, int y) { return x >= SCREEN_W - 46 && x <= SCREEN_W - 6 && y >= 6 && y <= HEADER_H - 6; }

static void drawButton(int x, int y, int w, int h, const char *label, bool pressed = false) {
  tft.fillRoundRect(x, y, w, h, 6, pressed ? COL_BTN_PRESSED : COL_BTN);
  tft.drawRoundRect(x, y, w, h, 6, COL_DIM);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_TEXT, pressed ? COL_BTN_PRESSED : COL_BTN);
  tft.drawString(label, x + w / 2, y + h / 2);
}
static bool hit(int x, int y, int bx, int by, int bw, int bh) {
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

// ---------------------------------------------------------------------------
// Screen: subject list
// ---------------------------------------------------------------------------
static int totalPages() { return (categoryCount + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE; }

static void drawSubjects() {
  tft.fillScreen(COL_BG);
  drawHeader("GUIDON Flashcard OS", false);

  int start = subjectPage * ROWS_PER_PAGE;
  int y = HEADER_H + 6;
  for (int i = start; i < start + ROWS_PER_PAGE && i < categoryCount; i++) {
    tft.fillRoundRect(6, y, SCREEN_W - 12, ROW_H - 6, 5, COL_BTN);
    tft.setTextDatum(ML_DATUM);
    tft.setTextFont(2);
    tft.setTextColor(COL_TEXT, COL_BTN);
    tft.drawString(categories[i].name, 14, y + (ROW_H - 6) / 2);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(COL_DIM, COL_BTN);
    char buf[16];
    snprintf(buf, sizeof(buf), "%d cards", categories[i].count);
    tft.drawString(buf, SCREEN_W - 18, y + (ROW_H - 6) / 2);
    y += ROW_H;
  }

  // Footer: page navigation
  tft.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, COL_HEADER);
  drawButton(8, SCREEN_H - FOOTER_H + 8, 90, FOOTER_H - 16, "< Prev");
  drawButton(SCREEN_W - 98, SCREEN_H - FOOTER_H + 8, 90, FOOTER_H - 16, "Next >");
  char pg[24];
  snprintf(pg, sizeof(pg), "Page %d / %d", subjectPage + 1, totalPages());
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_TEXT, COL_HEADER);
  tft.drawString(pg, SCREEN_W / 2, SCREEN_H - FOOTER_H / 2);
}

static void handleSubjectsTouch(int x, int y) {
  if (headerGearHit(x, y)) { state = STATE_SETTINGS; return; }

  int start = subjectPage * ROWS_PER_PAGE;
  int rowY = HEADER_H + 6;
  for (int i = start; i < start + ROWS_PER_PAGE && i < categoryCount; i++) {
    if (hit(x, y, 6, rowY, SCREEN_W - 12, ROW_H - 6)) {
      currentCategory = i;
      currentCardIndex = 0;
      answerRevealed = false;
      scrollLine = 0;
      loadCard(currentCategory, currentCardIndex);
      state = STATE_CARD;
      return;
    }
    rowY += ROW_H;
  }

  if (hit(x, y, 8, SCREEN_H - FOOTER_H + 8, 90, FOOTER_H - 16)) {
    if (subjectPage > 0) subjectPage--;
  } else if (hit(x, y, SCREEN_W - 98, SCREEN_H - FOOTER_H + 8, 90, FOOTER_H - 16)) {
    if (subjectPage < totalPages() - 1) subjectPage++;
  }
}

// ---------------------------------------------------------------------------
// Screen: card view
// ---------------------------------------------------------------------------
static const int BODY_TOP = HEADER_H + 8;
static const int BODY_BOTTOM = SCREEN_H - FOOTER_H - 4;
static const int LINE_H = 20;
static const int BODY_W = SCREEN_W - 44; // leaves room for scroll chevrons

// static, NOT stack-local: 40*80 + 80*80 = 9600 bytes, which alone already
// exceeds the ESP32 Arduino core's default 8KB loop-task stack. This was
// the real bug behind "touch does nothing" - the touch controller itself
// is fine (see HARDWARE.md's Touch section); the FIRST tap that opened a
// card overflowed the stack inside this function and the device silently
// rebooted before finishing the redraw, landing back on the subject list
// fast enough to look exactly like the tap was never registered. Safe as
// static here: each call fully repopulates exactly qN/aN entries via
// wordWrap() before anything reads them, and nothing ever reads past
// qN/aN, so stale content from a previous card is never visible.
static char qLines[40][80];
static char aLines[80][80];

static void drawCard() {
  tft.fillScreen(COL_BG);
  char hdr[48];
  snprintf(hdr, sizeof(hdr), "%d / %d", currentCardIndex + 1, categories[currentCategory].count);
  drawHeader(categories[currentCategory].name, true);

  tft.setTextFont(2);
  int qN = wordWrap(cardQ, BODY_W, qLines, 40);
  int aN = answerRevealed ? wordWrap(cardA, BODY_W, aLines, 80) : 0;

  // Build one combined layout: question (accent color), a rule, then answer
  // (once revealed). Scrolled as a whole via scrollLine.
  int totalLines = qN + (answerRevealed ? (2 + aN) : 1);
  int visibleLines = (BODY_BOTTOM - BODY_TOP) / LINE_H;
  if (scrollLine > totalLines - visibleLines) scrollLine = max(0, totalLines - visibleLines);
  if (scrollLine < 0) scrollLine = 0;

  int y = BODY_TOP - scrollLine * LINE_H;
  tft.setTextDatum(TL_DATUM);
  for (int i = 0; i < qN; i++) {
    if (y >= BODY_TOP - LINE_H && y < BODY_BOTTOM) {
      tft.setTextColor(COL_ACCENT, COL_BG);
      tft.drawString(qLines[i], 8, y);
    }
    y += LINE_H;
  }
  if (!answerRevealed) {
    if (y >= BODY_TOP - LINE_H && y < BODY_BOTTOM) {
      tft.setTextColor(COL_DIM, COL_BG);
      tft.drawString("[ Tap card to reveal answer ]", 8, y);
    }
  } else {
    y += LINE_H / 2;
    if (y >= BODY_TOP - LINE_H && y < BODY_BOTTOM) tft.drawFastHLine(8, y, BODY_W, COL_DIM);
    y += LINE_H;
    for (int i = 0; i < aN; i++) {
      if (y >= BODY_TOP - LINE_H && y < BODY_BOTTOM) {
        tft.setTextColor(COL_TEXT, COL_BG);
        tft.drawString(aLines[i], 8, y);
      }
      y += LINE_H;
    }
  }

  // Scroll chevrons, only if content overflows the visible body
  if (totalLines > visibleLines) {
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(scrollLine > 0 ? COL_TEXT : COL_DIM, COL_BG);
    tft.drawString("^", SCREEN_W - 20, BODY_TOP + 10);
    tft.setTextColor(scrollLine < totalLines - visibleLines ? COL_TEXT : COL_DIM, COL_BG);
    tft.drawString("v", SCREEN_W - 20, BODY_BOTTOM - 10);
  }

  // Footer: Prev / card-count / Next
  tft.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, COL_HEADER);
  drawButton(8, SCREEN_H - FOOTER_H + 8, 80, FOOTER_H - 16, "< Prev");
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_TEXT, COL_HEADER);
  tft.drawString(hdr, SCREEN_W / 2, SCREEN_H - FOOTER_H / 2);
  drawButton(SCREEN_W - 88, SCREEN_H - FOOTER_H + 8, 80, FOOTER_H - 16, "Next >");
}

static void handleCardTouch(int x, int y) {
  if (headerBackHit(x, y)) { state = STATE_SUBJECTS; return; }
  if (headerGearHit(x, y)) { state = STATE_SETTINGS; return; }

  // Scroll chevrons along the right edge of the body area (see drawCard's
  // own placement of the ^/v glyphs). loop() redraws unconditionally after
  // this returns, so these branches only need to update scrollLine.
  if (x >= SCREEN_W - 34 && y >= BODY_TOP && y < (BODY_TOP + BODY_BOTTOM) / 2) { scrollLine--; return; }
  if (x >= SCREEN_W - 34 && y >= (BODY_TOP + BODY_BOTTOM) / 2 && y < BODY_BOTTOM) { scrollLine++; return; }

  if (hit(x, y, 8, SCREEN_H - FOOTER_H + 8, 80, FOOTER_H - 16)) {
    if (currentCardIndex > 0) {
      currentCardIndex--;
      answerRevealed = false; scrollLine = 0;
      loadCard(currentCategory, currentCardIndex);
    }
    return;
  }
  if (hit(x, y, SCREEN_W - 88, SCREEN_H - FOOTER_H + 8, 80, FOOTER_H - 16)) {
    if (currentCardIndex < categories[currentCategory].count - 1) {
      currentCardIndex++;
      answerRevealed = false; scrollLine = 0;
      loadCard(currentCategory, currentCardIndex);
    }
    return;
  }
  // Tap anywhere else in the body toggles the answer
  if (y >= BODY_TOP && y < BODY_BOTTOM) {
    answerRevealed = !answerRevealed;
    scrollLine = 0;
  }
}

// ---------------------------------------------------------------------------
// Screen: settings (backlight + install QR)
// ---------------------------------------------------------------------------
static void drawInstallQr(int originX, int originY, int moduleScale) {
  for (int row = 0; row < INSTALL_QR_SIZE; row++) {
    for (int col = 0; col < INSTALL_QR_SIZE; col++) {
      uint8_t byte = INSTALL_QR_BITS[row * INSTALL_QR_BYTES_PER_ROW + col / 8];
      bool dark = byte & (0x80 >> (col % 8));
      tft.fillRect(originX + col * moduleScale, originY + row * moduleScale,
                   moduleScale, moduleScale, dark ? TFT_BLACK : TFT_WHITE);
    }
  }
}

static void drawSettings() {
  tft.fillScreen(COL_BG);
  drawHeader("Settings", true);

  int y = HEADER_H + 16;
  tft.setTextDatum(TL_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_ACCENT, COL_BG);
  tft.drawString("Backlight", 12, y);
  y += 26;
  char pct[8];
  snprintf(pct, sizeof(pct), "%d%%", backlightPct);
  drawButton(12, y, 50, 36, "-");
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(COL_TEXT, COL_BG);
  tft.drawString(pct, SCREEN_W / 2, y + 18);
  drawButton(SCREEN_W - 62, y, 50, 36, "+");
  y += 56;

  tft.drawFastHLine(12, y, SCREEN_W - 24, COL_DIM);
  y += 16;

  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(COL_ACCENT, COL_BG);
  tft.drawString("Get GUIDON on your phone", 12, y);
  y += 24;

  int qrScale = 6; // 41 * 6 = 246px, fits centered in 320 width with margin
  int qrPx = INSTALL_QR_SIZE * qrScale;
  int qrX = (SCREEN_W - qrPx) / 2;
  tft.fillRect(qrX - 6, y - 6, qrPx + 12, qrPx + 12, TFT_WHITE); // quiet-zone margin
  drawInstallQr(qrX, y, qrScale);
  y += qrPx + 16;

  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(COL_DIM, COL_BG);
  tft.setTextFont(1);
  tft.drawString(INSTALL_QR_URL, SCREEN_W / 2, y);
  y += 18;
  tft.setTextColor(COL_TEXT, COL_BG);
  tft.drawString("Scan for the full GUIDON app (iOS/Android/PC)", SCREEN_W / 2, y);
}

static void handleSettingsTouch(int x, int y) {
  if (headerBackHit(x, y)) { state = STATE_SUBJECTS; return; }
  int rowY = HEADER_H + 16 + 26;
  if (hit(x, y, 12, rowY, 50, 36)) { setBacklightPct(backlightPct - 10); return; }
  if (hit(x, y, SCREEN_W - 62, rowY, 50, 36)) { setBacklightPct(backlightPct + 10); return; }
}

// ---------------------------------------------------------------------------
// Touch calibration - first boot only, persisted to NVS
// ---------------------------------------------------------------------------
static void ensureTouchCalibrated() {
  uint16_t calData[5];
  size_t stored = prefs.getBytes("touchcal", calData, sizeof(calData));
  if (stored == sizeof(calData)) {
    tft.setTouch(calData);
    return;
  }
  tft.fillScreen(COL_BG);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_TEXT, COL_BG);
  tft.drawString("First boot: touch each corner target", SCREEN_W / 2, 30);
  tft.calibrateTouch(calData, TFT_WHITE, TFT_RED, 18);
  prefs.putBytes("touchcal", calData, sizeof(calData));
  tft.setTouch(calData);
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  // Breadcrumbs on the boot path, not just the on-screen error states -
  // this device has no camera pointed at it during remote bring-up/CI-style
  // verification, so the serial log is the only channel that confirms each
  // stage actually ran rather than silently hanging.
  Serial.println("GUIDON Flashcard OS booting...");

  // 30kHz, not the 5kHz this originally shipped with - see BL_PWM_FREQ's
  // own comment for the empirical A/B/C test (5kHz: 0/4s touch hits,
  // plain digital no-PWM: 12/4s, 30kHz PWM: 23/4s) that found 5kHz was
  // genuinely desensitizing the resistive touch ADC via switching noise.
  ledcSetup(BL_PWM_CHANNEL, BL_PWM_FREQ, BL_PWM_RES_BITS);
  ledcAttachPin(TFT_BL, BL_PWM_CHANNEL);

  prefs.begin("guidon", false);
  backlightPct = prefs.getUChar("bl", 80);
  applyBacklight();

  tft.init();
  tft.setRotation(0); // portrait, 320x480 - matches HARDWARE.md's confirmed geometry
  Serial.println("TFT init done (ST7796S/320x480).");

  ensureTouchCalibrated();
  Serial.println("Touch calibration ready.");

  tft.fillScreen(COL_BG);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(2);
  tft.setTextColor(COL_TEXT, COL_BG);
  tft.drawString("Loading flashcards...", SCREEN_W / 2, SCREEN_H / 2 - 10);

  if (!beginSdCard()) {
    Serial.println("SD: no card found on any candidate CS pin.");
    tft.fillScreen(TFT_RED);
    tft.setTextColor(TFT_WHITE, TFT_RED);
    tft.drawString("No microSD card found.", SCREEN_W / 2, SCREEN_H / 2 - 20);
    tft.drawString("Insert a card with", SCREEN_W / 2, SCREEN_H / 2 + 4);
    tft.drawString("cards.ndjson + categories.json", SCREEN_W / 2, SCREEN_H / 2 + 24);
    while (true) delay(1000);
  }
  Serial.printf("SD: card found on CS=%d.\n", sdCsUsed);

  if (!loadCategories()) {
    Serial.println("SD: categories.json missing or invalid.");
    tft.fillScreen(TFT_RED);
    tft.setTextColor(TFT_WHITE, TFT_RED);
    tft.drawString("categories.json missing or invalid.", SCREEN_W / 2, SCREEN_H / 2);
    while (true) delay(1000);
  }
  Serial.printf("Loaded %d categories.\n", categoryCount);

  state = STATE_SUBJECTS;
  drawSubjects();
  Serial.println("Ready - showing subject list.");
}

void loop() {
#ifdef DEBUG_TOUCH
  uint16_t rawX = 0, rawY = 0;
  uint8_t rawTouched = tft.getTouchRaw(&rawX, &rawY);
  uint16_t rawZ = tft.getTouchRawZ();
  uint32_t touchReadStartUs = micros();
#endif

  uint16_t tx, ty;
  bool touched = tft.getTouch(&tx, &ty, 600);

#ifdef DEBUG_TOUCH
  uint32_t touchReadDurUs = micros() - touchReadStartUs;
  uint16_t calX = touched ? tx : 0;
  uint16_t calY = touched ? ty : 0;
  uint32_t sinceLastDrawUs = lastDrawEndUs ? (micros() - lastDrawEndUs) : 0;
  Serial.printf("[DEBUG_TOUCH] raw(x=%u y=%u z=%u touched=%u) cal(x=%u y=%u touched=%u) getTouch_us=%lu draw_us=%lu since_draw_us=%lu\n",
                rawX, rawY, rawZ, rawTouched, calX, calY, touched,
                (unsigned long)touchReadDurUs, (unsigned long)lastDrawDurUs,
                (unsigned long)sinceLastDrawUs);
  if (rawZ >= 600 && !touched) {
    Serial.println("[DEBUG_TOUCH] RAW pressure high but getTouch() failed -> likely bad calibration or read timing collision.");
  }
#endif

  if (touched && !wasTouched) {
    // Rising edge only - fires once per press, immediately, regardless of
    // how long the finger lingers afterward. See wasTouched's own comment
    // for why this replaced a fixed post-touch cooldown.
#ifdef DEBUG_TOUCH
    lastDrawStartUs = micros();
#endif
    switch (state) {
      case STATE_SUBJECTS: handleSubjectsTouch(tx, ty); break;
      case STATE_CARD:     handleCardTouch(tx, ty); break;
      case STATE_SETTINGS: handleSettingsTouch(tx, ty); break;
    }
    switch (state) {
      case STATE_SUBJECTS: drawSubjects(); break;
      case STATE_CARD:     drawCard(); break;
      case STATE_SETTINGS: drawSettings(); break;
    }
#ifdef DEBUG_TOUCH
    lastDrawEndUs = micros();
    lastDrawDurUs = lastDrawEndUs - lastDrawStartUs;
#endif
  }
  wasTouched = touched;
}
