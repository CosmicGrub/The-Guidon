/*
 * GUIDON Flashcard OS - one-time SD content loader
 * ==================================================
 * Not part of the shipped app. Its only job: receive files over the SAME
 * USB-serial link already used to flash this device, and write them
 * straight onto the microSD card - so getting cards.ndjson/categories.json
 * onto the card never depends on the operator having a separate microSD
 * reader. Flash this, run tools/push-to-sd.py from the host, then reflash
 * env:flashcardos for the real app.
 *
 * Also serves as the empirical check for SD_CS=5: that pin is INFERRED
 * from the Sunton ESP32-3248S035 board family this hardware's display/
 * touch pinout matches exactly, not given in the user's own confirmed pin
 * table (which only covered display + touch). If SD.begin(SD_CS) fails
 * here, that is the signal to re-check wiring before anything else.
 *
 * Protocol (deliberately the simplest thing that works, not a real
 * transfer protocol like XMODEM - this is a two-file, one-time, same-desk
 * operation, not something this fork needs to keep around as a general
 * capability):
 *   Host -> device, per file:
 *     "PUT <name> <sizeBytes>\n"   (name has no spaces, path is relative
 *                                   to the SD card root - the loader
 *                                   creates it fresh, overwriting any
 *                                   existing file of that name)
 *   Device -> host:
 *     "READY\n"                    (SD opened fine, waiting for bytes)
 *       ...or...
 *     "ERR <reason>\n"             (SD.begin() failed, or open() failed)
 *   Host -> device:
 *     <sizeBytes> raw bytes, no framing - the length in the PUT line is
 *     the only delimiter, so both sides must agree on it exactly.
 *   Device -> host, once sizeBytes have been written:
 *     "DONE <bytesWritten>\n"
 * Host repeats PUT for each file, then sends "EXIT\n" - device replies
 * "BYE\n" and halts (a manual reset/reflash is expected next, not a
 * reboot into anything - see platformio.ini's env list for what to
 * flash next).
 */

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>

// SD_CS=5 (default VSPI CS, matching the Sunton ESP32-3248S035 family's
// most common wiring) failed outright (CMD0/GO_IDLE_STATE never answered)
// on first bring-up. Rather than reflash-and-retry one guess at a time,
// this sweeps every plausible candidate for this board family in one boot
// - all on default VSPI pins (MOSI23/SCLK18/MISO19), varying only CS,
// since the display already claims HSPI's default pins (13/14/12/15) and
// a same-bus-different-CS SD wiring is how this whole board family does
// it. Pins already spoken for by display/touch (13,14,15,2,12,27,33,36)
// are excluded.
static const int SD_CS_CANDIDATES[] = {5, 4, 22, 21, 26, 25};
static int sdCs = -1; // set by trySdCandidates() once one works, -1 if none did

static String readLine() {
  String s = Serial.readStringUntil('\n');
  s.trim();
  return s;
}

static void handlePut(const String &args) {
  int sp = args.indexOf(' ');
  if (sp < 0) { Serial.println("ERR malformed PUT (expected <name> <size>)"); return; }
  String name = args.substring(0, sp);
  long size = args.substring(sp + 1).toInt();
  if (size <= 0 || size > 8 * 1024 * 1024) { Serial.println("ERR bad size"); return; }
  if (!name.startsWith("/")) name = "/" + name;

  File f = SD.open(name, FILE_WRITE);
  if (!f) { Serial.println("ERR could not open file for write"); return; }
  Serial.println("READY");

  long remaining = size;
  uint8_t buf[512];
  uint32_t lastByteMs = millis();
  uint32_t lastProgressMs = millis();
  // A first PUT to a freshly-formatted card stalled silently past the
  // host's wait for DONE on real-device bring-up: the host's "100% sent"
  // only means bytes left ITS buffer, not that this loop actually consumed
  // them (a full UART RX ring buffer while f.write() is busy with the
  // card's own housekeeping can and did lose bytes). Printing real
  // progress from THIS side, not just trusting the host's optimistic
  // percentage, is what turns "silently stuck, cause unknown" into
  // something a serial log actually shows.
  while (remaining > 0) {
    int chunk = min((long)sizeof(buf), remaining);
    int got = Serial.readBytes(buf, chunk);
    if (got > 0) {
      f.write(buf, got);
      remaining -= got;
      lastByteMs = millis();
      if (millis() - lastProgressMs > 2000) {
        Serial.printf("  ... %ld/%ld bytes written\n", (long)(size - remaining), size);
        lastProgressMs = millis();
      }
    } else if (millis() - lastByteMs > 20000) {
      f.close();
      Serial.printf("ERR timeout waiting for data (%ld/%ld written)\n", (long)(size - remaining), size);
      return;
    }
  }
  f.flush();
  f.close();
  Serial.printf("DONE %ld\n", (long)(size - remaining));
}

