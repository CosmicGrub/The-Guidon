// R-ROOM (collective P4): src/room.rs embeds ../dist/guest.html with
// include_bytes! - the build artifact P3 defined (tools/build.mjs emits it
// from src/guest.html + the schema module + the room module's pure core).
// include_bytes! alone would fail with a bare "couldn't read" line; this
// names the fix, and rerun-if-changed makes a rebuilt guest page rebuild
// the exe (cargo would otherwise only notice the .rs files).
fn main() {
    let guest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/guest.html");
    println!("cargo:rerun-if-changed={}", guest.display());
    if !guest.is_file() {
        panic!(
            "guidon build: {} is missing - run `npm run build` in guidon-app first; \
             the Rust room host serves those exact bytes (R-ROOM)",
            guest.display()
        );
    }
    tauri_build::build()
}
