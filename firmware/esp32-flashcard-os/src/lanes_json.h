/*
 * GUIDON Flashcard OS - reading the two deck files with ArduinoJson.
 *
 * Kept apart from main.cpp (which needs the SD card and the display) so the
 * SAME code the firmware runs can also be compiled and run on a desktop by
 * host-test/lanes_json_test.cpp, whenever ArduinoJson is on hand (a PlatformIO
 * build fetches it into .pio/libdeps). The deck logic itself, which needs no
 * library at all, is lanes.h.
 *
 * lanesReadTable() takes anything ArduinoJson can read from - the SD card's
 * File on the device, a std::istream on a desktop.
 */
#pragma once
#include <ArduinoJson.h>
#include "lanes.h"

// Reads /lanes.json into `t`. Only each deck's id, label and card count are
// kept: the filter drops the per-deck subject-name lists as the file streams
// past, so the parse holds a few hundred bytes, not the whole file. Returns
// false (table left empty) for a file that cannot be parsed, lists no deck, or
// lists no DEFAULT deck (see laneUsable in lanes.h: a list of MOS decks alone
// would let a fallback open one for a Soldier who never chose it, so such a
// file is treated exactly like no lanes.json at all); *why then names the
// reason, if there is one.
template <typename TInput>
static inline bool lanesReadTable(TInput &in, LaneTable *t, const char **why) {
  laneTableClear(t);
  JsonDocument filter;
  filter["lanes"][0]["id"] = true;
  filter["lanes"][0]["label"] = true;
  filter["lanes"][0]["count"] = true;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, in, DeserializationOption::Filter(filter));
  if (err) {
    if (why) *why = err.c_str();
    return false;
  }
  for (JsonObject l : doc["lanes"].as<JsonArray>()) {
    laneAdd(t, l["id"] | "", l["label"] | "", (uint16_t)(l["count"] | 0));
  }
  if (t->n > 0 && !laneUsable(t)) {
    laneTableClear(t);
    if (why) *why = "lanes.json lists no default deck";
    return false;
  }
  return t->n > 0;
}

// One /categories.json entry's deck membership as a mask against `t` (see
// laneMaskAdd). Sets *tagged when the entry carries a "lanes" list at all.
static inline uint16_t lanesReadMask(JsonObject entry, const LaneTable *t, bool *tagged) {
  JsonArray ls = entry["lanes"].as<JsonArray>();
  if (ls.isNull()) return 0;
  if (tagged) *tagged = true;
  uint16_t mask = 0;
  for (JsonVariant v : ls) mask = laneMaskAdd(t, mask, v.as<const char *>());
  return mask;
}
