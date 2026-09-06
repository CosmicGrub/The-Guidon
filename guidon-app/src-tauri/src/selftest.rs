//! R11 self-test mode for the GUIDON desktop shell.
//!
//! Off unless the process starts with `GUIDON_SELFTEST_OUT=<file>`. When it
//! is set, main.rs injects `selftest-init.js` into the main window; that
//! script waits for the page to publish `G.routes` and `G.theme.THEMES`,
//! then invokes the `selftest_report` command with `{routes, themes, hash,
//! fork, buildSha}`. The command merges the page's report with window facts
//! from the Rust side (`inner_size`, `scale_factor`, `is_visible`, `theme`,
//! the window labels, a `menu` dump - `null` until a menu exists) and hands
//! the merged object to a coordinator thread, which writes it to the file and
//! ends the process:
//!
//! * exit 0 when the page reported and either no `GUIDON_SELFTEST_EXPECT_ROUTES`
//!   is set or `routes >= GUIDON_SELFTEST_EXPECT_ROUTES`;
//! * exit 1 when `routes` is below that number, when the variable is not an
//!   integer, or when the page never reported within [`REPORT_TIMEOUT`]
//!   (the JSON then carries `"reason"` and no page keys).
//!
//! The process ends through `std::process::exit`, not `AppHandle::exit`:
//! tauri-runtime-wry 2.11.4 maps `Message::RequestExit(code)` to
//! `ControlFlow::Exit` and drops the code (src/lib.rs, the
//! `Message::RequestExit` arm), so a requested non-zero code would come out
//! as 0. Exiting directly also skips the window-state plugin's save, which is
//! what a throwaway self-test run should do - it must not overwrite the
//! operator's remembered window geometry.
//!
//! Everything that decides is a plain function over values (`merge`,
//! `decide`, `write_outcome`) so `cargo test` covers it on the MockRuntime;
//! the end-to-end run against the debug exe belongs to the smoke step.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{Manager, Runtime, State, WebviewWindow};

/// Path of the JSON report; setting it switches self-test mode on.
pub const OUT_ENV: &str = "GUIDON_SELFTEST_OUT";
/// Optional minimum route count; exit 1 when the page reports fewer.
pub const EXPECT_ROUTES_ENV: &str = "GUIDON_SELFTEST_EXPECT_ROUTES";
/// How long the coordinator waits for the page before writing a timeout
/// report and exiting 1.
pub const REPORT_TIMEOUT: Duration = Duration::from_secs(15);
/// The page-side probe, injected as an initialization script in self-test
/// mode only.
pub const INIT_SCRIPT: &str = include_str!("selftest-init.js");
/// The command name the probe invokes.
pub const COMMAND: &str = "selftest_report";
/// Optional: a theme id to seed before the page boots, so a self-test run
/// starts from a KNOWN theme rather than whatever a WebView2 profile
/// happens to have saved (the smoke script's R8 assertion needs the page
/// to boot dark, deterministically, to prove set_native_theme runs at
/// startup - not just on a later change). Only consulted alongside
/// GUIDON_SELFTEST_OUT; ignored on a normal launch.
pub const THEME_ENV: &str = "GUIDON_SELFTEST_THEME";

/// Self-test settings read from the environment once, at setup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub out: PathBuf,
    pub expect_routes: Option<String>,
    pub theme: Option<String>,
}

impl Config {
    /// `None` unless `GUIDON_SELFTEST_OUT` is set to a non-empty path.
    pub fn from_env() -> Option<Self> {
        Self::from_pairs(std::env::var_os(OUT_ENV), std::env::var(EXPECT_ROUTES_ENV).ok(), std::env::var(THEME_ENV).ok())
    }

    /// The same decision over explicit values, for tests.
    pub fn from_pairs(out: Option<OsString>, expect_routes: Option<String>, theme: Option<String>) -> Option<Self> {
        let out = out?;
        if out.is_empty() {
            return None;
        }
        Some(Self {
            out: PathBuf::from(out),
            expect_routes,
            theme: theme.filter(|t| is_valid_theme_id(t)),
        })
    }
}

