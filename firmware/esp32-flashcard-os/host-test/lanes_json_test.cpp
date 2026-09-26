/*
 * Host-side test for src/lanes_json.h - the code that reads /lanes.json and
 * each /categories.json entry's "lanes" list with ArduinoJson. The very same
 * header main.cpp builds; here it is compiled against ArduinoJson (a PlatformIO
 * build fetches it into .pio/libdeps/flashcardos/ArduinoJson/src) and fed
 * std::istream input instead of the SD card's File.
 *
 * Only run by guidon-app/tools/test-esp32-lanes.mjs when that ArduinoJson
 * folder exists (or ARDUINOJSON_DIR points at one); otherwise the suite says
 * it was skipped.
 *
 *   lanes_json_test                                 the unit checks
 *   lanes_json_test <lanes.json> <categories.json>  the unit checks, then the
 *        real export read the way the device reads it, printed as "@..." lines
 *        (same shape as lanes_test's replay) for the suite to compare.
 */
#ifdef _MSC_VER
#define _CRT_SECURE_NO_WARNINGS
#endif
#include <stdio.h>
#include <string.h>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include "../src/lanes_json.h"

static int fails = 0;
static void check(bool cond, const char *what) {
  printf("  %s  %s\n", cond ? "PASS" : "FAIL", what);
  if (!cond) fails++;
}

static bool readLanes(const char *json, LaneTable *t, const char **why) {
  std::istringstream in(json);
  return lanesReadTable(in, t, why);
}

static uint16_t maskOf(const char *entryJson, const LaneTable *t, bool *tagged) {
  JsonDocument doc;
  deserializeJson(doc, entryJson);
  return lanesReadMask(doc.as<JsonObject>(), t, tagged);
}

static void unitChecks() {
  printf("\nreading lanes.json\n");
  LaneTable t;
  const char *why = NULL;
  const char *good =
      "{\"schema\":1,\"lanes\":["
      "{\"id\":\"default\",\"label\":\"Standard deck\",\"count\":1283,\"categories\":[\"Army Values\",\"Leadership\"]},"
      "{\"id\":\"92A\",\"label\":\"92A Automated Logistical Specialist\",\"count\":40,\"categories\":[\"92A - MOS Fundamentals\"]}]}";
  check(readLanes(good, &t, &why) && t.n == 2, "reads a deck list");
  check(strcmp(t.lane[0].id, "default") == 0 && strcmp(t.lane[0].label, "Standard deck") == 0 && t.lane[0].count == 1283, "keeps a deck's id, label and count");
  check(strcmp(t.lane[1].id, "92A") == 0 && t.lane[1].count == 40, "and the next deck's, in file order");
  check(readLanes("{\"lanes\":[{\"id\":\"default\",\"label\":\"x\",\"count\":1,\"unexpected\":{\"deep\":[1,2,3]}}]}", &t, &why) && t.n == 1, "extra fields the device does not use are skipped");
  check(!readLanes("{\"lanes\":[", &t, &why) && why && why[0] && t.n == 0, "a file cut off part-way is refused, says why, and leaves no decks");
  check(!readLanes("not json at all", &t, &why) && t.n == 0, "garbage is refused");
  check(!readLanes("{\"lanes\":[]}", &t, &why) && t.n == 0, "a deck list with no decks is refused (decks stay off)");
  check(!readLanes("{\"schema\":1}", &t, &why) && t.n == 0, "a file with no deck list is refused");
  {
    // No default ("Standard") deck: only MOS decks. Refused like a missing file, so nothing can fall back to one.
    const char *mosOnly =
        "{\"schema\":1,\"lanes\":["
        "{\"id\":\"92A\",\"label\":\"92A Automated Logistical Specialist\",\"count\":40,\"categories\":[\"92A - MOS Fundamentals\"]},"
        "{\"id\":\"68W\",\"label\":\"68W Combat Medic\",\"count\":24,\"categories\":[\"68W - MOS Fundamentals\"]}]}";
    why = NULL;
    check(!readLanes(mosOnly, &t, &why) && t.n == 0 && why && strstr(why, "no default") != NULL, "a deck list with ONLY MOS decks (no default deck) is refused, leaves no decks, and says why");
    check(laneResolve(&t, "92A") == -1 && !laneActive(&t, true), "...so nothing resolves to an MOS deck and decks stay off, however well tagged categories.json is");
    check(readLanes("{\"lanes\":[{\"id\":\"92A\",\"label\":\"x\"},{\"id\":\"default\",\"label\":\"Standard deck\"}]}", &t, &why) && t.n == 2 && laneResolve(&t, "GONE") == 1, "a default deck listed AFTER an MOS deck is fine: it is found by id, and a gone saved deck starts on it, not on index 0");
  }
  check(readLanes("{\"lanes\":[{\"id\":\"default\"}]}", &t, &why) && strcmp(t.lane[0].label, "default") == 0 && t.lane[0].count == 0, "a deck with no label or count still loads (label falls back to the id, count 0)");
  check(readLanes("{\"lanes\":[{\"id\":7,\"label\":\"x\"},{\"id\":\"default\"},{\"id\":\"default\"},{\"label\":\"no id\"}]}", &t, &why) && t.n == 1, "a non-text id, a repeated id and a missing id are skipped, never crash");
  std::string many = "{\"lanes\":[";
  // (the first deck is the default one: a list with no default deck is refused, see above)
  for (int i = 0; i < LANES_MAX + 4; i++) { char one[64]; if (i == 0) snprintf(one, sizeof(one), "{\"id\":\"default\"}"); else snprintf(one, sizeof(one), ",{\"id\":\"D%d\"}", i); many += one; }
  many += "]}";
  check(readLanes(many.c_str(), &t, &why) && t.n == LANES_MAX, "more decks than the table holds: the first LANES_MAX load, the rest are ignored");
  check(readLanes("{\"lanes\":[{\"id\":\"default\",\"label\":\"This label is far longer than the forty-three characters the device keeps for it\"}]}", &t, &why) && strlen(t.lane[0].label) == LANE_LABEL_LEN - 1, "an over-long label is shortened, not overrun");

  printf("\nreading a subject's decks\n");
  readLanes(good, &t, &why);
  bool tagged = false;
  check(maskOf("{\"name\":\"Army Values\",\"count\":3,\"offset\":0,\"lanes\":[\"default\"]}", &t, &tagged) == 1 && tagged, "a subject in the default deck gets that deck's bit, and marks the file as deck-aware");
  tagged = false;
  check(maskOf("{\"name\":\"92A - X\",\"lanes\":[\"92A\"]}", &t, &tagged) == 2 && tagged, "a subject in the 92A deck gets that bit");
  tagged = false;
  check(maskOf("{\"name\":\"Both\",\"lanes\":[\"92A\",\"default\"]}", &t, &tagged) == 3, "a subject in two decks gets both bits");
  tagged = false;
  check(maskOf("{\"name\":\"Odd\",\"lanes\":[\"nope\",\"92A\",7,null]}", &t, &tagged) == 2 && tagged, "an unknown deck, a number and null in the list add nothing");
  tagged = false;
  check(maskOf("{\"name\":\"Old\",\"count\":3,\"offset\":0}", &t, &tagged) == 0 && !tagged, "a subject with no lanes list (categories.json from before decks) leaves the file un-deck-aware");
  tagged = false;
  check(maskOf("{\"name\":\"Wrong\",\"lanes\":\"92A\"}", &t, &tagged) == 0 && !tagged, "a lanes value that is not a list is ignored, not read as a deck");
  tagged = false;
  check(maskOf("{\"name\":\"Empty\",\"lanes\":[]}", &t, &tagged) == 0 && tagged, "an empty list is deck-aware but in no deck (so it is shown in none)");
}

