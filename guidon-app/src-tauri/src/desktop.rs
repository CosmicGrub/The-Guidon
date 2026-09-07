//! Desktop shell integration, R2-R8 (desktop roadmap, review-corrected
//! 2026-09-03/05). Every one of these lives in exactly ONE place (rule 4);
//! this module is that place for all seven, plus S6's native-theme command.
//!
//! * R2 show-when-painted: `window_state_flags()` is the ONE state-flags
//!   value the window-state plugin builds with (main.rs), deliberately
//!   excluding VISIBLE and MAXIMIZED. tao 0.35's own maximize restore calls
//!   SW_MAXIMIZE, which paints the window before the page has rendered
//!   anything - measured on the pre-R2 exe: the smoke's first-visible frame
//!   was 99.998% one flat colour (`#e8dfc9`, the config's own
//!   `backgroundColor`), and GetWindowRect jumped from the centred size to
//!   the maximized one between the first-visible sample and +1000 ms. With
//!   `"visible": false` in tauri.conf.json and MAXIMIZED excluded here, the
//!   window-state plugin's automatic `on_window_ready` restore neither
//!   shows nor maximizes it; `reveal()` below re-applies the saved maximize
//!   state and shows the window itself, once, after the page's first
//!   `Finished` page-load event (or a 3 s fallback if that never fires -
//!   `should_reveal()` makes whichever wins a no-op for the other).
//! * R3 selective accelerator guard: `is_blocked_accelerator()` is the ONE
//!   allow-list (F5, Ctrl+R, F3, Ctrl+P) and `install_accelerator_guard()`
//!   is the ONE place it is wired to WebView2, through
//!   `ICoreWebView2Controller::add_AcceleratorKeyPressed` (webview2-com) -
//!   deliberately NOT `AreBrowserAcceleratorKeysEnabled(false)`, which also
//!   swallows Ctrl+=/Ctrl+-/Ctrl+0 and would make R4 a dead setting.
//!   `GUIDON_ACCEL=off` skips installing the handler for debugging without
//!   a release build (rule: keep it in debug too, gate on the env var).
//!   `NavLoadState`/`nav_load_count` (GAP B, verify pass 2026-09-05) count
//!   every real page-navigation `Finished` event from inside the on_page_load
//!   hook R2 already installs, so an outside probe (WebView2 remote
//!   debugging - see `tools/nav-probe.mjs`) can tell whether F5 actually
//!   reloaded the page - a pixel diff alone cannot, on an app whose reload
//!   looks pixel-identical to no reload at all.
//! * R4 zoom: `"zoomHotkeysEnabled": true` in tauri.conf.json's window
//!   entry (Windows only - the desktop plan is explicit this flag must
//!   never be set on macOS). No code needed here; `WebviewWindowBuilder::
//!   from_config` reads it. A View menu to drive `Webview::set_zoom` is R10
//!   (Phase 5), not built yet.
//! * R6/R7 route argv + title sync: `route_from_argv()` is the ONE regex
//!   (`^[a-z0-9/-]+$`) that decides whether a `--route=<x>` argument is
//!   trusted enough to become `location.hash`. First launch gets it as an
//!   initialization script (runs at document-start, before the page's own
//!   `if (!location.hash) ...` default - src/index.html); a second launch
//!   handed to the running instance by the single-instance plugin gets it
//!   via `WebviewWindow::eval` after the window is raised. Either way the
//!   page's own hashchange router then calls `document.title = "GUIDON -
//!   <label>"` per route (desktop Session 2), and `on_document_title_changed`
//!   (wired in main.rs) is what carries that into the native title bar - R7
//!   is this one callback, nothing else.
//! * R8 native theme + S6: `set_native_theme` is the app command
//!   S6's native.js Tauri branch invokes on every theme change
//!   (mirroring the Capacitor `watchTheme()`/`applySystemBars()` pair in
//!   the same file). It sets both `Window::set_theme` (titlebar) and
//!   `Window::set_background_color` (the colour WebView2 paints during its
//!   own resize-lag gap, which otherwise stays the config's light
//!   `backgroundColor` under a dark theme). There is no getter for either
//!   once set, so `NativeThemeState` remembers the last call for the
//!   selftest report to read (`selftest::selftest_report` merges it in) -
//!   the ONE place that state lives, since the command that sets it is the
//!   only thing that can know it. No capability file: this is an app
//!   command from the bundled origin (rule 8). (GAP C, verify pass
//!   2026-09-05): `NativeThemeState` holds `theme` and `background_applied`
//!   as two independent slots, each written at its own native call's exact
//!   call site, so a regression that drops one call is visible in the
//!   merged report as that field staying at its default rather than being
//!   inferred from the other.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, Runtime, Theme, WebviewWindow};
use tauri_plugin_window_state::{StateFlags, WindowExt};