/// Lowercase ascii and dashes only - the same shape every id in
/// src/index.html's own theme list (`T`) already has. Anything else is
/// silently dropped rather than reaching the page as untrusted JS text
/// (the same posture as desktop::is_valid_route).
pub fn is_valid_theme_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| matches!(b, b'a'..=b'z' | b'-'))
}

/// The initialization script that seeds `guidon:appearance:v1` - the exact
/// localStorage key src/index.html's pre-paint script reads - so a self-test
/// launch (always a fresh WebView2 profile under the smoke script) boots
/// directly into `theme` with no race against that inline script.
pub fn theme_seed_script(theme: &str) -> String {
    format!(
        "try{{localStorage.setItem('guidon:appearance:v1',JSON.stringify({{theme:{}}}));}}catch(e){{}}",
        serde_json::to_string(theme).unwrap_or_else(|_| "\"\"".into())
    )
}

/// What the page reports. Unknown keys are ignored; only `routes` and
/// `themes` are required so an older probe still produces a file.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageReport {
    pub routes: u64,
    pub themes: u64,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub fork: Option<String>,
    #[serde(default)]
    pub build_sha: Option<String>,
    #[serde(default)]
    pub ready_ms: Option<u64>,
}

/// What the Rust side knows about the window that reported.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HostFacts {
    pub label: String,
    pub inner_size: [u32; 2],
    pub scale_factor: f64,
    pub is_visible: bool,
    pub theme: String,
    pub windows: Vec<String>,
    pub menu: Value,
}

/// Reads the window facts. Every accessor is a runtime call, so any of them
/// can fail; the command turns that into a rejected invoke.
pub fn host_facts<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<HostFacts> {
    let size = window.inner_size()?;
    let mut windows: Vec<String> = window.webview_windows().keys().cloned().collect();
    windows.sort();
    Ok(HostFacts {
        label: window.label().to_string(),
        inner_size: [size.width, size.height],
        scale_factor: window.scale_factor()?,
        is_visible: window.is_visible()?,
        theme: window.theme()?.to_string(),
        windows,
        // No application menu exists yet; a later phase that adds one dumps
        // it here so the smoke can assert on it.
        menu: Value::Null,
    })
}

/// One flat object: the page's keys as the page sent them (camelCase), the
/// host's keys as named in the desktop plan (snake_case), plus the tauri
/// version the shell was built against.
pub fn merge(page: &PageReport, host: &HostFacts) -> Value {
    let mut out = match serde_json::to_value(page) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    };
    if let Ok(Value::Object(h)) = serde_json::to_value(host) {
        for (k, v) in h {
            out.insert(k, v);
        }
    }
    out.insert("tauri".into(), Value::String(tauri::VERSION.into()));
    Value::Object(out)
}

/// Managed state: the command's only side effect is pushing the merged
/// report into this channel. In a normal (non-self-test) launch the receiver
/// is dropped at the end of setup, so a stray invoke fails cleanly.
pub struct Sink(pub SyncSender<Value>);

#[tauri::command]
pub fn selftest_report<R: Runtime>(
    window: WebviewWindow<R>,
    sink: State<'_, Sink>,
    native_theme: State<'_, crate::desktop::NativeThemeState>,
    report: PageReport,
) -> Result<Value, String> {
    let facts = host_facts(&window).map_err(|e| format!("selftest host facts: {e}"))?;
    let mut merged = merge(&report, &facts);
    // R8: there is no getter for a webview's own background colour once
    // set, so this is the only record of the last set_native_theme call;
    // absent until S6's native.js has invoked it at least once.
    if let Some(nt) = native_theme.theme.lock().unwrap_or_else(|p| p.into_inner()).clone() {
        if let Value::Object(ref mut m) = merged {
            m.insert("nativeTheme".into(), serde_json::to_value(&nt).unwrap_or(Value::Null));
        }
    }
    // GAP C: a SEPARATE record of whether/what set_background_color
    // actually applied, written at its own call site (desktop.rs) - never
    // inferred from `nativeTheme.ground` above, so a regression that drops
    // that call leaves this key absent even while nativeTheme still reports
    // fine.
    if let Some(bg) = native_theme
        .background_applied
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
    {
        if let Value::Object(ref mut m) = merged {
            m.insert("nativeThemeBackgroundApplied".into(), Value::String(bg));
        }
    }
    sink.0
        .try_send(merged.clone())
        .map_err(|e| format!("selftest sink: {e}"))?;
    Ok(merged)
}

