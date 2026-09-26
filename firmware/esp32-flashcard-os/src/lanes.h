/*
 * GUIDON Flashcard OS - deck ("lane") logic.
 *
 * A DECK is a named set of subjects. The default deck ("Standard deck") holds
 * every card with no MOS tag; each MOS deck (92A, 68W, ...) is a deck of its
 * own and is only ever shown when the Soldier picks it in Settings - the same
 * opt-in rule the full GUIDON app keeps (tools/lanes.mjs writes the files this
 * reads, and explains the rule and the format).
 *
 * This file is deliberately free of Arduino, SD and display code: everything
 * here is plain C++ over plain arrays, so the same header is compiled and RUN
 * on a desktop by host-test/lanes_test.cpp (guidon-app/tools/test-esp32-lanes.mjs
 * drives it) as well as built into the firmware. main.cpp keeps only the
 * parts that need the SD card or the screen: reading /lanes.json and
 * /categories.json into these structures, and drawing the deck button.
 *
 * Memory: a LaneTable is 16 x 58 bytes and the per-subject deck mask is 2
 * bytes, so decks add well under 2 KB of RAM. Cards are never held.
 *
 * The three LANES_* / LANE_* sizes below are also written into
 * tools/lanes.mjs (LIMITS); test-esp32-lanes.mjs fails if they drift apart.
 */
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define LANES_MAX 16          // decks the device holds (a uint16_t mask has one bit each)
#define LANE_ID_LEN 12        // incl. the end mark: "default", "92A", ...
#define LANE_LABEL_LEN 44     // incl. the end mark: "Standard deck", "92A Automated Logistical Specialist"
#define LANE_DEFAULT_ID "default"

struct LaneInfo {
  char id[LANE_ID_LEN];
  char label[LANE_LABEL_LEN];
  uint16_t count;
};

struct LaneTable {
  LaneInfo lane[LANES_MAX];
  int n;
};

// Copy at most cap-1 characters and always end the string.
static inline void laneCopy(char *dst, size_t cap, const char *src) {
  if (!src) src = "";
  size_t i = 0;
  for (; i + 1 < cap && src[i]; i++) dst[i] = src[i];
  dst[i] = 0;
}

static inline void laneTableClear(LaneTable *t) { t->n = 0; }

// Index of the deck with this id, or -1.
static inline int laneFind(const LaneTable *t, const char *id) {
  if (!id) return -1;
  for (int i = 0; i < t->n; i++) if (strcmp(t->lane[i].id, id) == 0) return i;
  return -1;
}

// Add one deck. Returns false and adds nothing for an empty id, an id too long
// to hold (truncating could make two decks look alike), an id already there,
// or a full table. An over-long label is only shortened; an empty one falls
// back to the id.
static inline bool laneAdd(LaneTable *t, const char *id, const char *label, uint16_t count) {
  if (!id || !id[0] || strlen(id) >= LANE_ID_LEN) return false;
  if (laneFind(t, id) >= 0) return false;
  if (t->n >= LANES_MAX) return false;
  LaneInfo &l = t->lane[t->n];
  laneCopy(l.id, sizeof(l.id), id);
  laneCopy(l.label, sizeof(l.label), (label && label[0]) ? label : id);
  l.count = count;
  t->n++;
  return true;
}

// Which deck to start on: the one saved in NVS if the card still has it,
// otherwise the default deck, otherwise the first. -1 only when there are none.
// A saved MOS deck that is no longer on the card falls back to the default
// deck - never the other way round.
static inline int laneResolve(const LaneTable *t, const char *savedId) {
  if (t->n <= 0) return -1;
  int i = laneFind(t, savedId);
  if (i >= 0) return i;
  i = laneFind(t, LANE_DEFAULT_ID);
  return i >= 0 ? i : 0;
}

// The next deck after `cur`, wrapping round (what a tap on the deck button does).
static inline int laneNext(const LaneTable *t, int cur) {
  if (t->n <= 0) return -1;
  return (cur + 1) % t->n;
}

// Add the bit for deck `id` to a subject's mask. An id the table does not
// know adds nothing - so a stale or mismatched lanes.json can hide subjects,
// never show one that was not meant to be shown.
static inline uint16_t laneMaskAdd(const LaneTable *t, uint16_t mask, const char *id) {
  int i = laneFind(t, id);
  return i >= 0 ? (uint16_t)(mask | (1u << i)) : mask;
}

// Decks are switched on only when there is a lanes.json with at least one
// deck AND categories.json actually says which deck each subject is in.
// Anything else (no lanes.json, or lanes.json copied onto a card whose
// categories.json is from before decks existed) behaves exactly as the device
// always did: every subject, one list.
static inline bool laneActive(const LaneTable *t, bool anyCategoryTagged) {
  return t->n > 0 && anyCategoryTagged;
}

// Fill out[] with the indexes of the subjects to list, in order, and return
// how many. Decks off: every subject. Decks on: only those in deck `laneIdx`.
static inline int laneVisible(const uint16_t *masks, int categoryCount, bool active, int laneIdx, int16_t *out, int outCap) {
  int n = 0;
  for (int i = 0; i < categoryCount && n < outCap; i++) {
    if (!active || (laneIdx >= 0 && laneIdx < LANES_MAX && (masks[i] & (1u << laneIdx)))) out[n++] = (int16_t)i;
  }
  return n;
}