/* --------------------------------------------------------------------- R2 */

/// How long `reveal()` waits for the page's own `Finished` page-load event
/// before showing the window anyway. Measured cold time-to-window is well
/// under this (the RED baseline: 100-103 ms warm, ~750 ms cold per the
/// smoke script's own header), so 3 s only fires on a genuinely stuck page.
pub const FALLBACK_TIMEOUT: Duration = Duration::from_secs(3);

/// The ONE state-flags value the window-state plugin restores/saves with.
/// Built as a whitelist (rather than `all() - X`) so the excluded flags
/// can't silently reappear if `StateFlags` grows a variant: SIZE, POSITION,
/// DECORATIONS and FULLSCREEN are restored automatically on
/// `on_window_ready`; VISIBLE and MAXIMIZED are deliberately absent (R2)
/// and `reveal()` applies MAXIMIZED itself, after paint.
pub fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::DECORATIONS | StateFlags::FULLSCREEN
}

/// True the first time it is called on a given `AtomicBool`, false every
/// time after - the guard that lets the page-load event and the fallback
/// timer race without double-showing the window. Pure, so it is unit
/// tested directly; the window calls it guards are not (no window exists
/// in a unit test) - that half is the smoke script's job (rule 5/6).
pub fn should_reveal(already_shown: &AtomicBool) -> bool {
    !already_shown.swap(true, Ordering::SeqCst)
}

/// Re-applies the saved maximize state (skipped by `window_state_flags()`)
/// and shows the window - but only the first time this or the fallback
/// timer calls it for a given launch.
pub fn reveal<R: Runtime>(window: &WebviewWindow<R>, shown: &AtomicBool) {
    if !should_reveal(shown) {
        return;
    }
    let _ = window.restore_state(StateFlags::MAXIMIZED);
    let _ = window.show();
    let _ = window.set_focus();
}

/// Wires both paths that call `reveal()`: the page's first `Finished`
/// page-load event, and a `FALLBACK_TIMEOUT` timer started right away.
/// Must run BEFORE `.build()` (`on_page_load` is a builder method).
///
/// Also increments [`NavLoadState`] (GAP B) on every `Finished` event, not
/// just the first - this is the SAME event `WebviewWindowBuilder` only
/// lets one handler observe, so the R3 reload counter piggybacks on this
/// one rather than installing a second `on_page_load` (which would replace
/// this one, not add to it). `try_state` is used because a caller that
/// forgets to `.manage(NavLoadState::default())` before building the
/// window must not panic on every page load - it simply never counts.
pub fn arm_reveal<'a, M, R>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> (tauri::WebviewWindowBuilder<'a, R, M>, Arc<AtomicBool>)
where
    R: Runtime,
    M: tauri::Manager<R>,
{
    let shown = Arc::new(AtomicBool::new(false));
    let shown_for_load = shown.clone();
    let builder = builder.on_page_load(move |wv, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Finished {
            if let Some(nav) = wv.try_state::<NavLoadState>() {
                nav.0.fetch_add(1, Ordering::SeqCst);
            }
            reveal(&wv, &shown_for_load);
        }
    });
    (builder, shown)
}

/// Starts the fallback timer thread. Called once, right after `.build()`,
/// with the same `shown` flag `arm_reveal()` handed back.
pub fn spawn_reveal_fallback<R: Runtime>(window: WebviewWindow<R>, shown: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        std::thread::sleep(FALLBACK_TIMEOUT);
        reveal(&window, &shown);
    });
}

/* --------------------------------------------------------------------- R6 */

/// `--route=<this>` must match this before it becomes `location.hash`.
/// Lowercase ascii, digits, `/` and `-` only - the same character class the
/// page's own routes use (`#/board`, `#/progress`, `#/pme/blc`, ...).
pub fn is_valid_route(route: &str) -> bool {
    !route.is_empty() && route.bytes().all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-'))
}

pub const ROUTE_ARG_PREFIX: &str = "--route=";

