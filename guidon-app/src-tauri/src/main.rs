// GUIDON desktop shell.
//
// Deliberately minimal: the entire application is the bundled offline web build
// in ../web. This process exists to give it a real window, a Start-menu entry
// and its own storage, not to add behaviour. Nothing here touches the network.
//
// Roadmap audit round 4, "Native platform deeper integration gaps" bucket:
// ../tauri.conf.json's app.windows[0] deliberately has NO "theme" key. Tauri
// treats an absent theme as "follow the OS", which is the same outcome
// native.js's applySystemBars()/watchTheme() achieve for Android's status
// bar (a MutationObserver on <html data-theme> re-painting the bar to match
// GUIDON's own in-app theme) — except on Windows the OS-drawn titlebar
// tracks prefers-color-scheme on its own once nothing here pins it, so no
// equivalent watcher/command is needed. This file used to ship with
// "theme": "Dark" hardcoded, which left the native titlebar permanently
// dark even when both GUIDON's in-app theme and the OS were set to light -
// removing the override, not adding a runtime theme-setting command, is the
// smallest correct fix (see that bucket's finding for the rejected
// alternative: a #[tauri::command] the JS side would invoke on every theme
// change, mirroring applySystemBars() — unnecessary extra surface for a
// problem the platform already solves for free once nothing overrides it).
//
// Desktop R1: tauri auto-creates every app.windows entry before setup() runs
// (tauri 2.11.5 src/app.rs setup(): `windows.iter().filter(|w| w.create)`),
// and a second build of the label "main" errors. tauri.conf.json therefore
// says "label": "main", "create": false, and setup() below builds the one
// window itself through WebviewWindowBuilder::from_config - the same config
// entry, the same plugins, only the moment of creation moved into code where
// the R11 probe can be attached to it. R2 (show-when-painted) is NOT here.
//
// Desktop R11: with GUIDON_SELFTEST_OUT set the window gets the page-side
// probe as an initialization script and a coordinator thread waits for its
// report (src/selftest.rs). A normal launch has neither.
//
// Collective P4 (R-ROOM): src/room.rs is the LAN study-room host - a tokio
// listener the page starts through room_start and talks to through the
// same transport seam every other host uses (src/room-tauri.js). It binds
// nothing until the page, with Settings -> Study groups ON, asks; the
// header sentence above ("nothing here touches the network") therefore
// still holds for every launch that never opens a room. The commands are
// app commands from the bundled origin: no capability file (rule 8).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;
mod room;
mod room_schema_gen;
mod selftest;

use tauri::{Manager, WebviewWindowBuilder};

fn main() {
    // The R11 command pushes the merged report here; the receiver moves into
    // setup() and is dropped there unless self-test mode is on.
    let (selftest_tx, selftest_rx) = std::sync::mpsc::sync_channel(1);

    tauri::Builder::default()
        // Launching GUIDON again (Start menu, desktop shortcut, pinned taskbar)
        // should raise the window that is already open rather than start a
        // second copy fighting over the same IndexedDB. R6: a validated
        // --route=<x> in the second launch's argv is handed to the ALREADY
        // RUNNING window as a hash change (the page's own router then
        // re-titles it - R7).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(route) = desktop::route_from_argv(&argv) {
                    let _ = window.eval(desktop::route_hash_js(&route));
                }
            }
        }))
        // Remember size, position and maximised state between runs. Someone who
        // studies on a second monitor should not have to move the window daily.
        // R2: VISIBLE and MAXIMIZED are excluded from the flags this restores
        // automatically (see desktop::window_state_flags) - main.rs's setup()
        // re-applies the saved maximize state and shows the window itself,
        // once the page has actually painted something.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(desktop::window_state_flags())
                .build(),
        )
        // R11: always registered, always managed. Outside self-test mode the
        // probe is never injected, so nothing calls the command; if something
        // did, the dropped receiver makes it return an error, not a file.
        .manage(selftest::Sink(selftest_tx))
        // R-ROOM: the listener's state. Empty until room_start; every room
        // command refuses unless the page passes studyGroups:true and
        // fork:"tauri" (defense in depth - the page is the source of truth).
        .manage(room::RoomState::default())
        // R8/S6: the last theme native.js told this window to apply; the
        // selftest report reads it back (there is no getter for a webview's
        // own background colour once set).
        .manage(desktop::NativeThemeState::default())
        // R3 GAP B: counts every real page-navigation Finished event
        // (desktop::arm_reveal's on_page_load hook) so an outside probe can
        // tell whether F5 actually reloaded the page - see nav_load_count.
        .manage(desktop::NavLoadState::default())
        .invoke_handler(tauri::generate_handler![
            selftest::selftest_report,
            room::room_start,
            room::room_send,
            room::room_stop,
            room::room_stats,
            desktop::set_native_theme,
            desktop::nav_load_count
        ])
        .setup(move |app| {
            let selftest = selftest::Config::from_env();
            // R1: build app.windows[0] ("main", create:false) from its own
            // config entry. No capability file exists or is needed (rule 8).
            let mut window =
                WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?;
            if let Some(cfg) = &selftest {
                // GUIDON_SELFTEST_THEME (optional): boot into a known theme
                // rather than whatever the WebView2 profile has saved, so
                // R8's assertion (native theme follows the app's OWN theme,
                // from process start) is deterministic.
                if let Some(theme) = &cfg.theme {
                    window = window.initialization_script(selftest::theme_seed_script(theme));
                }
                window = window.initialization_script(selftest::INIT_SCRIPT);
            }
            // R6: a validated --route=<x> on THIS launch's own argv becomes
            // an initialization script, so it runs before the page's own
            // default-route line (src/index.html: `if (!location.hash) ...`)
            // ever executes.
            if let Some(route) = desktop::route_from_argv(&std::env::args().collect::<Vec<_>>()) {
                window = window.initialization_script(desktop::route_hash_js(&route));
            }
            // R7: the page already sets document.title = "GUIDON - <label>"
            // per route (desktop Session 2); this is the one place that
            // reaches the native title bar.
            window = window.on_document_title_changed(|w, title| {
                let _ = w.set_title(&title);
            });
            // R2: arm the page-load listener before build() (on_page_load is
            // a builder method), then build, then start the fallback timer
            // with the SAME shown-flag so only one of them ever fires.
            let (window, shown) = desktop::arm_reveal(window);
            let built = window.build()?;
            desktop::spawn_reveal_fallback(built.clone(), shown);
            // R3: selective accelerator guard (Windows only - there is no
            // WebView2 controller anywhere else).
            #[cfg(windows)]
            desktop::install_accelerator_guard(&built);
            if let Some(cfg) = selftest {
                selftest::arm(selftest_rx, cfg, app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GUIDON");
}
