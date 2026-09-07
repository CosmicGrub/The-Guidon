//! R-ROOM native TLS identity (room-tls-and-discovery-pitch.md Section 1):
//! the pinned self-signed WSS design for the confirmed Android room-join
//! blocker (Mixed Content + OS cleartext policy, measured on real hardware
//! 2026-09-06). Ported FAITHFULLY from the already-verified standalone spike
//! (src-tauri/spikes/room_tls_spike/src/main.rs) - not redesigned - and
//! matching tools/room-tls.mjs / studygroup.js's makeIdentity() bit for bit:
//!
//!   fp         = base32(SHA-256(raw uncompressed EC point))[0:5]
//!   spkiSha256 = hex(SHA-256(full SPKI DER))
//!
//! **The one lesson the spike's own header insists on carrying over
//! verbatim** (measured, not assumed - an earlier version of that spike
//! minted a pin one way and verified it another, and rejected its own valid
//! certificate): `rcgen::KeyPair`'s own key-export function and a LATER
//! re-parse of the minted certificate by an X.509 parser are not guaranteed
//! to agree byte for byte. So `generate_identity()` below derives BOTH `fp`
//! and `spkiSha256` by re-parsing our OWN freshly-minted `cert_der` with
//! `x509_parser::parse_x509_certificate` - the exact same extraction
//! `verify_pin()` below applies to a PEER's certificate during the TLS
//! handshake. Whatever function computes the fingerprint a human reads and
//! whatever function checks a peer's certificate against it is the same
//! function, on both ends, always.
//!
//! SHA-256 and hex/base32 encoding are hand-rolled here rather than adding
//! `sha2`/`hex`/`base32` as new crates: room.rs already hand-rolls SHA-1 and
//! base64 for the WebSocket handshake for the identical reason (see that
//! file's own header - "no tokio-tungstenite, no sha1 crate, no new
//! dependency of any kind"), and room-tls-and-discovery-pitch.md Section 1.3
//! step 2 names exactly five new crates for this stage: `rcgen`, `rustls`,
//! `tokio-rustls`, `rustls-pki-types`, `x509-parser` - not `sha2`, even
//! though that crate happens to already be resolved transitively in
//! Cargo.lock for unrelated reasons (confirmed - it is not something this
//! module was asked to depend on directly, so it doesn't).

use std::sync::Arc;

use rcgen::{CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256};
use rustls_pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

/* --------------------------------------------------------------- hashing */