// Bring-up against the real device showed CS=5 responding INCONSISTENTLY
// across otherwise-identical resets - a real card mount (rejected only for
// having no valid FAT volume) on some boots, dead silence at CMD0 on
// others. That pattern (same pin, same wiring, same code, different
// result) is a marginal-contact / SPI power-on-race symptom, not a wrong-
// pin symptom - a wrong pin fails the SAME way every time. So each
// candidate gets several attempts with a short settle delay before this
// moves on, instead of writing off a correct pin because of one flaky
// poll.
static const int ATTEMPTS_PER_CANDIDATE = 5;

static bool trySdCandidates() {
  for (int cs : SD_CS_CANDIDATES) {
    for (int attempt = 1; attempt <= ATTEMPTS_PER_CANDIDATE; attempt++) {
      Serial.printf("  trying SD_CS=%d (attempt %d/%d) ... ", cs, attempt, ATTEMPTS_PER_CANDIDATE);
      SD.end(); // release the previous attempt's bus claim before retrying
      delay(100); // let the card's own power/SPI state settle before CMD0
      // format_if_empty=true: a card that responds to CMD0 fine but has no
      // valid FAT volume (blank, or something FatFs doesn't recognize) gets
      // formatted FAT32 right here rather than reported as a failure - see
      // HARDWARE.md's SD section.
      if (SD.begin(cs, SPI, 4000000, "/sd", 5, true)) {
        Serial.println("OK");
        sdCs = cs;
        return true;
      }
      Serial.println("no response this attempt");
    }
  }
  return false;
}

void setup() {
  // Must be set BEFORE begin() to take effect. Default ESP32 Arduino core
  // UART RX ring buffer (256B) is small enough that a burst of incoming
  // PUT bytes can overflow it while this sketch is off doing a blocking
  // f.write() to the SD card - exactly the failure real-device bring-up
  // hit (host reported 100% sent, device never confirmed DONE). 8KB gives
  // > 15 chunks of headroom at this protocol's 512B chunk size.
  Serial.setRxBufferSize(8192);
  Serial.begin(115200);
  Serial.setTimeout(20000);
  delay(500);

  Serial.println();
  Serial.println("GUIDON Flashcard OS - SD loader ready.");
  Serial.println("Sweeping candidate SD_CS pins (see sdloader_main.cpp header for why):");
  if (!trySdCandidates()) {
    Serial.println("ERR none of the candidate SD_CS pins found a card.");
    Serial.println("Most likely cause: no microSD card is physically inserted right now.");
    Serial.println("Insert one (FAT32-formatted) and power-cycle the board, then retry.");
  } else {
    uint64_t sizeMb = SD.cardSize() / (1024ULL * 1024ULL);
    Serial.printf("SD card OK on SD_CS=%d, size ~%llu MB. Waiting for PUT commands.\n", sdCs, sizeMb);
  }
}

void loop() {
  if (!Serial.available()) return;
  String line = readLine();
  if (line.startsWith("PUT ")) {
    handlePut(line.substring(4));
  } else if (line == "EXIT") {
    Serial.println("BYE");
    while (true) delay(1000);
  } else if (line.length()) {
    Serial.println("ERR unknown command");
  }
}
