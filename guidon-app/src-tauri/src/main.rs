// GUIDON desktop shell.
//
// Deliberately minimal: the entire application is the bundled offline web build
// in ../web. This process exists to give it a real window, a Start-menu entry
// and its own storage, not to add behaviour. Nothing here touches the network.
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