/// SHA-256 (FIPS 180-4), for the SPKI pin/fingerprint only. Tested against
/// the standard NIST vectors below - this is new code (the spike used the
/// `sha2` crate; this project's dependency list for this stage does not
/// include it - see this file's header), so it earns its own vectors the
/// same way room.rs's hand-rolled `sha1` is tested against RFC ones.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
        0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in w.iter_mut().enumerate().take(16) {
            *word = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

/// Lowercase hex, matching Node's `Buffer.toString("hex")` /
/// `createHash(...).digest("hex")` - what `spkiSha256` is compared against.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// RFC 4648 base32, no padding - the SAME alphabet and algorithm as
/// tools/room-tls.mjs's `base32()` and the standalone spike's `base32_5()`.
/// For exactly 5 input bytes (40 bits) this always emits exactly 8
/// characters with no remainder, matching `room::is_fingerprint`'s
/// 8-char/A-Z2-7 shape.
pub fn base32(bytes: &[u8]) -> String {
    const B32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits: u32 = 0;
    let mut value: u32 = 0;
    let mut out = String::new();
    for &b in bytes {
        value = (value << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(B32[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(B32[((value << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// SAME formula as studygroup.js's `makeIdentity()` / room-tls.mjs's
/// `fpOfRawPoint()`: base32(SHA-256(raw uncompressed EC point))[0:5].
pub fn fp_of_raw_point(raw_point: &[u8]) -> String {
    base32(&sha256(raw_point)[..5])
}

/* ------------------------------------------------------------- identity */

/// One ephemeral, self-signed ECDSA P-256 TLS identity, minted once per
/// `room_start()` call (matching room-server.mjs's `startRoomServer()`
/// choice and its own documented reasoning: every other piece of a room's
/// state - the listener, the relay, the keep-awake handle - is already
/// scoped one-per-`room_start`, never shared across rooms or re-created
/// mid-room, so a per-room identity is the shape-consistent choice; a
/// finer-grained per-connection identity would be undocumented extra
/// surface with no current consumer).
pub struct Identity {
    /// DER-encoded self-signed certificate (rustls `CertificateDer`).
    pub cert_der: Vec<u8>,
    /// PKCS#8 DER-encoded private key (rustls `PrivatePkcs8KeyDer`).
    pub key_der: Vec<u8>,
    /// 8-char base32, the human-comparable "proof of place" - same formula
    /// as the JS-side `fp` (see this module's header). NOT the pinning
    /// comparison itself (see `spki_sha256` below and the pitch doc's
    /// Section 1.4: "the actual pinning comparison must be the full
    /// SHA-256(SPKI) hex, never the truncated base32").
    pub fp: String,
    /// Full SHA-256 of the SPKI DER, lowercase hex - what a joiner's
    /// pinning check must ACTUALLY compare against.
    pub spki_sha256: String,
}

/// Mints one identity - ported verbatim from the spike's
/// `generate_identity()` (src-tauri/spikes/room_tls_spike/src/main.rs),
/// itself independently verified this session (case 1/case 2 selftest:
/// correct pin accepted, wrong pin rejected).
pub fn generate_identity() -> Identity {
    let key_pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).expect("guidon room_tls: generate ECDSA P-256 keypair");
    let params = CertificateParams::new(Vec::<String>::new()).expect("guidon room_tls: empty-SAN cert params");
    let cert = params.self_signed(&key_pair).expect("guidon room_tls: self-sign certificate");
    let cert_der: CertificateDer<'static> = cert.der().clone();
    let key_der = key_pair.serialize_der(); // PKCS#8 DER

    // IMPORTANT (see this file's header): derive fp/spkiSha256 by
    // re-parsing OUR OWN just-minted cert_der with x509-parser - the SAME
    // extraction `verify_pin()` below applies to a peer's certificate -
    // rather than trusting rcgen's own key-export functions to agree
    // byte-for-byte with a later re-parse. Measured: they do not.
    let (_, parsed) = x509_parser::parse_x509_certificate(cert_der.as_ref()).expect("guidon room_tls: parse our own freshly-minted certificate");
    let spki_raw = parsed.public_key().raw.to_vec();
    let spki_sha256 = hex(&sha256(&spki_raw));
    let raw_point = &spki_raw[spki_raw.len().saturating_sub(65)..];
    let fp = fp_of_raw_point(raw_point);

    Identity { cert_der: cert_der.as_ref().to_vec(), key_der, fp, spki_sha256 }
}

/// The crypto provider `rustls::ServerConfig`/`ClientConfig` need is a
/// process-global, install-once resource; a second `room_start()` in the
/// same process (or a test suite running many) must not panic trying to
/// install it twice, so the "already installed" case is silently accepted
/// - the provider installed the first time is exactly the same one
/// (`ring`, the only crypto backend this project's rustls features enable).
pub fn ensure_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// Builds the server-side TLS config for one identity - `with_no_client_auth`
/// because a joiner authenticates the ROOM (pins its cert), not the other
/// way around; no CA, no hostname check, matching the spike exactly.
pub fn server_config(identity: &Identity) -> Result<rustls::ServerConfig, rustls::Error> {
    ensure_crypto_provider();
    let cert = CertificateDer::from(identity.cert_der.clone());
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(identity.key_der.clone()));
    rustls::ServerConfig::builder().with_no_client_auth().with_single_cert(vec![cert], key)
}

/// Wraps `server_config()` in a ready-to-use `TlsAcceptor`.
pub fn acceptor(identity: &Identity) -> Result<tokio_rustls::TlsAcceptor, rustls::Error> {
    Ok(tokio_rustls::TlsAcceptor::from(Arc::new(server_config(identity)?)))
}

/// Extracts the SAME SPKI-DER bytes `generate_identity()` hashes for
/// `spki_sha256`, from an arbitrary (peer) end-entity certificate. A
/// pinning client (test harness here; the real Kotlin/Tauri-native join
/// clients in a later pitch-doc stage) computes `hex(sha256(spki_der_of
/// (peer_cert)))` and compares it to the `spkiSha256` it already holds
/// (from the join link / mDNS TXT record / human-read `fp`) - see this
/// file's header for why this MUST be the same extraction on both ends.
pub fn spki_sha256_of(cert_der: &[u8]) -> Result<String, String> {
    let (_, parsed) = x509_parser::parse_x509_certificate(cert_der).map_err(|e| format!("unparseable certificate: {e}"))?;
    Ok(hex(&sha256(parsed.public_key().raw)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hexed(b: &[u8]) -> String {
        hex(b)
    }

    #[test]
    fn sha256_matches_the_nist_vectors() {
        assert_eq!(hexed(&sha256(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(hexed(&sha256(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(hexed(&sha256(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
        let million_a = vec![b'a'; 1_000_000];
        assert_eq!(hexed(&sha256(&million_a)), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    }

    #[test]
    fn base32_matches_rfc_4648_no_padding() {
        // RFC 4648 sec. 10 test vectors, padding stripped (this project's
        // base32 never pads - fp derivation only ever feeds it 5 bytes).
        assert_eq!(base32(b""), "");
        assert_eq!(base32(b"f"), "MY");
        assert_eq!(base32(b"fo"), "MZXQ");
        assert_eq!(base32(b"foo"), "MZXW6");
        assert_eq!(base32(b"foob"), "MZXW6YQ");
        assert_eq!(base32(b"fooba"), "MZXW6YTB");
        assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
    }

    #[test]
    fn generated_identity_is_internally_consistent_and_fp_shaped() {
        let id = generate_identity();
        assert_eq!(id.fp.len(), 8);
        assert!(id.fp.bytes().all(|b| b.is_ascii_uppercase() || (b'2'..=b'7').contains(&b)), "fp {:?} must be room::is_fingerprint-shaped", id.fp);
        assert_eq!(id.spki_sha256.len(), 64, "full SHA-256 hex, never truncated");
        assert!(id.spki_sha256.bytes().all(|b| b.is_ascii_hexdigit()));
        // The SAME re-parse extraction, applied to our own minted cert
        // through the peer-facing helper, must reproduce spki_sha256 -
        // proving fp/spkiSha256 and a peer-cert pin check share one function.
        assert_eq!(spki_sha256_of(&id.cert_der).unwrap(), id.spki_sha256);
        // Two identities never collide in practice (fresh keypair each time).
        let id2 = generate_identity();
        assert_ne!(id.fp, id2.fp);
        assert_ne!(id.spki_sha256, id2.spki_sha256);
    }

    #[test]
    fn server_config_builds_from_a_freshly_minted_identity() {
        let id = generate_identity();
        assert!(server_config(&id).is_ok());
        assert!(acceptor(&id).is_ok());
    }
}
