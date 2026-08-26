/**
 * Roadmap Tier 6b, "#/learn list-detail split" - Sub-step A ONLY: course
 * list left / that course's own lesson list right. Sub-step B (promoting
 * the right pane further into the actual active-lesson READER, rewriting
 * openLesson()'s own tier-toggle/knowledge-check/mastery-button/prev-next
 * logic to mutate in place) is deliberately OUT OF SCOPE for this change -
 * openLesson() is completely untouched, so this file's own job is partly to
 * PROVE that: a lesson click still opens the exact same full-page reader it
 * always has, and that reader's own back button still works.
 *
 * Modeled on tools/test-dictionary-list-detail.mjs's structure (the closest
 * precedent: a real single-selection right pane that REPLACES its content
 * per row click, not a jump-to-already-rendered-content index like Money's
 * own .list-detail usage) and tools/test-list-nav-tier2d.mjs's keyboard-nav
 * contract shape for Board Drill's catList (clamp at both ends - no filter/
 * search input sits directly above courseList to return focus to).
 *
 * Covers:
 *   - courseList renders one row per real course (count derived from the
 *     app's own window.G.store.curriculum() data, not a hardcoded figure -
 *     that count has already drifted once since this item was first scoped).
 *   - with a rank tier seeded (E5), the existing rank-tier grouping is
 *     preserved: group-label dividers appear in primary -> relevant -> other
 *     order, each divider immediately precedes its own group's first row,
 *     and every row's actual classification (re-derived from real
 *     primaryFor/relevantTiers data) matches the group it visually falls
 *     under.
 *   - default selection on a fresh load (no query/click yet) is the FIRST
 *     row in DOM order (mirrors Dictionary's own "default-select the first
 *     item, don't show an empty placeholder" precedent) - checked both
 *     with no tier set (plain first course) and with a tier set (first
 *     PRIMARY course post-sort, proving the default reads the SORTED list,
 *     not the raw one).
 *   - clicking a non-first, non-active course row updates the active
 *     course and the right pane to show THAT course's own real title and
 *     lesson list (not the previously-active course's) - defeats an
 *     unincremented-index/always-shows-row-0 bug.
 *   - progress badges on course rows show correct studied/mastered/total
 *     numbers after seeding real "curr:"-prefixed kv progress rows for two
 *     of one course's lessons, verified against an independently-computed
 *     expectation (not the app's own courseProgress(), a parallel
 *     computation over the same real data) - the part flagged as most
 *     likely to silently regress in this rewrite.
 *   - clicking a lesson in the right pane still opens openLesson()'s full
 *     reader exactly as before: tier-toggle segmented control (one button
 *     per tier), a knowledge-check reveal button for a lesson known to have
 *     one (revealing the real answer text), and the mastery buttons - proof
 *     Level 3 (openLesson) is untouched.
 *   - the lesson reader's own "‹ <course title>" back button returns to a
 *     WORKING list-detail view with that same course still active/
 *     highlighted and its lesson list intact (not a blank or broken pane).
 *   - .list-detail is display:grid at >=1024px, display:block (stacked)
 *     below it, at the documented 1023/1024px boundary.
 *   - keyboard nav: ArrowDown/ArrowUp move row-to-row and clamp at both
 *     ends (no return-to-input, matching Board Drill's catList contract -
 *     see that list's own keydown comment in index.html); a group-label
 *     divider between two groups is skipped over, never focused; Enter on
 *     a focused row activates it exactly like a click.
 *   - no console errors/warnings anywhere in the above.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootTo(hash, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1100);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(700);
  return { page, noise };
}

// Seeds a completed-onboarding "personal" profile with the given rank tier
// directly onto the real "guidon:profile:v1" kv row (same shape/pattern
// tools/test-settings-toggles.mjs's own "Focus tier confirm gate" section
// uses), then reloads so G.profile.current() picks it up fresh - onboarding
// is skipped entirely since onboardingComplete is already true, so there is
// no guest-session card to click here.
async function bootWithTier(tier, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await page.evaluate(async (t) => {
    await window.G.db.put("kv", { k: "guidon:profile:v1", v: { onboardingComplete: true, mode: "personal", tier: t, rank: t } });
  }, tier);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.evaluate(() => { location.hash = "#/learn"; });
  await page.waitForTimeout(700);
  return { page, noise };
}

/* ================= 1) courseList renders one row per real course ================= */
{
  const { page, noise } = await bootTo("#/learn", { width: 1440, height: 900 });

  const expectedCount = await page.evaluate(() => (window.G.store.curriculum().courses || []).length);
  expectedCount > 0
    ? ok(`dataset has ${expectedCount} real course(s) to test against`)
    : bad("dataset has zero courses - cannot run this suite");

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount === expectedCount
    ? ok(`courseList rendered exactly ${rowCount} row(s), matching the real course count`)
    : bad(`courseList rendered ${rowCount} row(s), expected the real course count ${expectedCount}`);

  const hasListDetail = await page.evaluate(() => !!document.querySelector(".list-detail"));
  hasListDetail ? ok(".list-detail wrapper is present on #/learn") : bad(".list-detail wrapper not found on #/learn");

  noise.length === 0 ? ok("no console errors/warnings on #/learn load") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 2) default selection: first row in DOM order, no tier set ================= */
{
  const { page, noise } = await bootTo("#/learn", { width: 1440, height: 900 });

  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
    const firstRow = rows[0];
    return {
      firstRowActive: firstRow ? firstRow.classList.contains("active") : false,
      firstRowId: firstRow ? firstRow.dataset.courseId : null,
      activeRowCount: document.querySelectorAll(".list-detail-list .list-detail-row.active").length,
      detailH2: document.querySelector("#learn-detail-pane h2")?.textContent || null,
    };
  });
  const firstCourse = await page.evaluate(() => (window.G.store.curriculum().courses || [])[0]);

  state.activeRowCount === 1 && state.firstRowActive
    ? ok("exactly one row is active on fresh load, and it is the first row")
    : bad(`active row count = ${state.activeRowCount}, first row active = ${state.firstRowActive}`);
  state.firstRowId === firstCourse.id
    ? ok(`the first course ("${firstCourse.title}") is pre-selected by default (mirrors Dictionary's default-select-first-item precedent)`)
    : bad(`pre-selected course id "${state.firstRowId}", expected the real first course "${firstCourse.id}"`);
  (state.detailH2 || "").indexOf(firstCourse.title) !== -1
    ? ok(`the right pane shows the first course's own title ("${firstCourse.title}") by default`)
    : bad(`right pane heading "${state.detailH2}", expected to contain "${firstCourse.title}"`);

  noise.length === 0 ? ok("no console errors/warnings for the default-selection state") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 3) clicking a non-first, non-active row updates the active course + right pane ================= */
{
  const { page, noise } = await bootTo("#/learn", { width: 1440, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 1
    ? ok(`courseList has ${rowCount} rows (need >1 for a meaningful non-first-row check)`)
    : bad(`courseList only has ${rowCount} row(s) - not enough to test a non-first-row click`);

  if (rowCount > 1) {
    const clickedId = await page.evaluate(() => {
      const row = document.querySelectorAll(".list-detail-list .list-detail-row")[1];
      row.click();
      return row.dataset.courseId;
    });
    await page.waitForTimeout(150);

    const expectedCourse = await page.evaluate((id) => (window.G.store.curriculum().courses || []).find((c) => c.id === id), clickedId);

    const after = await page.evaluate(() => ({
      activeRowCount: document.querySelectorAll(".list-detail-list .list-detail-row.active").length,
      activeRowId: document.querySelector(".list-detail-list .list-detail-row.active")?.dataset.courseId || null,
      detailH2: document.querySelector("#learn-detail-pane h2")?.textContent || null,
      lessonRowCount: document.querySelectorAll("#learn-detail-pane .card.click").length,
      firstLessonTitle: document.querySelector("#learn-detail-pane .card.click h3")?.textContent || null,
    }));

    after.activeRowCount === 1 && after.activeRowId === clickedId
      ? ok(`clicking row 1 ("${expectedCourse.title}") gives that row (and only that row) .active`)
      : bad(`after clicking row 1: active row id = "${after.activeRowId}", active count = ${after.activeRowCount}`);
    (after.detailH2 || "").indexOf(expectedCourse.title) !== -1
      ? ok(`the right pane switched to the clicked course's own title ("${expectedCourse.title}"), not the previous course's`)
      : bad(`right pane heading "${after.detailH2}", expected to contain "${expectedCourse.title}"`);
    after.lessonRowCount === expectedCourse.lessons.length
      ? ok(`the right pane shows exactly ${after.lessonRowCount} lesson row(s), matching the clicked course's real lesson count`)
      : bad(`right pane lesson row count ${after.lessonRowCount}, expected ${expectedCourse.lessons.length}`);
    (after.firstLessonTitle || "").indexOf(expectedCourse.lessons[0].title) !== -1
      ? ok("the right pane's first lesson row matches the clicked course's own first lesson, verbatim")
      : bad(`right pane's first lesson row "${after.firstLessonTitle}", expected to contain "${expectedCourse.lessons[0].title}"`);
  }

  noise.length === 0 ? ok("no console errors/warnings after the row-click selection") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 4) progress badges show correct studied/mastered/total numbers ================= */
{
  const page1 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page1.goto(url, { waitUntil: "load" });
  await page1.waitForTimeout(700);

  // Seed real "curr:"-prefixed progress rows for the first course's first
  // two lessons (one studied-only, one studied+mastered) - the same key
  // format ("curr:" + lessonId -> {studied,mastered}) curriculum.js's own
  // setP() writes, so this exercises the real storage contract, not a
  // synthetic shortcut.
  const seed = await page1.evaluate(async () => {
    const course = (window.G.store.curriculum().courses || [])[0];
    const l0 = course.lessons[0].id;
    const l1 = course.lessons.length > 1 ? course.lessons[1].id : null;
    await window.G.db.put("kv", { k: "guidon:profile:v1", v: { onboardingComplete: true, mode: "guest" } });
    await window.G.db.put("kv", { k: "curr:" + l0, v: { studied: true, mastered: false } });
    if (l1) await window.G.db.put("kv", { k: "curr:" + l1, v: { studied: true, mastered: true } });
    return { courseId: course.id, courseTitle: course.title, studied: l1 ? 2 : 1, mastered: l1 ? 1 : 0, total: course.lessons.length };
  });
  await page1.reload({ waitUntil: "load" });
  await page1.waitForTimeout(900);
  const noise = [];
  page1.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page1.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page1.evaluate(() => { location.hash = "#/learn"; });
  await page1.waitForTimeout(700);

  const expectedText = seed.studied + "/" + seed.total + (seed.mastered ? " · " + seed.mastered + " mastered" : "");
  const badgeText = await page1.evaluate((id) => {
    const row = document.querySelector('.list-detail-row[data-course-id="' + id + '"]');
    return row ? row.querySelector(".ldr-badge")?.textContent : null;
  }, seed.courseId);

  badgeText === expectedText
    ? ok(`"${seed.courseTitle}"'s row badge reads "${badgeText}", matching the seeded progress exactly`)
    : bad(`"${seed.courseTitle}"'s row badge reads "${badgeText}", expected "${expectedText}"`);

  // Independently re-derive EVERY course's expected badge text from the raw
  // "curr:" kv rows (a parallel computation, not a call into the app's own
  // courseProgress()) and compare against every rendered row - the
  // strongest form of the "progress badges show correct numbers" check.
  const mismatch = await page1.evaluate(() => {
    const courses = window.G.store.curriculum().courses || [];
    return window.G.db.all("kv").then((rows) => {
      const map = {};
      rows.forEach((r) => { if (r && typeof r.k === "string" && r.k.indexOf("curr:") === 0) map[r.k.slice(5)] = r.v; });
      const bad = [];
      courses.forEach((c) => {
        let studied = 0, mastered = 0;
        (c.lessons || []).forEach((l) => { const p = map[l.id]; if (p && p.studied) studied++; if (p && p.mastered) mastered++; });
        const expected = studied + "/" + c.lessons.length + (mastered ? " · " + mastered + " mastered" : "");
        const row = document.querySelector('.list-detail-row[data-course-id="' + c.id + '"]');
        const actual = row ? row.querySelector(".ldr-badge")?.textContent : null;
        if (actual !== expected) bad.push({ id: c.id, actual, expected });
      });
      return bad;
    });
  });
  mismatch.length === 0
    ? ok("every course row's progress badge matches an independently-derived studied/mastered/total count")
    : bad("badge mismatches: " + JSON.stringify(mismatch));

  noise.length === 0 ? ok("no console errors/warnings for the seeded-progress state") : bad("console noise: " + noise.join(" | "));
  await page1.close();
}

/* ================= 5) lesson click opens openLesson()'s full reader, untouched (tier-toggle/KC/mastery) ================= */
{
  const { page, noise } = await bootTo("#/learn", { width: 1440, height: 900 });

  // Find a real lesson with a knowledge check, and which course/index it's
  // at, so the check-reveal assertion below is deterministic against real
  // content rather than skipped/best-effort.
  const target = await page.evaluate(() => {
    const courses = window.G.store.curriculum().courses || [];
    for (const c of courses) {
      const lessons = c.lessons || [];
      for (let i = 0; i < lessons.length; i++) {
        if (lessons[i].check && lessons[i].check.q) {
          return { courseId: c.id, courseTitle: c.title, idx: i, lessonTitle: lessons[i].title, q: lessons[i].check.q, a: lessons[i].check.a, tierCount: 4 };
        }
      }
    }
    return null;
  });

  target
    ? ok(`found a real lesson with a knowledge check to test against: "${target.lessonTitle}" (course "${target.courseTitle}")`)
    : bad("no lesson with a knowledge check found in the dataset - cannot run this check");

  if (target) {
    await page.evaluate((id) => {
      document.querySelector('.list-detail-row[data-course-id="' + id + '"]').click();
    }, target.courseId);
    await page.waitForTimeout(150);

    await page.evaluate((idx) => {
      document.querySelectorAll("#learn-detail-pane .card.click")[idx].click();
    }, target.idx);
    await page.waitForTimeout(200);

    const reader = await page.evaluate(() => ({
      h2: document.querySelector(".section-title h2")?.textContent || null,
      segCount: document.querySelectorAll(".segmented button").length,
      hasKc: !!document.querySelector(".kc-label"),
      kcPrompt: document.querySelector(".prompt")?.textContent || null,
      hasReveal: !!document.querySelector(".card button.btn.sm"),
      studiedBtnText: [...document.querySelectorAll(".btn-row button")].find((b) => /studied/i.test(b.textContent))?.textContent || null,
      masterBtnText: [...document.querySelectorAll(".btn-row button")].find((b) => /by the book/i.test(b.textContent))?.textContent || null,
      listDetailGone: !document.querySelector(".list-detail"),
    }));

    reader.h2 === target.lessonTitle
      ? ok(`lesson click opened the full reader with the correct heading ("${reader.h2}")`)
      : bad(`reader heading "${reader.h2}", expected "${target.lessonTitle}"`);
    reader.segCount === target.tierCount
      ? ok(`the tier-toggle segmented control has ${reader.segCount} buttons (one per tier) - openLesson() is intact`)
      : bad(`segmented control has ${reader.segCount} button(s), expected ${target.tierCount}`);
    reader.hasKc && reader.kcPrompt === target.q
      ? ok("the knowledge-check panel shows this exact lesson's own question")
      : bad(`knowledge-check panel present=${reader.hasKc}, prompt="${reader.kcPrompt}", expected "${target.q}"`);
    reader.studiedBtnText
      ? ok(`the mastery "studied" button is present ("${reader.studiedBtnText}")`)
      : bad("the mastery 'studied' button was not found");
    reader.masterBtnText
      ? ok(`the mastery "by the book" button is present ("${reader.masterBtnText}")`)
      : bad("the mastery 'by the book' button was not found");
    reader.listDetailGone
      ? ok("the list-detail split is fully torn down while the lesson reader is open (full mount teardown, unchanged)")
      : bad(".list-detail is still present while the lesson reader is open - openLesson() should have replaced the whole mount");

    if (reader.hasReveal) {
      await page.evaluate(() => { document.querySelector(".card button.btn.sm").click(); });
      await page.waitForTimeout(150);
      const answer = await page.evaluate(() => document.querySelector(".feedback.good")?.textContent || null);
      answer === target.a
        ? ok("revealing the knowledge-check answer shows this exact lesson's own real answer text")
        : bad(`revealed answer "${answer}", expected "${target.a}"`);
    }
  }

  noise.length === 0 ? ok("no console errors/warnings while opening/using the lesson reader") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 6) the reader's "back" button returns to a working, correctly-selected list-detail view ================= */
{
  const { page, noise } = await bootTo("#/learn", { width: 1440, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  if (rowCount > 1) {
    const clickedId = await page.evaluate(() => {
      const row = document.querySelectorAll(".list-detail-list .list-detail-row")[1];
      row.click();
      return row.dataset.courseId;
    });
    await page.waitForTimeout(150);
    const expectedCourse = await page.evaluate((id) => (window.G.store.curriculum().courses || []).find((c) => c.id === id), clickedId);

    await page.evaluate(() => { document.querySelectorAll("#learn-detail-pane .card.click")[0].click(); });
    await page.waitForTimeout(150);

    const backBtnText = await page.evaluate(() => document.querySelector(".btn.ghost.sm.no-print")?.textContent || null);
    backBtnText === "‹ " + expectedCourse.title
      ? ok(`the lesson reader's back button correctly names the selected course ("${backBtnText}")`)
      : bad(`back button text "${backBtnText}", expected "‹ ${expectedCourse.title}"`);

    await page.evaluate(() => { document.querySelector(".btn.ghost.sm.no-print").click(); });
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => ({
      hasListDetail: !!document.querySelector(".list-detail"),
      rowCount: document.querySelectorAll(".list-detail-list .list-detail-row").length,
      activeRowId: document.querySelector(".list-detail-list .list-detail-row.active")?.dataset.courseId || null,
      detailH2: document.querySelector("#learn-detail-pane h2")?.textContent || null,
      lessonRowCount: document.querySelectorAll("#learn-detail-pane .card.click").length,
    }));

    after.hasListDetail && after.rowCount === rowCount
      ? ok(`"back" returned to a working .list-detail view with all ${after.rowCount} course rows intact`)
      : bad(`after "back": .list-detail present=${after.hasListDetail}, row count=${after.rowCount}, expected ${rowCount}`);
    after.activeRowId === clickedId
      ? ok(`"back" left the SAME course ("${expectedCourse.title}") active/highlighted, not reset to the default`)
      : bad(`after "back": active row id = "${after.activeRowId}", expected "${clickedId}"`);
    (after.detailH2 || "").indexOf(expectedCourse.title) !== -1 && after.lessonRowCount === expectedCourse.lessons.length
      ? ok("the right pane shows that same course's full lesson list again after 'back'")
      : bad(`after "back": right pane heading "${after.detailH2}", lesson row count ${after.lessonRowCount}, expected ${expectedCourse.lessons.length} lessons for "${expectedCourse.title}"`);
  } else {
    bad(`courseList only has ${rowCount} row(s) - not enough to test the back-navigation flow`);
  }

  noise.length === 0 ? ok("no console errors/warnings during the back-navigation flow") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 7) rank-tier grouping is preserved (seeded tier E5) ================= */
{
  const { page, noise } = await bootWithTier("E5", { width: 1440, height: 900 });

  const info = await page.evaluate(() => {
    const courses = window.G.store.curriculum().courses || [];
    const classify = (id) => {
      const c = courses.find((x) => x.id === id);
      if (!c) return "unknown";
      if ((c.primaryFor || []).includes("E5")) return "primary";
      if ((c.relevantTiers || []).includes("E5")) return "relevant";
      return "other";
    };
    const items = [...document.querySelectorAll(".list-detail-list > *")].map((node) => {
      if (node.classList.contains("curr-group-label")) return { type: "label", text: node.textContent };
      return { type: "row", group: classify(node.dataset.courseId) };
    });
    return items;
  });

  info.length > 0 ? ok(`courseList has ${info.length} item(s) (rows + dividers) with a rank tier seeded`) : bad("courseList is empty with a rank tier seeded");

  const bannerText = await page.evaluate(() => document.querySelector(".curr-rank-banner .eyebrow")?.textContent || null);
  bannerText === "Filtered for E5"
    ? ok('the rank banner reads "Filtered for E5"')
    : bad(`rank banner text "${bannerText}", expected "Filtered for E5"`);

  info.length > 0 && info[0].type === "label"
    ? ok("the first item in courseList is a group-label divider (a divider always precedes a group's first row)")
    : bad(`first item in courseList is type "${info[0] && info[0].type}", expected "label"`);

  const RANK = { primary: 0, relevant: 1, other: 2 };
  let monotonic = true, lastRank = -1;
  for (const item of info) {
    if (item.type === "label") continue;
    if (RANK[item.group] < lastRank) monotonic = false;
    lastRank = RANK[item.group];
  }
  monotonic
    ? ok("row groups appear in primary -> relevant -> other order (rank-tier grouping preserved)")
    : bad("row groups are NOT in monotonic primary -> relevant -> other order: " + JSON.stringify(info));

  // Every row's real classification matches the group announced by the most
  // recent label above it - i.e. a divider's own text is never a lie about
  // the rows that follow it, up to the next divider.
  let structureOk = true;
  let announced = null;
  for (const item of info) {
    if (item.type === "label") {
      announced = item.text.indexOf("Priority") === 0 ? "primary" : item.text === "Also relevant" ? "relevant" : "other";
    } else if (announced !== item.group) {
      structureOk = false;
    }
  }
  structureOk
    ? ok("every group-label divider's own text matches the classification of every row that follows it, up to the next divider")
    : bad("a group-label divider's text does not match the rows that follow it: " + JSON.stringify(info));

  noise.length === 0 ? ok("no console errors/warnings with a rank tier seeded") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 8) default selection with a tier set: the first PRIMARY course post-sort, not raw courses[0] ================= */
{
  const { page, noise } = await bootWithTier("E5", { width: 1440, height: 900 });

  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
    const first = rows[0];
    return { firstRowActive: first ? first.classList.contains("active") : false, firstRowId: first ? first.dataset.courseId : null };
  });
  const rawFirst = await page.evaluate(() => (window.G.store.curriculum().courses || [])[0]);

  state.firstRowActive
    ? ok("with a tier seeded, the first row in DOM order (post-sort) is still the pre-selected default")
    : bad("with a tier seeded, the first row in DOM order is not active by default");

  // Only a meaningful distinguishing check if sorting actually moved
  // something - i.e. the raw first course isn't already tier-primary.
  const rawFirstIsPrimary = await page.evaluate((id) => {
    const c = (window.G.store.curriculum().courses || []).find((x) => x.id === id);
    return !!(c && (c.primaryFor || []).includes("E5"));
  }, rawFirst.id);
  if (!rawFirstIsPrimary) {
    state.firstRowId !== rawFirst.id
      ? ok("the default selection follows the SORTED list (a primary course), not the raw unsorted courses[0]")
      : bad("the default selection is still the raw unsorted courses[0], sorting was not applied to the default pick");
  } else {
    ok("raw courses[0] happens to already be tier-primary for E5 - sort-vs-raw distinction not testable here, skipped");
  }

  noise.length === 0 ? ok("no console errors/warnings for the tiered default-selection state") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 9) breakpoint: the exact 1023px/1024px boundary ================= */
for (const [width, expect] of [[1023, "block"], [1024, "grid"]]) {
  const { page, noise } = await bootTo("#/learn", { width, height: 900 });
  const display = await page.evaluate(() => {
    const ld = document.querySelector(".list-detail");
    return ld ? getComputedStyle(ld).display : null;
  });
  display === expect
    ? ok(`${width}px: .list-detail display is "${expect}" as documented`)
    : bad(`${width}px: expected display "${expect}", got "${display}"`);
  noise.length === 0 ? ok(`${width}px: no console errors/warnings`) : bad(`${width}px console noise: ` + noise.join(" | "));
  await page.close();
}

/* ================= 10) keyboard nav: ArrowDown/ArrowUp clamp at both ends, skip group-label dividers, Enter activates ================= */
{
  const { page, noise } = await bootTo("#/learn", { width: 1440, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 3
    ? ok(`courseList rendered ${rowCount} rows on load (need >3 for a meaningful row-to-row check)`)
    : bad(`courseList only rendered ${rowCount} rows - not enough to test arrow nav`);

  if (rowCount > 3) {
    const ids = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      rows[0].focus();
      return rows.slice(0, 3).map((r) => r.dataset.courseId);
    });

    await page.keyboard.press("ArrowDown");
    let activeId = await page.evaluate(() => document.activeElement?.dataset.courseId || null);
    activeId === ids[1]
      ? ok("ArrowDown from row 0 moved focus to row 1")
      : bad(`ArrowDown from row 0: expected row 1 id "${ids[1]}", got "${activeId}"`);

    await page.keyboard.press("ArrowDown");
    activeId = await page.evaluate(() => document.activeElement?.dataset.courseId || null);
    activeId === ids[2]
      ? ok("ArrowDown again moved focus to row 2")
      : bad(`ArrowDown from row 1: expected row 2 id "${ids[2]}", got "${activeId}"`);

    await page.keyboard.press("ArrowUp");
    activeId = await page.evaluate(() => document.activeElement?.dataset.courseId || null);
    activeId === ids[1]
      ? ok("ArrowUp from row 2 moved focus back to row 1")
      : bad(`ArrowUp from row 2: expected row 1 id "${ids[1]}", got "${activeId}"`);

    await page.keyboard.press("ArrowUp"); // -> row 0
    await page.keyboard.press("ArrowUp"); // -> should clamp in place (no input above courseList)
    activeId = await page.evaluate(() => document.activeElement?.dataset.courseId || null);
    activeId === ids[0]
      ? ok("ArrowUp from row 0 clamps in place - no filter/search input above courseList to return focus to (matches Board Drill's catList)")
      : bad(`ArrowUp from row 0: expected to stay on row 0 id "${ids[0]}", got "${activeId}"`);

    // Enter on the focused row activates it exactly like a click - a real
    // trusted key press so the browser's own native Enter-on-button
    // activation fires (these are real <button> elements, no explicit
    // Enter/Space handler needed, same as every other .list-detail-row).
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const afterEnter = await page.evaluate(() => ({
      activeRowId: document.querySelector(".list-detail-list .list-detail-row.active")?.dataset.courseId || null,
      detailH2: document.querySelector("#learn-detail-pane h2")?.textContent || null,
    }));
    const row0Title = await page.evaluate((id) => (window.G.store.curriculum().courses || []).find((c) => c.id === id)?.title, ids[0]);
    afterEnter.activeRowId === ids[0] && (afterEnter.detailH2 || "").indexOf(row0Title) !== -1
      ? ok(`Enter on the focused row 0 activated it exactly like a click - both courseList and the right pane updated ("${row0Title}")`)
      : bad(`after Enter on row 0: active row id = "${afterEnter.activeRowId}", detail heading = "${afterEnter.detailH2}"`);
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings during keyboard nav") : bad("console noise: " + relevantNoise.join(" | "));
  await page.close();
}

/* ================= 11) keyboard nav skips group-label dividers at a group boundary ================= */
{
  const { page, noise } = await bootWithTier("E5", { width: 1440, height: 900 });

  const structure = await page.evaluate(() => {
    return [...document.querySelectorAll(".list-detail-list > *")].map((node) =>
      node.classList.contains("curr-group-label")
        ? { type: "label" }
        : { type: "row", id: node.dataset.courseId }
    );
  });
  // Find the first row that is immediately followed by [label, row] - i.e.
  // a real group boundary this focus-order test can walk across.
  let boundaryRowId = null, nextRowId = null;
  for (let i = 0; i < structure.length - 2; i++) {
    if (structure[i].type === "row" && structure[i + 1].type === "label" && structure[i + 2].type === "row") {
      boundaryRowId = structure[i].id;
      nextRowId = structure[i + 2].id;
      break;
    }
  }

  if (boundaryRowId) {
    ok(`found a real group boundary to test: row "${boundaryRowId}" is followed by a divider, then row "${nextRowId}"`);
    await page.evaluate((id) => {
      document.querySelector('.list-detail-row[data-course-id="' + id + '"]').focus();
    }, boundaryRowId);
    await page.keyboard.press("ArrowDown");
    const landedId = await page.evaluate(() => document.activeElement?.dataset.courseId || null);
    landedId === nextRowId
      ? ok("ArrowDown across a group boundary skipped the divider and landed on the next real row")
      : bad(`ArrowDown across a group boundary landed on "${landedId}", expected the next row "${nextRowId}" (divider was not skipped)`);

    // and the reverse direction
    await page.evaluate((id) => {
      document.querySelector('.list-detail-row[data-course-id="' + id + '"]').focus();
    }, nextRowId);
    await page.keyboard.press("ArrowUp");
    const landedBackId = await page.evaluate(() => document.activeElement?.dataset.courseId || null);
    landedBackId === boundaryRowId
      ? ok("ArrowUp back across the same group boundary also skipped the divider correctly")
      : bad(`ArrowUp across a group boundary landed on "${landedBackId}", expected "${boundaryRowId}"`);
  } else {
    ok("no group boundary with >=1 row on each side found in the current dataset for tier E5 - divider-skip check not applicable, skipped");
  }

  noise.length === 0 ? ok("no console errors/warnings during the group-boundary keyboard nav check") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

console.log(fails === 0 ? "\nLEARN COURSE SPLIT: all passed" : `\nLEARN COURSE SPLIT: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