/// The written report plus the process exit code.
#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub code: i32,
    pub json: Value,
}

/// Turns what the coordinator received (or did not) into the file contents
/// and the exit code. Pure: takes the expectation as a value.
pub fn decide(
    received: Result<Value, RecvTimeoutError>,
    expect_routes: Option<&str>,
    timeout: Duration,
) -> Outcome {
    let merged = match received {
        Ok(v) => v,
        Err(why) => {
            let reason = match why {
                RecvTimeoutError::Timeout => {
                    format!("page did not report within {} ms", timeout.as_millis())
                }
                RecvTimeoutError::Disconnected => "report channel closed before any report".into(),
            };
            return Outcome {
                code: 1,
                json: json!({
                    "ok": false,
                    "exit_code": 1,
                    "reason": reason,
                    "expect_routes": expect_routes,
                }),
            };
        }
    };

    let routes = merged.get("routes").and_then(Value::as_u64);
    let (code, reason) = match expect_routes {
        None => (0, "reported; no route expectation set".to_string()),
        Some(raw) => match raw.trim().parse::<u64>() {
            Err(_) => (
                1,
                format!("{EXPECT_ROUTES_ENV}={raw:?} is not a non-negative integer"),
            ),
            Ok(want) => match routes {
                Some(have) if have >= want => (0, format!("routes {have} >= expected {want}")),
                Some(have) => (1, format!("routes {have} < expected {want}")),
                None => (1, "report carries no numeric routes count".to_string()),
            },
        },
    };

    let mut out = match merged {
        Value::Object(m) => m,
        other => {
            let mut m = Map::new();
            m.insert("report".into(), other);
            m
        }
    };
    out.insert("ok".into(), Value::Bool(code == 0));
    out.insert("exit_code".into(), json!(code));
    out.insert("reason".into(), Value::String(reason));
    out.insert("expect_routes".into(), json!(expect_routes));
    Outcome {
        code,
        json: Value::Object(out),
    }
}

/// Blocks for at most `timeout` on the sink's receiver, then decides.
pub fn await_report(rx: &Receiver<Value>, timeout: Duration, expect_routes: Option<&str>) -> Outcome {
    decide(rx.recv_timeout(timeout), expect_routes, timeout)
}

/// Writes the outcome as pretty JSON (LF, trailing newline), creating parent
/// directories.
pub fn write_outcome(path: &Path, outcome: &Outcome) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let mut text = serde_json::to_string_pretty(&outcome.json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    text.push('\n');
    std::fs::write(path, text)
}

/// How long [`arm`]'s coordinator polls [`crate::desktop::NativeThemeState`]
/// for a first value after the page's own report arrives, when a theme was
/// seeded (`cfg.theme.is_some()` - GAP C, R8 only; every other self-test run
/// is unaffected). Measured 2026-09-05: `set_native_theme`'s own invoke from
/// native.js is dispatched on ITS OWN schedule (module load), independent of
/// selftest-init.js's `G.routes`/`G.theme.THEMES` gate - it can still be
/// ~60 ms from landing when the page's report already fired and froze the
/// merge `selftest_report` built inside that SAME command call. Polling
/// here (rather than trusting that frozen merge) is what makes
/// `nativeTheme`/`nativeThemeBackgroundApplied` a real signal instead of an
/// always-absent one. The bound also has to stay well under the ~330 ms
/// gap measured before native.js's UNRELATED debounced re-apply
/// (`watchTauriTheme`'s `MutationObserver`, 260 ms after an early attribute
/// settle) can overwrite it with a different value.
const NATIVE_THEME_POLL_TIMEOUT: Duration = Duration::from_millis(250);
const NATIVE_THEME_POLL_STEP: Duration = Duration::from_millis(10);

