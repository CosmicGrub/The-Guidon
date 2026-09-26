/*
 * Host-side test for src/lanes.h - the deck ("lane") logic the firmware runs.
 *
 * Runs on a desktop, not on the device: lanes.h has no Arduino, SD or display
 * code in it, so the SAME header the firmware builds is compiled here with an
 * ordinary C++ compiler and exercised directly. guidon-app/tools/
 * test-esp32-lanes.mjs compiles and runs this (g++, clang++ or MSVC cl, C++11).
 *
 *   lanes_test                 the unit checks
 *   lanes_test <fixture.tsv>   the unit checks, then a replay of a fixture the
 *                              node suite wrote from the REAL exporter's
 *                              lanes.json + categories.json, printing what the
 *                              device would list for each deck as "@..." lines
 *                              the suite compares with the exporter's own figures.
 *
 * Fixture lines (tab separated):
 *   LANE  <id>  <label>  <count>
 *   CAT   <name>  <count>  <lane,lane,...|->       ("-" = the entry had no "lanes" field)
 *   SAVED <id>                                     (the deck saved in NVS, if any)
 *
 * What this does NOT cover: reading the two JSON files (ArduinoJson, in
 * main.cpp) and drawing - those need the device or its libraries.
 */
#ifdef _MSC_VER
#define _CRT_SECURE_NO_WARNINGS
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include "../src/lanes.h"

static int fails = 0;
static void check(bool cond, const char *what) {
  printf("  %s  %s\n", cond ? "PASS" : "FAIL", what);
  if (!cond) fails++;
}

