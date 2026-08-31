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
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // Launching GUIDON again (Start menu, desktop shortcut, pinned taskbar)
        // should raise the window that is already open rather than start a
        // second copy fighting over the same IndexedDB.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Remember size, position and maximised state between runs. Someone who
        // studies on a second monitor should not have to move the window daily.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running GUIDON");
}
