//! One relocated test (room-tls-and-discovery-pitch.md section 3's fuzzer
//! prerequisite, this session): src/room.rs moved behind `pub mod room;` in
//! the new src/lib.rs so src/bin/fuzz_validate.rs can call the real
//! `guidon::room::validate()`. Every OTHER test that used to live in
//! room.rs's own `#[cfg(test)] mod tests` still does, and now runs via
//! `cargo test --lib` - fine, since none of them touch tauri's windowing.
//!
//! This ONE test is different: it builds a real `tauri::test::mock_builder()`
//! app and a real `tauri::WebviewWindowBuilder` window to drive the IPC
//! commands end to end. Measured this session: that specific construction
//! crashes at process START (Windows STATUS_ENTRYPOINT_NOT_FOUND,
//! 0xC0000139 - a loader failure before any test body runs, not a panic
//! inside one) from ANY standalone test binary in this package OTHER than
//! the "guidon" bin's own unittest exe - reproduced from a brand-new
//! tests/*.rs integration-test file with nothing else in it, and again by
//! appending the same two lines to the pre-existing (normally-passing)
//! tests/config.rs. It is not caused by the lib split itself; the split
//! just moved this test's only working home (room.rs, `mod`-included
//! directly into main.rs) somewhere that home no longer reaches. Filed here
//! instead, `mod`-included from main.rs (never from lib.rs, so it is not
//! reachable through `pub mod room;` and keeps running in the one binary
//! proven to tolerate it) with its own tiny, test-only ROOM/frame() (the
//! same two definitions room.rs's OWN test module still carries for its
//! many other tests - not `validate()` or anything protocol-bearing, so
//! this is not the "second copy of a real implementation" this session's
//! fuzzer work is careful to avoid) so it still exercises the exact same
//! IPC surface through `guidon::room`'s public commands.

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// tauri::generate_handler!'s hidden per-command macro is only found through
// a module-qualified path (`room::room_start`, matching main.rs's own
// invoke_handler! call) - a bare `use`-imported name does not carry it.
use guidon::room;
use guidon::room::{RoomInfo, RoomState, GUEST_HTML, WINDOW_LABEL};
use guidon::room_schema_gen as schema;

const ROOM: &str = "ALPHA-BRAVO-42";

fn frame(from: &str, t: &str, body: Value) -> Value {
    json!({ "v": schema::PROTOCOL_VERSION, "t": t, "room": ROOM, "seq": 0, "from": from, "body": body })
}

fn invoke(cmd: &str, body: Value) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