static void unitChecks() {
  printf("\nlane table\n");
  LaneTable t;
  laneTableClear(&t);
  check(laneAdd(&t, "default", "Standard deck", 10), "adds the default deck");
  check(laneAdd(&t, "92A", "92A Automated Logistical Specialist", 4), "adds an MOS deck");
  check(t.n == 2 && strcmp(t.lane[1].label, "92A Automated Logistical Specialist") == 0 && t.lane[1].count == 4, "keeps id, label and count");
  check(!laneAdd(&t, "92A", "again", 1) && t.n == 2, "refuses the same id twice");
  check(!laneAdd(&t, "", "no id", 1) && !laneAdd(&t, NULL, "no id", 1) && t.n == 2, "refuses an empty or missing id");
  check(!laneAdd(&t, "ABCDEFGHIJKL", "12 chars", 1) && t.n == 2, "refuses an id too long to hold (never truncates it into a look-alike)");
  check(laneAdd(&t, "ABCDEFGHIJK", "11 chars", 1) && t.n == 3, "holds an id of exactly LANE_ID_LEN - 1 characters");
  char longLabel[80];
  memset(longLabel, 'x', sizeof(longLabel) - 1);
  longLabel[sizeof(longLabel) - 1] = 0;
  check(laneAdd(&t, "LONG", longLabel, 1) && strlen(t.lane[3].label) == LANE_LABEL_LEN - 1, "shortens an over-long label to fit, still ending it");
  check(laneAdd(&t, "NOLABEL", "", 1) && strcmp(t.lane[4].label, "NOLABEL") == 0, "an empty label falls back to the id");
  LaneTable full;
  laneTableClear(&full);
  bool allFit = true;
  for (int i = 0; i < LANES_MAX; i++) { char id[8]; snprintf(id, sizeof(id), "D%d", i); allFit = allFit && laneAdd(&full, id, "x", 1); }
  check(allFit && full.n == LANES_MAX && !laneAdd(&full, "ONEMORE", "x", 1), "holds LANES_MAX decks and refuses one more");

  printf("\nfinding and choosing a deck\n");
  check(laneFind(&t, "92A") == 1 && laneFind(&t, "nope") == -1 && laneFind(&t, NULL) == -1, "laneFind: found, unknown, missing");
  LaneTable none;
  laneTableClear(&none);
  check(laneResolve(&none, "92A") == -1 && laneNext(&none, 0) == -1, "no decks: nothing to resolve, nothing to cycle");
  check(laneResolve(&t, "92A") == 1, "starts on the saved deck when the card still has it");
  check(laneResolve(&t, "GONE") == 0 && laneResolve(&t, "") == 0 && laneResolve(&t, NULL) == 0, "a saved deck that is gone (or nothing saved) starts on the default deck");
  LaneTable odd;
  laneTableClear(&odd);
  laneAdd(&odd, "92A", "92A", 1);
  laneAdd(&odd, "default", "Standard deck", 1);
  check(laneResolve(&odd, "GONE") == 1, "the default deck is found by id, not assumed to be first");
  LaneTable noDefault;
  laneTableClear(&noDefault);
  laneAdd(&noDefault, "92A", "92A", 1);
  laneAdd(&noDefault, "68W", "68W", 1);
  check(laneResolve(&noDefault, "GONE") == 0, "with no default deck listed, falls back to the first");
  check(laneNext(&t, 0) == 1 && laneNext(&t, t.n - 1) == 0, "the deck button cycles to the next deck and wraps round");
  int seen = 0, at = 0;
  for (int i = 0; i < t.n; i++) { seen |= 1 << at; at = laneNext(&t, at); }
  check(seen == (1 << t.n) - 1 && at == 0, "one full turn of the button visits every deck once and comes back");

  printf("\nwhich subjects a deck shows\n");
  LaneTable d;
  laneTableClear(&d);
  laneAdd(&d, "default", "Standard deck", 0);
  laneAdd(&d, "68W", "68W", 0);
  laneAdd(&d, "92A", "92A", 0);
  uint16_t masks[6];
  masks[0] = laneMaskAdd(&d, 0, "default");                                   // shared subject
  masks[1] = laneMaskAdd(&d, 0, "default");                                   // shared subject
  masks[2] = laneMaskAdd(&d, 0, "92A");                                       // 92A only
  masks[3] = laneMaskAdd(&d, 0, "68W");                                       // 68W only
  masks[4] = laneMaskAdd(&d, laneMaskAdd(&d, 0, "68W"), "92A");               // both MOS decks
  masks[5] = laneMaskAdd(&d, 0, "SOMEWHERE-ELSE");                            // a deck this card does not list
  check(masks[0] == 1 && masks[2] == 4 && masks[3] == 2 && masks[4] == 6 && masks[5] == 0, "a subject's mask has one bit per deck it is in; an unknown deck adds none");
  check(laneMaskAdd(&d, 5, NULL) == 5, "a missing id adds nothing");
  int16_t out[6];
  int n = laneVisible(masks, 6, true, 0, out, 6);
  check(n == 2 && out[0] == 0 && out[1] == 1, "default deck: only the subjects marked default - NO MOS subject, however many decks exist (the opt-in rule)");
  n = laneVisible(masks, 6, true, 2, out, 6);
  check(n == 2 && out[0] == 2 && out[1] == 4, "92A deck: its own subject and the shared 92A/68W one, in order");
  n = laneVisible(masks, 6, true, 1, out, 6);
  check(n == 2 && out[0] == 3 && out[1] == 4, "68W deck: its own subject and the shared 92A/68W one, in order");
  bool anyShowsUntagged = false;
  for (int li = 0; li < d.n; li++) { n = laneVisible(masks, 6, true, li, out, 6); for (int i = 0; i < n; i++) if (out[i] == 5) anyShowsUntagged = true; }
  check(!anyShowsUntagged, "a subject whose deck is unknown is shown in no deck at all (a mismatched file can hide, never reveal)");
  check(laneVisible(masks, 6, true, -1, out, 6) == 0 && laneVisible(masks, 6, true, LANES_MAX, out, 6) == 0, "an out-of-range deck shows nothing");
  n = laneVisible(masks, 6, false, 0, out, 6);
  check(n == 6 && out[0] == 0 && out[5] == 5, "decks off: every subject, in order, exactly as the device always listed them");
  check(laneVisible(masks, 6, true, 0, out, 1) == 1, "never writes past the output size");
  check(laneVisible(masks, 0, true, 0, out, 6) == 0, "no subjects, nothing to show");

  printf("\nwhen decks are on\n");
  check(laneActive(&d, true), "a deck list and tagged subjects: on");
  check(!laneActive(&none, true), "no lanes.json: off - behaves exactly as before decks existed");
  check(!laneActive(&d, false), "lanes.json but a categories.json from before decks: off, not an empty screen");
  check(!laneActive(&none, false), "neither: off");
}

