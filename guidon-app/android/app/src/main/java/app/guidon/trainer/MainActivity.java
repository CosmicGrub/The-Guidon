package app.guidon.trainer;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.view.WindowCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
  // Roadmap audit round 5, "Native Android: Security & Shortcut Wiring"
  // bucket: the "route" extra a home-screen shortcut tap carries (see
  // res/xml/shortcuts.xml's own header comment — Board Drill/Progress/
  // NCOPDS Drills, e.g. "#/board") until it can actually be pushed into the
  // WebView. That can't happen the instant the Intent arrives — on a cold
  // launch (app not already running) index.html has not necessarily
  // finished loading/running its own boot script yet — so this just holds
  // the value; pollAndNavigate() below is what actually consumes it once
  // the real page is confirmed loaded. Cleared the moment it's consumed so
  // an unrelated later recreate()/resume can never replay a stale nav.
  private String pendingRoute;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    // Capacitor core's SystemBars plugin already computes real safe-area
    // insets (viewport-fit=cover is set in src/index.html) and injects
    // env(safe-area-inset-*) on every change - that machinery just never
    // gets asked to draw content edge-to-edge on API 31-34, because nothing
    // in the dependency tree calls this. Without it those OS versions keep
    // the WebView padded to stop at the system-bar boundary by default,
    // leaving a strip of otherwise-usable status/nav-bar real estate
    // un-utilized. Android 15+ (API 35) makes edge-to-edge mandatory at the
    // OS level regardless, which is why this had gone unnoticed. Called
    // before super.onCreate() so the window is already in edge-to-edge mode
    // before Capacitor's bridge (and SystemBars' inset observer) starts up.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    super.onCreate(savedInstanceState);

    // Capacitor's default Android WebView shell implements no
    // WebChromeClient.onCreateWindow(), and WebSettings.setSupportMultipleWindows()
    // defaults to false - between the two, any `<a target="_blank">` tap or
    // `window.open(url, ...)` call is a confirmed silent no-op on real
    // hardware: no browser opens, no share sheet, no error, mCurrentFocus
    // stays on this Activity (verified via adb on a Tab S9 FE). Two of this
    // app's real links hit this exact gap: the Veterans & Military Crisis
    // Line chat link (resources.js's crisis banner) and every external URL
    // in the Support Resources list - a Soldier in crisis tapping the
    // former and having nothing happen is a real harm scenario, not a
    // cosmetic one.
    //
    // Fix (the standard Capacitor/Android pattern for this exact gap):
    // enable multi-window support, then hand new-window requests to a
    // throwaway, never-attached WebView whose sole job is to catch the
    // target URL via shouldOverrideUrlLoading and forward it to a real
    // external Activity via ACTION_VIEW - the same thing a browser's own
    // "open in new tab" ultimately does. http/https ACTION_VIEW is one of
    // Android's automatically-visible implicit intents (package-visibility
    // filtering, API 30+, exempts it), so no <queries> manifest entry is
    // needed.
    //
    // Subclassing BridgeWebChromeClient below (not replacing it outright
    // with a bare WebChromeClient) matters: Capacitor's own subclass is
    // what drives the JS file picker (<input type=file>), native alert/
    // confirm/prompt dialogs, camera/mic permission prompts, and WebView
    // console logging - swapping in a plain WebChromeClient would silently
    // drop all of that just to add this one method.
    //
    // Confirmed via a temporary Log.i() in onCreateWindow (real device,
    // real tap, removed before this shipped) that this method is the one
    // actually firing - not assumed from the outcome alone. Worth noting
    // for whoever next touches this: on this same device/WebView build,
    // BridgeWebViewClient.shouldOverrideUrlLoading() -> Bridge.launchIntent()
    // was independently observed opening these same links via ACTION_VIEW
    // even with this method absent, because a target=_blank tap that finds
    // no multi-window support can fall back to a top-level navigation on
    // the same WebView, which Capacitor's own out-of-origin check then
    // catches. That fallback is real but is Chromium-version behavior, not
    // a documented contract - it does not explain the originally-reported
    // silent no-op (adb-confirmed on this exact hardware), and this method
    // is the deterministic, standards-documented fix that does not depend
    // on it. Kept for that reason on a link where "usually works" is not
    // good enough.
    WebView webView = getBridge().getWebView();
    webView.getSettings().setSupportMultipleWindows(true);
    webView.setWebChromeClient(new ExternalLinkWebChromeClient(getBridge()));

    // Roadmap audit round 5, "Native Android: Security & Shortcut Wiring"
    // bucket: G.biometricGate (src/index.html) protects a Soldier's
    // "Personal Account" behind a biometric prompt, but re-arms only on the
    // NEXT resume — nothing ran at the moment the app was BACKGROUNDED, and
    // Android's task switcher takes a live bitmap snapshot of the window's
    // current content the instant it backgrounds, before any biometric
    // overlay exists for that session. Grepping the whole native tree for
    // FLAG_SECURE turned up zero hits: a Soldier with biometric lock on who
    // is sitting on a sensitive screen and hits Home/Recents got a
    // full-resolution OS-level screenshot of that exact screen sitting in
    // the app-switcher thumbnail, fully bypassing the lock.
    //
    // Fix: expose a tiny custom JS bridge (a plain WebView
    // addJavascriptInterface — this is one boolean toggle, not a real
    // platform surface, so a full Capacitor plugin registration is more
    // machinery than this needs) that flips WindowManager.LayoutParams.
    // FLAG_SECURE on this Activity's own window. FLAG_SECURE blanks both
    // screenshots and the recents-thumbnail for the whole window. JS side
    // (src/biometric.js's setSecureScreen(), called from
    // G.biometricGate.run()/syncSecureScreen() in index.html) owns the
    // actual "does the lock apply right now" policy — biometricLock setting
    // AND current profile is a completed Personal Account — and pushes
    // that yes/no here every time it might have changed, not just while
    // the lock overlay itself is showing, since the sensitive content is
    // on screen for the entire foregrounded session, not only while locked.
    webView.addJavascriptInterface(new NativeSecurityBridge(), "AndroidSecureScreen");

    // Roadmap audit round 5, "Native Android: Security & Shortcut Wiring"
    // bucket: shortcuts.xml declares 3 home-screen shortcuts (Board Drill,
    // Progress, NCOPDS Drills), each carrying a "route" intent extra naming
    // the in-app hash the equivalent PWA shortcut already jumps straight to
    // - but until now nothing here ever read it, so a long-press shortcut
    // tap opened GUIDON's default/last route like a plain icon tap instead
    // of the named screen. This is the cold-launch half of the fix;
    // onNewIntent() below is the other half (singleTask launchMode means a
    // shortcut tap while already running never reaches onCreate() at all).
    captureRouteExtra(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    // android:launchMode="singleTask" on this Activity (AndroidManifest.xml)
    // means a shortcut tap while GUIDON is already running delivers the new
    // Intent here instead of a fresh onCreate() - confirmed by reading the
    // manifest, which is exactly why shortcut taps kept landing on whatever
    // route was already on screen instead of the shortcut's own
    // destination. super.onNewIntent() runs first because BridgeActivity's
    // own override forwards this Intent into Capacitor's Bridge (the App
    // plugin's appUrlOpen/appRestoredResult listeners depend on that
    // happening) - skipping it to add our own handling first would silently
    // break that.
    super.onNewIntent(intent);
    setIntent(intent);
    captureRouteExtra(intent);
  }

  // Reads (and consumes) the shortcut's "route" extra, if this Intent
  // carries one, and kicks off pollAndNavigate() to push it into the
  // WebView as soon as the page is actually ready for it.
  private void captureRouteExtra(Intent intent) {
    if (intent == null) return;
    String route = intent.getStringExtra("route");
    if (route == null || route.isEmpty()) return;
    // Consume once - a MAIN/LAUNCHER Intent like this can get redelivered
    // to onCreate() by things unrelated to the Soldier tapping the
    // shortcut again (e.g. a process-death restore replaying the last
    // Intent), and this extra must not re-fire a navigation nobody asked
    // for a second time.
    intent.removeExtra("route");
    pendingRoute = route;
    pollAndNavigate(40); // ~4s ceiling at 100ms/attempt - see this method's own comment
  }

  // index.html is one big inline script; on a cold launch (shortcut tapped
  // with GUIDON not already running) it has not necessarily finished
  // loading/running yet the instant captureRouteExtra() above runs, and
  // Capacitor's own WebViewClient/local-server plumbing is not something
  // this fix touches or assumes the internals of. Rather than guess a fixed
  // delay, this polls the WebView's own document.readyState/location -
  // both meaningless on the transient about:blank Capacitor starts every
  // load from, both real once the bundled index.html has actually loaded -
  // and only commits location.hash once that's confirmed. Bounded so a
  // WebView that somehow never finishes loading can't retry forever.
  private void pollAndNavigate(final int attemptsLeft) {
    if (pendingRoute == null) return;
    Bridge bridge = getBridge();
    final WebView webView = bridge != null ? bridge.getWebView() : null;
    if (webView == null) return;
    webView.evaluateJavascript(
        "(document.readyState === 'complete' && location.href.indexOf('about:blank') === -1)",
        (result) -> {
          if (pendingRoute == null) return; // a later intent already consumed it
          if ("true".equals(result)) {
            final String route = pendingRoute;
            pendingRoute = null;
            // Minimal escaping for embedding inside a single-quoted JS
            // string literal - every route this ships with is a fixed
            // "#/xyz" hash from shortcuts.xml, never Soldier-entered text,
            // but this stays correct even so.
            String safe = route.replace("\\", "\\\\").replace("'", "\\'");
            webView.evaluateJavascript("location.hash='" + safe + "';", null);
          } else if (attemptsLeft > 0) {
            webView.postDelayed(() -> pollAndNavigate(attemptsLeft - 1), 100);
          }
        });
  }

  // Roadmap audit round 5, "Native Android: Security & Shortcut Wiring"
  // bucket: minimal JS-callable bridge for the FLAG_SECURE toggle described
  // on the addJavascriptInterface() call site above. Non-static so it can
  // reach this Activity's getWindow()/runOnUiThread() directly, same as
  // NativeSecurityBridge's sibling inner classes in this file.
  private class NativeSecurityBridge {
    @JavascriptInterface
    public void setSecure(final boolean secure) {
      // addJavascriptInterface() callbacks land on a WebCore thread, not
      // the UI thread - touching this Activity's window from there is
      // undefined at best, so every call is hopped back over.
      runOnUiThread(() -> {
        if (secure) {
          getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
          getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
      });
    }
  }

  private static class ExternalLinkWebChromeClient extends BridgeWebChromeClient {
    ExternalLinkWebChromeClient(Bridge bridge) {
      super(bridge);
    }

    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
      final Context context = view.getContext();
      WebView popup = new WebView(context);
      WebSettings settings = popup.getSettings();
      settings.setJavaScriptEnabled(true);
      popup.setWebViewClient(new WebViewClient() {
        @Override
        public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
          Uri uri = request.getUrl();
          String scheme = uri.getScheme();
          // Only genuine external navigation (http/https) gets handed off.
          // The app's own two `window.open("", "_blank")` popups (the
          // board-readiness print summary and the self-test's clipboard-
          // copy fallback, both in src/index.html) never navigate anywhere
          // - they document.write generated HTML straight into this popup
          // - so they never reach this branch and are unaffected by this
          // fix either way.
          if ("http".equals(scheme) || "https".equals(scheme)) {
            try {
              context.startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
              // No app on this device can open it - nothing else to do,
              // matching this app's existing pattern of swallowing
              // failures around best-effort platform calls (see the
              // print/report window.open() call sites in src/index.html).
            }
            // Defer past this callback's own return - destroying the
            // WebView that is mid-dispatch of this exact callback is the
            // one thing to avoid here.
            popupView.post(popupView::destroy);
            return true;
          }
          return false;
        }
      });
      WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
      transport.setWebView(popup);
      resultMsg.sendToTarget();
      return true;
    }
  }
}