// ---- real export -----------------------------------------------------------
static std::string join(const std::vector<std::string> &v, const char *sep) {
  std::string out;
  for (size_t i = 0; i < v.size(); i++) out += (i ? sep : "") + v[i];
  return out;
}

static void realExport(const char *lanesPath, const char *categoriesPath) {
  printf("\nreading %s and %s\n", lanesPath, categoriesPath);
  std::ifstream lf(lanesPath, std::ios::binary);
  LaneTable t;
  const char *why = NULL;
  bool haveLanes = lf && lanesReadTable(lf, &t, &why);
  check(haveLanes, "the exporter's lanes.json reads");

  std::ifstream cf(categoriesPath, std::ios::binary);
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, cf);
  check(!err, "the exporter's categories.json reads");
  struct Sub { std::string name; int count; uint16_t mask; };
  std::vector<Sub> subs;
  bool tagged = false;
  for (JsonObject c : doc.as<JsonArray>()) {
    Sub s;
    s.name = (const char *)(c["name"] | "?");
    s.count = c["count"] | 0;
    s.mask = lanesReadMask(c, &t, &tagged);
    subs.push_back(s);
  }
  printf("@ACTIVE\t%d\n", laneActive(&t, tagged) ? 1 : 0);
  for (int li = 0; li < t.n; li++) {
    std::vector<std::string> names;
    int sum = 0;
    for (size_t i = 0; i < subs.size(); i++) if (subs[i].mask & (1u << li)) { names.push_back(subs[i].name); sum += subs[i].count; }
    printf("@VIEW\t%s\t%d\t%d\t%s\n", t.lane[li].id, (int)names.size(), sum, join(names, "|").c_str());
    printf("@LANE\t%s\t%s\t%d\n", t.lane[li].id, t.lane[li].label, t.lane[li].count);
  }
}

int main(int argc, char **argv) {
  unitChecks();
  if (argc > 2) realExport(argv[1], argv[2]);
  printf("\n%s\n", fails ? "LANES JSON C++ TEST: FAILED" : "LANES JSON C++ TEST: all passed");
  return fails ? 1 : 0;
}