/// Finds the first `--route=<x>` in argv whose `<x>` passes
/// `is_valid_route`; anything else (missing, malformed, a second one) is
/// ignored rather than reaching the page as untrusted JS text.
pub fn route_from_argv<S: AsRef<str>>(argv: &[S]) -> Option<String> {
    argv.iter()
        .find_map(|a| a.as_ref().strip_prefix(ROUTE_ARG_PREFIX))
        .filter(|r| is_valid_route(r))
        .map(|r| r.to_string())
}

/// The JS both the first-launch initialization script and the second-launch
/// `eval` run. `serde_json::to_string` on a str that already passed
/// `is_valid_route` is a plain quoted-ascii string literal - no escaping
/// hazard - but going through it anyway keeps this the ONE place that does
/// the quoting, rather than hand-building a literal twice.
pub fn route_hash_js(route: &str) -> String {
    let hash = format!("#/{route}");
    format!(
        "try{{location.hash={};}}catch(e){{}}",
        serde_json::to_string(&hash).unwrap_or_else(|_| "\"\"".into())
    )
}

/* --------------------------------------------------------------------- R3 */

/// `GUIDON_ACCEL=off` skips installing the accelerator guard, for debugging
/// keyboard behaviour without a release build.
pub const ACCEL_OFF_ENV: &str = "GUIDON_ACCEL";
pub const ACCEL_OFF_VALUE: &str = "off";

const VK_F5: u32 = 0x74;
const VK_F3: u32 = 0x72;
const VK_R: u32 = 0x52;
const VK_P: u32 = 0x50;

/// The ONE allow-list: exactly the (virtual-key, ctrl-held) pairs this
/// shell marks handled so WebView2 never runs its own default action for
/// them. F5/Ctrl+R (reload) and F3 (find-next, there is no find bar to
/// advance) have no button in this UI; Ctrl+P (print) has no printable
/// surface GUIDON offers. Everything else - Ctrl+F, DevTools, browser
/// back/forward, and Ctrl+=/Ctrl+-/Ctrl+0 (R4) - must keep working, which
/// is exactly what `AreBrowserAcceleratorKeysEnabled(false)` cannot do (it
/// blocks all of those too).
pub fn is_blocked_accelerator(virtual_key: u32, ctrl: bool) -> bool {
    match virtual_key {
        VK_F5 | VK_F3 => true,
        VK_R | VK_P => ctrl,
        _ => false,
    }
}

#[cfg(windows)]
mod user32 {
    #[link(name = "user32")]
    extern "system" {
        pub fn GetKeyState(virtual_key: i32) -> i16;
    }
    pub const VK_CONTROL: i32 = 0x11;
}

#[cfg(windows)]
fn ctrl_is_down() -> bool {
    // High bit set means "currently pressed" (the same test the WebView2
    // samples use); a signed i16 with the high bit set is negative.
    unsafe { user32::GetKeyState(user32::VK_CONTROL) < 0 }
}

/// Installs the accelerator handler on this window's WebView2 controller.
/// A no-op with `GUIDON_ACCEL=off` set, and (by `#[cfg(windows)]`) on any
/// other platform - there is no WebView2 controller to install it on.
#[cfg(windows)]
pub fn install_accelerator_guard<R: Runtime>(window: &WebviewWindow<R>) {
    if std::env::var(ACCEL_OFF_ENV).ok().as_deref() == Some(ACCEL_OFF_VALUE) {
        return;
    }
    let _ = window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
            ICoreWebView2AcceleratorKeyPressedEventArgs,
        };
        let controller = webview.controller();
        let handler = webview2_com::AcceleratorKeyPressedEventHandler::create(Box::new(
            move |_sender, args: Option<ICoreWebView2AcceleratorKeyPressedEventArgs>| {
                if let Some(args) = args {
                    let mut vk: u32 = 0;
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                    unsafe {
                        let _ = args.VirtualKey(&mut vk);
                        let _ = args.KeyEventKind(&mut kind);
                    }
                    let is_key_down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
                    if is_key_down && is_blocked_accelerator(vk, ctrl_is_down()) {
                        unsafe {
                            let _ = args.SetHandled(true);
                        }
                    }
                }
                Ok(())
            },
        ));
        let mut token: i64 = 0;
        unsafe {
            let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
        }
    });
}

/* ------------------------------------------------------ R3 gap B: nav probe */