#[test]
fn commands_refuse_without_the_gate_and_run_a_room_on_the_mock_runtime() {
    let app = mock_builder()
        .manage(RoomState::default())
        .invoke_handler(tauri::generate_handler![room::room_start, room::room_send, room::room_stop, room::room_stats])
        .build(mock_context(noop_assets()))
        .expect("mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, WINDOW_LABEL, Default::default()).build().expect("mock window");

    let err = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": false, "fork": "tauri" }))).expect_err("setting off must reject");
    assert!(err.to_string().contains("off"), "{err}");
    let err = get_ipc_response(&webview, invoke("room_start", json!({ "port": null, "code": ROOM, "studyGroups": true, "fork": "web" }))).expect_err("fork web must reject");
    assert!(err.to_string().contains("fork"), "{err}");
    let err = get_ipc_response(&webview, invoke("room_send", json!({ "to": null, "frame": {}, "studyGroups": true, "fork": "tauri" }))).expect_err("no room open");
    assert!(err.to_string().contains("no room"), "{err}");

    let closed = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stats").deserialize::<Value>().unwrap();
    assert_eq!(closed["open"], json!(false));
    assert_eq!(closed["keepAwake"], json!(false));

    // `tlsPort` is deliberately omitted here (matching room-tauri.js's own
    // real call site, which this test's invoke() bodies otherwise mirror
    // exactly - see hostStart() in that file) to prove the room-tls-and-
    // discovery-pitch.md Section 1 addition doesn't change the existing
    // plaintext-path behavior: an absent optional command argument must
    // still resolve (Tauri treats a missing `Option<T>` key as `None`),
    // getting the default TLS-port convention rather than an error.
    let info = get_ipc_response(&webview, invoke("room_start", json!({ "port": null, "code": "alpha-bravo-42", "studyGroups": true, "fork": "tauri" })))
        .expect("room_start resolves")
        .deserialize::<RoomInfo>()
        .unwrap();
    assert_eq!(info.room, ROOM);
    assert!(info.port > 0);
    assert_eq!(info.url, format!("http://{}:{}/j/{ROOM}", info.ip, info.port));
    // room-tls-and-discovery-pitch.md Section 1: the second, TLS-wrapped
    // listener, bound and advertised alongside the unchanged plaintext one.
    assert!(info.tls_port > 0 && info.tls_port != info.port, "an independent TLS port must be bound");
    assert_eq!(info.identity.fp.len(), 8, "the human-comparable fp");
    assert_eq!(info.identity.spki_sha256.len(), 64, "the full-strength SPKI pin, never truncated");

    // the listener is real: a Node-style client would see the guest page
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let body = rt.block_on(async {
        let mut s = TcpStream::connect(("127.0.0.1", info.port)).await.expect("connect");
        s.write_all(b"GET /j/ALPHA-BRAVO-42 HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
        let mut out = Vec::new();
        s.read_to_end(&mut out).await.unwrap();
        out
    });
    let text = String::from_utf8_lossy(&body);
    assert!(text.starts_with("HTTP/1.1 200 OK\r\n"), "{}", &text[..text.len().min(80)]);
    assert!(body.ends_with(GUEST_HTML), "the guest page bytes end the response");

    let open = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stats").deserialize::<Value>().unwrap();
    assert_eq!(open["open"], json!(true));
    assert_eq!(open["room"], json!(ROOM));
    assert_eq!(open["seatCap"], json!(schema::SEAT_CAP));
    if cfg!(windows) {
        assert_eq!(open["keepAwake"], json!(true), "X13: SetThreadExecutionState held while the room is open");
    }

    let sent = get_ipc_response(&webview, invoke("room_send", json!({ "to": "NOBODY22", "frame": frame("NODEHOST", "ping", json!({ "n": 1 })), "studyGroups": true, "fork": "tauri" }))).expect("send").deserialize::<Value>().unwrap();
    assert_eq!(sent, json!({ "sent": 0, "dropped": "unknown-to" }));

    // Settings -> Study groups goes OFF first, then the page's settings:change handler calls leave():
    // the stop request therefore carries studyGroups:false and MUST still stop (measured stuck-bound otherwise).
    let stopped = get_ipc_response(&webview, invoke("room_stop", json!({ "studyGroups": false, "fork": "tauri" }))).expect("room_stop works with the setting OFF").deserialize::<Value>().unwrap();
    assert_eq!(stopped, json!({ "stopped": true }));
    let after = get_ipc_response(&webview, invoke("room_stats", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stats").deserialize::<Value>().unwrap();
    assert_eq!(after["open"], json!(false));
    assert_eq!(after["keepAwake"], json!(false));
    std::thread::sleep(std::time::Duration::from_millis(150)); // the aborted accept task drops the listener on its next poll
    let refused = rt.block_on(async { tokio::time::timeout(std::time::Duration::from_secs(2), TcpStream::connect(("127.0.0.1", info.port))).await });
    assert!(!matches!(refused, Ok(Ok(_))), "the port is closed after room_stop");
    // The TLS listener's accept task must be aborted exactly as thoroughly
    // as the plaintext one's (room-tls-and-discovery-pitch.md Section 1) -
    // a leaked TLS listener task after room_stop would be a real, silent
    // resource leak. Same proof-of-closure shape as the plaintext check
    // just above, ported to the TLS port.
    let tls_refused = rt.block_on(async { tokio::time::timeout(std::time::Duration::from_secs(2), TcpStream::connect(("127.0.0.1", info.tls_port))).await });
    assert!(!matches!(tls_refused, Ok(Ok(_))), "the TLS port is closed after room_stop");
    let again = get_ipc_response(&webview, invoke("room_stop", json!({ "studyGroups": true, "fork": "tauri" }))).expect("stop").deserialize::<Value>().unwrap();
    assert_eq!(again, json!({ "stopped": false }));
}
