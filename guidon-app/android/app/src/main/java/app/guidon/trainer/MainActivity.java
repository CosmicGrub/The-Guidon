package app.guidon.trainer;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.view.WindowCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
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
