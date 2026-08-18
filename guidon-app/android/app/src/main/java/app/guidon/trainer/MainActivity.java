package app.guidon.trainer;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

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
  }
}
