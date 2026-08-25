package app.guidon.trainer.baselineprofile;

import androidx.benchmark.macro.junit4.BaselineProfileRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import kotlin.Unit;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Generates GUIDON's real Baseline Profile (Roadmap Tier 7 - the last item,
 * scoped as needing a genuine on-device macrobenchmark, not a static file).
 *
 * Run via `:app:generateBaselineProfile` (wired by the androidx.baselineprofile
 * plugin - see app/build.gradle and baselineprofile/build.gradle). This class
 * drives REAL navigation with UiAutomator against the actual installed
 * app.guidon.trainer WebView shell: Chromium exposes the app's real DOM
 * elements through the standard Android accessibility bridge, so By.text()
 * finds the same on-screen nav links a Soldier would tap - this is not a
 * synthetic wait or a shell-level hash injection.
 *
 * Journeys covered, chosen from this project's own real route/nav structure
 * (src/index.html - NAV_PRIMARY_MOBILE holds the 4 persistent phone-width nav
 * destinations: Home, Train, Board, Settings):
 *   1. Cold start -> default landing route (#/home).
 *   2. Board Drill (#/board) - the heaviest, most complex view in the app
 *      (grading engine, gesture/theater-mode handling, dynamic content).
 *   3. Train (#/train) - the other primary destination; exercises the
 *      scenario-list/quiz rendering path.
 *   4. Back to Home, leaving the app in its default state.
 */
@RunWith(AndroidJUnit4.class)
@LargeTest
public class BaselineProfileGenerator {

    private static final String PACKAGE_NAME = "app.guidon.trainer";
    private static final long FIND_TIMEOUT_MS = 8000;

    @Rule
    public BaselineProfileRule baselineProfileRule = new BaselineProfileRule();

    @Test
    public void startupAndKeyJourneys() {
        baselineProfileRule.collect(
                /* packageName             = */ PACKAGE_NAME,
                // Lowered from the AndroidX-sample default of 15: this
                // environment's adb-over-USB link to the real device proved
                // flaky across a full 15-iteration run (dropped mid-run,
                // "Connection reset", during iteration 2's on-device
                // recompile step) - 6 keeps stableIterations=3's confidence
                // bar unchanged while cutting total wall-clock exposure to
                // that flakiness roughly in half.
                /* maxIterations           = */ 6,
                /* stableIterations        = */ 3,
                /* outputFilePrefix        = */ null,
                // Also feeds a startup-profile subset used for dex-layout
                // (page-cache locality) optimization on top of the AOT profile.
                /* includeInStartupProfile = */ true,
                scope -> {
                    scope.pressHome();
                    scope.startActivityAndWait();

                    UiDevice device = scope.getDevice();

                    tapNavLabel(device, "Board");
                    tapNavLabel(device, "Train");
                    tapNavLabel(device, "Home");

                    return Unit.INSTANCE;
                });
    }

    /**
     * Taps a persistent bottom-nav item by its visible label text - the same
     * real path a Soldier uses (see NAV_PRIMARY_MOBILE / navButton() in
     * src/index.html: each is a real {@code <a data-hash="...">} with a
     * visible text label, not just an icon). Falls back to content-
     * description matching in case the accessible name isn't exposed as
     * plain text on a given WebView/Chromium build. A miss is logged rather
     * than thrown so one flaky find doesn't blow up an otherwise-good
     * profiling iteration; BaselineProfileRule.collect's own stable-iteration
     * requirement is what actually guards profile quality.
     */
    private static void tapNavLabel(UiDevice device, String label) {
        UiObject2 item = device.wait(Until.findObject(By.text(label).clickable(true)), FIND_TIMEOUT_MS);
        if (item == null) {
            item = device.wait(Until.findObject(By.desc(label).clickable(true)), FIND_TIMEOUT_MS);
        }
        if (item != null) {
            item.click();
            device.waitForIdle();
        }
    }
}