/// Counts every `PageLoadEvent::Finished` this window's webview reports -
/// the SAME event `arm_reveal()` already listens for (R2), but with no
/// once-only gate (unlike [`should_reveal`]): a genuine reload is exactly
/// the event this exists to detect, so every one of them must count, not
/// just the first.
///
/// Why this exists (verify pass 2026-09-05, GAP B): the smoke script's
/// `R3.f5_no_reload` assertion is a pixel diff of the client area after
/// sending F5. Mutating `is_blocked_accelerator` to stop blocking F5 left
/// that assertion GREEN anyway - this app is a fast, locally-cached,
/// mostly-static SPA, so a real reload produces no visible pixel
/// difference within the sampling window. This counter is read from
/// outside the process (over WebView2 remote debugging - see
/// `tools/nav-probe.mjs`) before and after the same F5 keystroke; it
/// survives a real reload unlike anything read from the page's OWN JS
/// state (which a reload would reset to its initial value, indistinguishable
/// from "nothing happened"), because it lives in the Rust process the
/// webview navigates INSIDE of, not in the page.
#[derive(Default)]
pub struct NavLoadState(pub AtomicU64);

/// Always registered (like `selftest_report`); harmless to call outside a
/// test - it only ever reports a count, never changes anything. No
/// capability file: an app command from the bundled origin (rule 8).
#[tauri::command]
pub fn nav_load_count(state: tauri::State<'_, NavLoadState>) -> u64 {
    state.0.load(Ordering::SeqCst)
}

/* --------------------------------------------------------------------- R8 */