// ---- fixture replay -------------------------------------------------------
static std::vector<std::string> split(const std::string &s, char sep) {
  std::vector<std::string> out;
  size_t from = 0;
  for (;;) {
    size_t at = s.find(sep, from);
    if (at == std::string::npos) { out.push_back(s.substr(from)); break; }
    out.push_back(s.substr(from, at - from));
    from = at + 1;
  }
  return out;
}

struct Cat { std::string name; int count; std::string lanes; };

static void replay(const char *path) {
  printf("\nreplaying %s\n", path);
  FILE *f = fopen(path, "r");
  if (!f) { check(false, "opens the fixture"); return; }
  LaneTable t;
  laneTableClear(&t);
  std::vector<Cat> cats;
  std::string saved;
  bool haveSaved = false;
  char line[8192];
  while (fgets(line, sizeof(line), f)) {
    std::string s(line);
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
    if (s.empty()) continue;
    std::vector<std::string> p = split(s, '\t');
    if (p[0] == "LANE" && p.size() >= 4) laneAdd(&t, p[1].c_str(), p[2].c_str(), (uint16_t)atoi(p[3].c_str()));
    else if (p[0] == "CAT" && p.size() >= 4) cats.push_back(Cat{p[1], atoi(p[2].c_str()), p[3]});
    else if (p[0] == "SAVED" && p.size() >= 2) { saved = p[1]; haveSaved = true; }
  }
  fclose(f);

  // What loadCategories() does: lanes were read first, each subject's list of
  // deck ids becomes a mask against them.
  std::vector<uint16_t> masks(cats.size() ? cats.size() : 1, 0);
  bool anyTagged = false;
  for (size_t i = 0; i < cats.size(); i++) {
    if (cats[i].lanes == "-") continue;
    anyTagged = true;
    std::vector<std::string> ids = split(cats[i].lanes, ',');
    for (size_t k = 0; k < ids.size(); k++) masks[i] = laneMaskAdd(&t, masks[i], ids[k].c_str());
  }
  bool active = laneActive(&t, anyTagged);
  printf("@ACTIVE\t%d\n", active ? 1 : 0);
  int start = laneResolve(&t, haveSaved ? saved.c_str() : NULL);
  printf("@START\t%s\n", start >= 0 ? t.lane[start].id : "-");

  std::vector<int16_t> out(cats.size() + 1);
  if (!active) {
    int n = laneVisible(masks.data(), (int)cats.size(), false, 0, out.data(), (int)out.size());
    int sum = 0;
    std::string names;
    for (int i = 0; i < n; i++) { sum += cats[out[i]].count; names += (i ? "|" : "") + cats[out[i]].name; }
    printf("@VIEW\t-\t%d\t%d\t%s\n", n, sum, names.c_str());
  } else {
    for (int li = 0; li < t.n; li++) {
      int n = laneVisible(masks.data(), (int)cats.size(), true, li, out.data(), (int)out.size());
      int sum = 0;
      std::string names;
      for (int i = 0; i < n; i++) { sum += cats[out[i]].count; names += (i ? "|" : "") + cats[out[i]].name; }
      printf("@VIEW\t%s\t%d\t%d\t%s\n", t.lane[li].id, n, sum, names.c_str());
    }
    std::string order;
    int at = start;
    for (int i = 0; i < t.n; i++) { order += (i ? "," : ""); order += t.lane[at].id; at = laneNext(&t, at); }
    printf("@CYCLE\t%s\n", order.c_str());
  }
  check(true, "replay finished");
}

int main(int argc, char **argv) {
  unitChecks();
  if (argc > 1) replay(argv[1]);
  printf("\n%s\n", fails ? "LANES C++ TEST: FAILED" : "LANES C++ TEST: all passed");
  return fails ? 1 : 0;
}
