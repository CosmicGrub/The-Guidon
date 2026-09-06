//! Differential-fuzz oracle for `guidon::room::validate()` (room-tls-and-
//! discovery-pitch.md section 3). Reads one JSON frame per line from stdin,
//! calls the REAL `room::validate()` through the shared lib (never a second
//! copy - see src/lib.rs's own header for why that split exists), and
//! writes one `{"ok":..., "reason":...}` verdict line per input to stdout,
//! flushed immediately after each line so it can run as one long-lived
//! piped child process (tools/fuzz-room-validate.mjs spawns this once and
//! feeds it frames in lockstep, comparing each verdict against
//! src/app-modules/room-schema.js's OWN validate() on the same frame).
//!
//! `validate(frame: &Value) -> Verdict` (src/room.rs) already handles ANY
//! `serde_json::Value` shape on its own terms - a bare string, a number, an
//! array, `null` - by rejecting with reason "frame" (see `is_obj`), so a
//! line that fails to parse as JSON at all is treated exactly the same way:
//! substituted with `Value::Null` and run through the SAME `validate()`
//! call as every other input, rather than skipped (skipping would break the
//! 1:1 line-for-line lockstep the Node harness depends on) or special-cased
//! (there is nothing to special-case - Null already produces reason
//! "frame", the same verdict a real `{}`-less garbage frame gets).
//!
//! One verdict line is written per input line, always, even on a parse
//! failure - never fewer lines out than in.

use std::io::{self, BufRead, Write};

use guidon::room;
use serde_json::Value;

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            // A stdin read error (not a JSON error) ends the stream - the
            // Node side closing its end of the pipe looks like this too.
            Err(_) => break,
        };
        // Malformed JSON (including an empty line) becomes Value::Null,
        // never a skipped line - see the header above for why.
        let frame: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let verdict = room::validate(&frame);
        let reply = serde_json::json!({ "ok": verdict.ok, "reason": verdict.reason });
        // Line-buffered by hand: stdout is fully buffered once piped (not a
        // tty), so an explicit flush per line is required for a long-lived
        // process the Node side reads in lockstep, one line at a time.
        writeln!(out, "{reply}").expect("fuzz_validate: write stdout");
        out.flush().expect("fuzz_validate: flush stdout");
    }
}