/// The last theme S6's native.js told this window to apply, split into TWO
/// independently-settable slots - one per native call `set_native_theme`
/// makes - rather than one combined record. There is no getter for either
/// once set, so this state is the only record of both;
/// `selftest::selftest_report` reads both through it to put `nativeTheme`
/// and `nativeThemeBackgroundApplied` in the merged report.
///
/// Why split (verify pass 2026-09-05, GAP C): before this, `ground` lived
/// only inside the one combined `NativeTheme`, written AFTER both native
/// calls in `set_native_theme` returned - but `ground` is the JS-supplied
/// argument, not a readback of what `set_background_color` actually did.
/// Commenting out ONLY that call left `set_theme` succeeding and `ground`
/// still reaching the merged report unchanged, so a silently-dropped
/// background-colour fix was invisible. `background_applied` below is set
/// in the SAME expression as the `set_background_color` call itself (see
/// `set_native_theme`), so skipping that call leaves it at its default
/// (`None`) no matter what `theme` shows.
#[derive(Default)]
pub struct NativeThemeState {
    pub theme: Mutex<Option<NativeTheme>>,
    pub background_applied: Mutex<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTheme {
    pub dark: bool,
    pub ground: String,
}

/// S6/R8: applies the native titlebar theme and the WebView2 resize-lag
/// background colour together, and remembers each call - independently,
/// at its own call site - for the selftest report. `ground` is a CSS
/// colour string (`#rrggbb[aa]` or `#rgb`); anything else is rejected
/// rather than silently ignored.
#[tauri::command]
pub fn set_native_theme<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, NativeThemeState>,
    dark: bool,
    ground: String,
) -> Result<(), String> {
    let color: tauri::window::Color = ground
        .parse()
        .map_err(|e| format!("set_native_theme: bad ground color {ground:?}: {e}"))?;
    window
        .set_theme(Some(if dark { Theme::Dark } else { Theme::Light }))
        .map_err(|e| format!("set_native_theme: set_theme: {e}"))?;
    window
        .set_background_color(Some(color))
        .map(|_| {
            *state
                .background_applied
                .lock()
                .unwrap_or_else(|p| p.into_inner()) = Some(ground.clone());
        })
        .map_err(|e| format!("set_native_theme: set_background_color: {e}"))?;
    *state.theme.lock().unwrap_or_else(|p| p.into_inner()) = Some(NativeTheme { dark, ground });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_flags_excludes_visible_and_maximized_only() {
        let f = window_state_flags();
        assert!(!f.contains(StateFlags::VISIBLE), "VISIBLE must stay out (R2)");
        assert!(!f.contains(StateFlags::MAXIMIZED), "MAXIMIZED must stay out (R2)");
        assert!(f.contains(StateFlags::SIZE));
        assert!(f.contains(StateFlags::POSITION));
        assert!(f.contains(StateFlags::DECORATIONS));
        assert!(f.contains(StateFlags::FULLSCREEN));
    }

    #[test]
    fn should_reveal_is_true_exactly_once() {
        let shown = AtomicBool::new(false);
        assert!(should_reveal(&shown), "the first caller must win");
        assert!(!should_reveal(&shown), "a second caller must be a no-op");
        assert!(!should_reveal(&shown), "and a third");
    }

    #[test]
    fn route_regex_accepts_the_app_s_own_route_shapes() {
        for r in ["board", "progress", "home", "pme/blc", "career"] {
            assert!(is_valid_route(r), "{r:?} must be a valid route");
        }
    }

    #[test]
    fn route_regex_rejects_anything_outside_lowercase_digits_slash_dash() {
        for r in ["", "Board", "board;alert(1)", "board\"", "board.js", "../etc", "board ", " board", "board\n", "b\u{f6}ard"] {
            assert!(!is_valid_route(r), "{r:?} must be rejected");
        }
    }

    #[test]
    fn route_from_argv_finds_the_first_valid_route_flag_and_ignores_the_rest() {
        assert_eq!(route_from_argv(&["guidon.exe", "--route=board"]), Some("board".into()));
        assert_eq!(route_from_argv(&["guidon.exe"]), None, "no flag at all");
        assert_eq!(route_from_argv(&["guidon.exe", "--route="]), None, "empty route");
        assert_eq!(route_from_argv(&["guidon.exe", "--route=<bad>"]), None, "invalid route");
        assert_eq!(
            route_from_argv(&["guidon.exe", "--route=progress", "--route=career"]),
            Some("progress".into()),
            "first match wins"
        );
    }

    #[test]
    fn route_hash_js_quotes_the_hash_as_a_js_string_literal() {
        let js = route_hash_js("board");
        assert_eq!(js, "try{location.hash=\"#/board\";}catch(e){}");
        assert!(js.is_ascii());
        assert_eq!(js.matches('\r').count(), 0);
    }

    #[test]
    fn accelerator_allow_list_covers_exactly_f5_ctrl_r_f3_ctrl_p() {
        // Bare keys.
        assert!(is_blocked_accelerator(VK_F5, false));
        assert!(is_blocked_accelerator(VK_F5, true), "Ctrl+F5 is still F5");
        assert!(is_blocked_accelerator(VK_F3, false));
        assert!(is_blocked_accelerator(VK_F3, true));
        // Ctrl-gated keys.
        assert!(is_blocked_accelerator(VK_R, true), "Ctrl+R");
        assert!(!is_blocked_accelerator(VK_R, false), "bare R must type normally");
        assert!(is_blocked_accelerator(VK_P, true), "Ctrl+P");
        assert!(!is_blocked_accelerator(VK_P, false), "bare P must type normally");
        // Everything R4 and Ctrl+F need to keep working.
        const VK_OEM_PLUS: u32 = 0xBB;
        const VK_OEM_MINUS: u32 = 0xBD;
        const VK_0: u32 = 0x30;
        const VK_F: u32 = 0x46;
        for (vk, ctrl) in [(VK_OEM_PLUS, true), (VK_OEM_MINUS, true), (VK_0, true), (VK_F, true), (VK_F, false)] {
            assert!(!is_blocked_accelerator(vk, ctrl), "vk {vk:#x} ctrl {ctrl} must stay unhandled");
        }
    }

    #[test]
    fn native_theme_state_starts_empty() {
        let s = NativeThemeState::default();
        assert_eq!(*s.theme.lock().unwrap(), None);
        assert_eq!(*s.background_applied.lock().unwrap(), None);
    }

    /// GAP C proxy at the state level (the real call happens with a live
    /// window - see the smoke script's R8 assertion): `theme` and
    /// `background_applied` are two independent slots. Setting one must
    /// never be readable as having set the other - that conflation is
    /// exactly what let a dropped `set_background_color` call hide behind
    /// an unrelated successful `set_theme` before this split.
    #[test]
    fn native_theme_fields_are_independently_settable() {
        let s = NativeThemeState::default();
        *s.theme.lock().unwrap() = Some(NativeTheme { dark: true, ground: "#101010".into() });
        assert_eq!(
            *s.background_applied.lock().unwrap(),
            None,
            "background_applied must not be inferred from theme being set"
        );
        *s.background_applied.lock().unwrap() = Some("#101010".into());
        assert_eq!(*s.background_applied.lock().unwrap(), Some("#101010".into()));
    }

    #[test]
    fn nav_load_state_starts_at_zero_and_counts_every_increment() {
        let s = NavLoadState::default();
        assert_eq!(s.0.load(Ordering::SeqCst), 0);
        s.0.fetch_add(1, Ordering::SeqCst);
        s.0.fetch_add(1, Ordering::SeqCst);
        assert_eq!(s.0.load(Ordering::SeqCst), 2, "every Finished event must count, not just the first (unlike should_reveal)");
    }
}
