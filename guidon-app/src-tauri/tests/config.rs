//! R13 - configuration invariants of the GUIDON desktop shell.
//!
//! These read the SAME files the build reads (tauri.conf.json, the generated
//! ACL manifest, the macOS overlay) and pin the facts the desktop plan
//! depends on. Every assertion here was RED before the change it guards
//! landed; see the desktop-plan record for the quoted failures.
//!
//! Standing rule 8: there is NO capability file. App commands invoked from
//! the bundled origin (http://tauri.localhost on Windows) need none, and the
//! moment a src-tauri/capabilities/ dir or an app ACL manifest appears,
//! tauri gates EVERY app command behind it (tauri 2.11.5
//! src/webview/mod.rs: `plugin_command.is_some() || has_app_acl_manifest ||
//! !is_local` decides whether the ACL is consulted). Two tests below keep
//! that door shut.

use std::path::PathBuf;
use std::process::Command;

use serde_json::{json, Value};

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(rel: &str) -> String {
    let path = crate_dir().join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn conf_text() -> String {
    read("tauri.conf.json")
}

fn conf() -> Value {
    serde_json::from_str(&conf_text()).expect("tauri.conf.json is valid JSON")
}

fn typed_conf() -> tauri::Config {
    serde_json::from_str(&conf_text()).expect("tauri.conf.json parses as tauri::Config")
}

/// The lines the desktop plan adds to app.windows[0], none of them
/// committed to HEAD yet. Stripped from both sides of the HEAD comparison
/// so the test stays meaningful regardless of which of these have landed:
/// R1's "main"/create:false, R2's visible:false, R4's zoomHotkeysEnabled.
const DESKTOP_PLAN_LINES: [&str; 4] = [
    "        \"label\": \"main\",\n",
    "        \"create\": false,\n",
    "        \"visible\": false,\n",
    "        \"zoomHotkeysEnabled\": true,\n",
];

#[test]
fn exactly_one_window_is_declared() {
    let c = conf();
    let windows = c["app"]["windows"].as_array().expect("app.windows is an array");
    assert_eq!(windows.len(), 1, "one window entry, got {}", windows.len());
    assert_eq!(typed_conf().app.windows.len(), 1);
}

#[test]
fn main_window_is_labelled_main_explicitly() {
    let c = conf();
    let w0 = &c["app"]["windows"][0];
    assert_eq!(
        w0.get("label"),
        Some(&Value::String("main".into())),
        "windows[0].label must be the explicit string \"main\" (R1); key present: {}",
        w0.get("label").is_some()
    );
    assert_eq!(typed_conf().app.windows[0].label, "main");
}

#[test]
fn main_window_is_not_auto_created() {
    let c = conf();
    let w0 = &c["app"]["windows"][0];
    assert_eq!(
        w0.get("create"),
        Some(&Value::Bool(false)),
        "windows[0].create must be false so setup() builds the window itself \
         via WebviewWindowBuilder::from_config (R1); got {:?}",
        w0.get("create")
    );
    assert!(
        !typed_conf().app.windows[0].create,
        "tauri::Config parsed windows[0].create as true (the schema default); \
         with that, tauri auto-creates \"main\" and a second build of the \
         label errors (measured R1)"
    );
}

#[test]
fn main_window_minimum_is_360_by_480() {
    let c = conf();
    let w0 = &c["app"]["windows"][0];
    assert_eq!(w0["minWidth"], json!(360), "minWidth");
    assert_eq!(w0["minHeight"], json!(480), "minHeight");
    let typed = typed_conf();
    assert_eq!(typed.app.windows[0].min_width, Some(360.0));
    assert_eq!(typed.app.windows[0].min_height, Some(480.0));
}

#[test]
fn main_window_starts_hidden_for_r2_show_when_painted() {
    let c = conf();
    let w0 = &c["app"]["windows"][0];
    assert_eq!(
        w0.get("visible"),
        Some(&Value::Bool(false)),
        "windows[0].visible must be false (R2) so the window-state plugin's \
         automatic restore cannot paint it before the page has rendered \
         anything; got {:?}",
        w0.get("visible")
    );
    assert!(!typed_conf().app.windows[0].visible);
}

#[test]
fn main_window_has_zoom_hotkeys_enabled_for_r4() {
    let c = conf();
    let w0 = &c["app"]["windows"][0];
    assert_eq!(
        w0.get("zoomHotkeysEnabled"),
        Some(&Value::Bool(true)),
        "windows[0].zoomHotkeysEnabled must be true (R4); got {:?}",
        w0.get("zoomHotkeysEnabled")
    );
    assert!(typed_conf().app.windows[0].zoom_hotkeys_enabled);
}

#[test]
fn no_content_security_policy_key() {
    let c = conf();
    let csp = c["app"].get("security").and_then(|s| s.get("csp"));
    assert!(
        csp.is_none(),
        "app.security.csp must stay absent (the page ships its own <meta> CSP; \
         a tauri-injected one would double up); found {csp:?}"
    );
    assert!(typed_conf().app.security.csp.is_none());
}

#[test]
fn generated_capabilities_manifest_is_empty() {
    let text = read("gen/schemas/capabilities.json");
    assert_eq!(
        text.trim(),
        "{}",
        "gen/schemas/capabilities.json must be exactly {{}} (rule 8); got {text:?}"
    );
    let parsed: Value = serde_json::from_str(&text).expect("capabilities.json parses");
    assert_eq!(parsed, json!({}));
}

#[test]
fn no_capabilities_directory_exists() {
    let dir = crate_dir().join("capabilities");
    assert!(
        !dir.exists(),
        "{} exists; a capabilities dir would gate every app command (rule 8)",
        dir.display()
    );
}

#[test]
fn macos_overlay_parses_and_pins_targets_min_version_and_identity() {
    let text = read("tauri.macos.conf.json");
    let v: Value = serde_json::from_str(&text).expect("tauri.macos.conf.json is valid JSON");
    let keys: Vec<&String> = v.as_object().expect("object").keys().collect();
    assert_eq!(keys, vec!["bundle"], "the overlay carries only a bundle block");
    assert_eq!(v["bundle"]["targets"], json!(["app", "dmg"]));
    assert_eq!(v["bundle"]["macOS"]["minimumSystemVersion"], json!("12.3"));
    assert_eq!(v["bundle"]["macOS"]["signingIdentity"], json!("-"));

    // Typed parse through tauri's own (deny_unknown_fields) schema so a
    // misspelt key fails here, not on the Mac runner nobody has.
    let bundle: tauri::utils::config::BundleConfig =
        serde_json::from_value(v["bundle"].clone()).expect("bundle block parses as BundleConfig");
    assert_eq!(serde_json::to_value(&bundle.targets).unwrap(), json!(["app", "dmg"]));
    assert_eq!(bundle.macos.minimum_system_version.as_deref(), Some("12.3"));
    assert_eq!(bundle.macos.signing_identity.as_deref(), Some("-"));
}

#[test]
fn tauri_conf_is_byte_identical_to_head_apart_from_the_desktop_plan_keys() {
    let out = Command::new("git")
        .args(["show", "HEAD:./tauri.conf.json"])
        .current_dir(crate_dir())
        .output()
        .expect("git is on PATH (this test compares the working tree to HEAD)");
    assert!(
        out.status.success(),
        "git show HEAD:./tauri.conf.json failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let head = String::from_utf8(out.stdout).expect("HEAD tauri.conf.json is UTF-8");
    let work = conf_text();

    let strip = |s: &str| {
        let mut s = s.to_string();
        for line in DESKTOP_PLAN_LINES {
            let n = s.matches(line).count();
            assert!(n <= 1, "{line:?} occurs {n} times");
            s = s.replacen(line, "", 1);
        }
        s
    };
    assert_eq!(
        strip(&work),
        strip(&head),
        "tauri.conf.json differs from HEAD beyond the two R1 keys"
    );
    assert_eq!(work.matches('\r').count(), 0, "tauri.conf.json must be LF-only");
}