/// Re-merges the freshest [`crate::desktop::NativeThemeState`] into an
/// already-decided [`Outcome`], polling briefly first. Only called when a
/// theme was seeded (R8's own scenario); every other self-test caller's
/// timing is unchanged.
fn attach_native_theme<R: Runtime>(outcome: &mut Outcome, app: &tauri::AppHandle<R>) {
    let native_theme = match app.try_state::<crate::desktop::NativeThemeState>() {
        Some(s) => s,
        None => return,
    };
    let waited = std::time::Instant::now();
    while native_theme
        .background_applied
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_none()
        && waited.elapsed() < NATIVE_THEME_POLL_TIMEOUT
    {
        std::thread::sleep(NATIVE_THEME_POLL_STEP);
    }
    if let Value::Object(ref mut m) = outcome.json {
        if let Some(nt) = native_theme.theme.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            m.insert("nativeTheme".into(), serde_json::to_value(&nt).unwrap_or(Value::Null));
        }
        if let Some(bg) = native_theme
            .background_applied
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
        {
            m.insert("nativeThemeBackgroundApplied".into(), Value::String(bg));
        }
    }
}

/// Starts the coordinator thread. Called from setup only in self-test mode;
/// the thread owns the receiver, waits, writes, and ends the process.
pub fn arm<R: Runtime>(rx: Receiver<Value>, cfg: Config, app: tauri::AppHandle<R>) {
    let spawned = std::thread::Builder::new()
        .name("guidon-selftest".into())
        .spawn(move || {
            eprintln!(
                "GUIDON selftest: armed; waiting up to {} ms for {COMMAND}",
                REPORT_TIMEOUT.as_millis()
            );
            let mut outcome = await_report(&rx, REPORT_TIMEOUT, cfg.expect_routes.as_deref());
            if cfg.theme.is_some() {
                attach_native_theme(&mut outcome, &app);
            }
            let code = match write_outcome(&cfg.out, &outcome) {
                Ok(()) => outcome.code,
                Err(e) => {
                    eprintln!("GUIDON selftest: cannot write {}: {e}", cfg.out.display());
                    1
                }
            };
            eprintln!(
                "GUIDON selftest: exit {code} ({}), report at {}",
                outcome.json["reason"].as_str().unwrap_or("?"),
                cfg.out.display()
            );
            std::process::exit(code);
        });
    if let Err(e) = spawned {
        eprintln!("GUIDON selftest: cannot start coordinator: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::sync_channel;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn page() -> PageReport {
        PageReport {
            routes: 19,
            themes: 24,
            hash: "#/home".into(),
            fork: Some("tauri".into()),
            build_sha: Some("38c2f22".into()),
            ready_ms: Some(120),
        }
    }

    fn host() -> HostFacts {
        HostFacts {
            label: "main".into(),
            inner_size: [1280, 880],
            scale_factor: 1.25,
            is_visible: true,
            theme: "dark".into(),
            windows: vec!["main".into()],
            menu: Value::Null,
        }
    }

    fn invoke(body: Value) -> InvokeRequest {
        InvokeRequest {
            cmd: COMMAND.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            // The bundled origin on Windows; app commands from it need no
            // capability (rule 8).
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    #[test]
    fn config_needs_a_non_empty_out_path() {
        assert_eq!(Config::from_pairs(None, Some("3".into()), None), None);
        assert_eq!(Config::from_pairs(Some(OsString::new()), None, None), None);
        assert_eq!(
            Config::from_pairs(Some(OsString::from("r.json")), Some("3".into()), None),
            Some(Config {
                out: PathBuf::from("r.json"),
                expect_routes: Some("3".into()),
                theme: None,
            })
        );
    }

    #[test]
    fn config_keeps_a_valid_theme_and_drops_an_invalid_one() {
        assert_eq!(
            Config::from_pairs(Some(OsString::from("r.json")), None, Some("night-vision".into())).unwrap().theme,
            Some("night-vision".into())
        );
        assert_eq!(Config::from_pairs(Some(OsString::from("r.json")), None, Some("Night_Vision".into())).unwrap().theme, None);
        assert_eq!(Config::from_pairs(Some(OsString::from("r.json")), None, Some("".into())).unwrap().theme, None);
    }

    #[test]
    fn is_valid_theme_id_matches_the_app_s_own_theme_id_shape() {
        for id in ["field-manual", "night-vision", "ink-paper"] {
            assert!(is_valid_theme_id(id));
        }
        for id in ["", "Night-Vision", "night_vision", "night vision", "<script>"] {
            assert!(!is_valid_theme_id(id));
        }
    }

    #[test]
    fn theme_seed_script_is_ascii_lf_and_sets_the_appearance_key() {
        let js = theme_seed_script("night-vision");
        assert!(js.is_ascii());
        assert_eq!(js.matches('\r').count(), 0);
        assert!(js.contains("guidon:appearance:v1"));
        assert!(js.contains("\"night-vision\""));
    }

    #[test]
    fn report_timeout_is_fifteen_seconds() {
        assert_eq!(REPORT_TIMEOUT, Duration::from_secs(15));
    }

    #[test]
    fn init_script_is_ascii_lf_and_invokes_the_command() {
        assert!(INIT_SCRIPT.is_ascii(), "selftest-init.js must be ASCII");
        assert_eq!(INIT_SCRIPT.matches('\r').count(), 0, "selftest-init.js must be LF-only");
        assert!(INIT_SCRIPT.contains("window.__TAURI_INTERNALS__.invoke("));
        assert!(INIT_SCRIPT.contains(&format!("\"{COMMAND}\"")));
        for key in ["routes:", "themes:", "hash:", "fork:", "buildSha:"] {
            assert!(INIT_SCRIPT.contains(key), "probe must send {key}");
        }
        assert!(INIT_SCRIPT.contains("G.routes.length"));
        assert!(INIT_SCRIPT.contains("G.theme.THEMES.length"));
    }

    #[test]
    fn merge_is_flat_and_keeps_both_sides() {
        let v = merge(&page(), &host());
        assert_eq!(v["routes"], json!(19));
        assert_eq!(v["themes"], json!(24));
        assert_eq!(v["hash"], json!("#/home"));
        assert_eq!(v["fork"], json!("tauri"));
        assert_eq!(v["buildSha"], json!("38c2f22"));
        assert_eq!(v["readyMs"], json!(120));
        assert_eq!(v["label"], json!("main"));
        assert_eq!(v["inner_size"], json!([1280, 880]));
        assert_eq!(v["scale_factor"], json!(1.25));
        assert_eq!(v["is_visible"], json!(true));
        assert_eq!(v["theme"], json!("dark"));
        assert_eq!(v["windows"], json!(["main"]));
        assert_eq!(v["menu"], Value::Null);
        assert_eq!(v["tauri"], json!(tauri::VERSION));
    }

    #[test]
    fn decide_exit_0_without_expectation() {
        let o = decide(Ok(merge(&page(), &host())), None, REPORT_TIMEOUT);
        assert_eq!(o.code, 0);
        assert_eq!(o.json["ok"], json!(true));
        assert_eq!(o.json["exit_code"], json!(0));
        assert_eq!(o.json["expect_routes"], Value::Null);
        assert_eq!(o.json["routes"], json!(19));
    }

    #[test]
    fn decide_exit_0_when_routes_meet_expectation() {
        let o = decide(Ok(merge(&page(), &host())), Some("19"), REPORT_TIMEOUT);
        assert_eq!(o.code, 0, "{}", o.json["reason"]);
        let o = decide(Ok(merge(&page(), &host())), Some("1"), REPORT_TIMEOUT);
        assert_eq!(o.code, 0, "{}", o.json["reason"]);
    }

    #[test]
    fn decide_exit_1_when_routes_below_expectation() {
        let o = decide(Ok(merge(&page(), &host())), Some("20"), REPORT_TIMEOUT);
        assert_eq!(o.code, 1);
        assert_eq!(o.json["ok"], json!(false));
        assert_eq!(o.json["reason"], json!("routes 19 < expected 20"));
        assert_eq!(o.json["expect_routes"], json!("20"));
        // the page keys are still written so the failure is diagnosable
        assert_eq!(o.json["themes"], json!(24));
    }

    #[test]
    fn decide_exit_1_when_expectation_is_not_an_integer() {
        let o = decide(Ok(merge(&page(), &host())), Some("many"), REPORT_TIMEOUT);
        assert_eq!(o.code, 1);
        assert!(o.json["reason"].as_str().unwrap().contains("not a non-negative integer"));
    }

    #[test]
    fn decide_exit_1_when_the_page_never_reports() {
        let o = decide(Err(RecvTimeoutError::Timeout), None, Duration::from_millis(1500));
        assert_eq!(o.code, 1);
        assert_eq!(o.json["ok"], json!(false));
        assert_eq!(o.json["reason"], json!("page did not report within 1500 ms"));
        assert!(o.json.get("routes").is_none());
        let o = decide(Err(RecvTimeoutError::Disconnected), Some("3"), REPORT_TIMEOUT);
        assert_eq!(o.code, 1);
        assert_eq!(o.json["expect_routes"], json!("3"));
    }

    #[test]
    fn await_report_times_out_and_delivers() {
        let (tx, rx) = sync_channel::<Value>(1);
        let o = await_report(&rx, Duration::from_millis(60), None);
        assert_eq!(o.code, 1);
        assert_eq!(o.json["reason"], json!("page did not report within 60 ms"));

        tx.send(merge(&page(), &host())).unwrap();
        let o = await_report(&rx, Duration::from_millis(60), Some("19"));
        assert_eq!(o.code, 0, "{}", o.json["reason"]);
    }

    #[test]
    fn write_outcome_creates_parents_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("guidon-selftest-{}", std::process::id()));
        let path = dir.join("nested").join("report.json");
        let o = decide(Ok(merge(&page(), &host())), Some("19"), REPORT_TIMEOUT);
        write_outcome(&path, &o).expect("write");
        let text = std::fs::read_to_string(&path).expect("read back");
        assert!(text.ends_with('\n'));
        assert_eq!(text.matches('\r').count(), 0);
        let back: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(back, o.json);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn command_merges_page_and_host_on_the_mock_runtime() {
        let (tx, rx) = sync_channel::<Value>(1);
        let app = mock_builder()
            .manage(Sink(tx))
            .manage(crate::desktop::NativeThemeState::default())
            .invoke_handler(tauri::generate_handler![selftest_report])
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock window");

        let res = get_ipc_response(
            &webview,
            invoke(json!({ "report": {
                "routes": 19, "themes": 24, "hash": "#/home",
                "fork": "tauri", "buildSha": "38c2f22", "readyMs": 120,
                "unknownFutureKey": true
            }})),
        );
        let value = res
            .expect("command resolves")
            .deserialize::<Value>()
            .expect("JSON body");

        // page side, as sent
        assert_eq!(value["routes"], json!(19));
        assert_eq!(value["themes"], json!(24));
        assert_eq!(value["hash"], json!("#/home"));
        assert_eq!(value["fork"], json!("tauri"));
        assert_eq!(value["buildSha"], json!("38c2f22"));
        // host side, as the MockRuntime answers (mock_runtime.rs: inner_size
        // 0x0, scale_factor 1.0, is_visible true, theme Light)
        assert_eq!(value["label"], json!("main"));
        assert_eq!(value["inner_size"], json!([0, 0]));
        assert_eq!(value["scale_factor"], json!(1.0));
        assert_eq!(value["is_visible"], json!(true));
        assert_eq!(value["theme"], json!("light"));
        assert_eq!(value["windows"], json!(["main"]));
        assert_eq!(value["menu"], Value::Null);
        assert_eq!(value["tauri"], json!(tauri::VERSION));
        // R8: no set_native_theme call yet in this test, so no key at all -
        // not null, absent (see native_theme_key_is_absent_until_set below).
        assert!(value.get("nativeTheme").is_none());

        // the coordinator receives the very same object
        assert_eq!(rx.try_recv().expect("sink received"), value);

        // and a full decision over it is exit 0 / exit 1 by expectation
        assert_eq!(decide(Ok(value.clone()), Some("19"), REPORT_TIMEOUT).code, 0);
        assert_eq!(decide(Ok(value), Some("9999"), REPORT_TIMEOUT).code, 1);
    }

    /// R8: once something has called set_native_theme (S6's native.js, on
    /// this window), the NEXT selftest report carries what it set - there is
    /// no other way to ask a webview what background colour it currently
    /// has, so this managed state is the only record.
    #[test]
    fn native_theme_key_is_absent_until_set_then_carries_the_last_call() {
        let (tx, rx) = sync_channel::<Value>(1);
        let app = mock_builder()
            .manage(Sink(tx))
            .manage(crate::desktop::NativeThemeState::default())
            .invoke_handler(tauri::generate_handler![selftest_report])
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock window");

        // Simulate set_native_theme having already run once (it is exercised
        // end to end by the smoke script's Phase4 assertions against the
        // real WebView2 window - a MockRuntime has no controller to paint).
        let native_theme = app.state::<crate::desktop::NativeThemeState>();
        *native_theme.theme.lock().unwrap() = Some(crate::desktop::NativeTheme { dark: true, ground: "#0a0e12".into() });
        *native_theme.background_applied.lock().unwrap() = Some("#0a0e12".into());

        let value = get_ipc_response(&webview, invoke(json!({ "report": { "routes": 1, "themes": 1 } })))
            .expect("command resolves")
            .deserialize::<Value>()
            .expect("JSON body");
        assert_eq!(value["nativeTheme"], json!({ "dark": true, "ground": "#0a0e12" }));
        assert_eq!(value["nativeThemeBackgroundApplied"], json!("#0a0e12"));
        assert_eq!(rx.try_recv().expect("sink received")["nativeTheme"], value["nativeTheme"]);
    }

    /// GAP C proxy at the merge level: if `theme` was set but
    /// `background_applied` never was (e.g. a regression drops the
    /// set_background_color call while set_theme keeps succeeding), the
    /// merged report must OMIT `nativeThemeBackgroundApplied` rather than
    /// echo `nativeTheme.ground` - the two must not be inferred from one
    /// another.
    #[test]
    fn native_theme_background_key_is_absent_when_only_theme_was_set() {
        let (tx, rx) = sync_channel::<Value>(1);
        let app = mock_builder()
            .manage(Sink(tx))
            .manage(crate::desktop::NativeThemeState::default())
            .invoke_handler(tauri::generate_handler![selftest_report])
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock window");

        *app.state::<crate::desktop::NativeThemeState>().theme.lock().unwrap() =
            Some(crate::desktop::NativeTheme { dark: true, ground: "#0a0e12".into() });
        // background_applied deliberately left at its default (None).

        let value = get_ipc_response(&webview, invoke(json!({ "report": { "routes": 1, "themes": 1 } })))
            .expect("command resolves")
            .deserialize::<Value>()
            .expect("JSON body");
        assert_eq!(value["nativeTheme"]["ground"], json!("#0a0e12"));
        assert!(
            value.get("nativeThemeBackgroundApplied").is_none(),
            "must not be inferred from nativeTheme.ground: {value}"
        );
        let _ = rx.try_recv();
    }

    #[test]
    fn command_rejects_when_the_sink_is_gone_or_the_report_is_malformed() {
        let (tx, rx) = sync_channel::<Value>(1);
        drop(rx);
        let app = mock_builder()
            .manage(Sink(tx))
            .manage(crate::desktop::NativeThemeState::default())
            .invoke_handler(tauri::generate_handler![selftest_report])
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock window");

        let err = get_ipc_response(&webview, invoke(json!({ "report": { "routes": 1, "themes": 1 } })))
            .expect_err("disconnected sink must reject");
        assert!(err.to_string().contains("selftest sink"), "{err}");

        let err = get_ipc_response(&webview, invoke(json!({ "report": { "themes": 1 } })))
            .expect_err("missing routes must reject");
        assert!(err.to_string().contains("routes"), "{err}");
    }
}
