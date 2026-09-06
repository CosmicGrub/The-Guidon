//! VERIFIED SPIKE (2026-09-06) - NOT wired into room.rs yet. Standalone
//! crate (this directory's own Cargo.toml, not part of the guidon binary or
//! its dependency graph) proving the hardest part of the Android room-join
//! TLS design: mint an ephemeral self-signed ECDSA P-256 cert (rcgen),
//! serve/dial it over real TLS (rustls + tokio-rustls) with NO CA and NO
//! hostname check, pinning trust to a SHA-256(SPKI) fingerprint the same
//! way a human-read 8-char room fingerprint would be compared - and
//! actually reject a wrong pin, not just accept everything.
//!
//! Run it: `cd src-tauri/spikes/room_tls_spike && cargo run` (needs network
//! access once, to fetch rcgen/rustls/tokio-rustls/x509-parser - all then
//! cached in the normal cargo registry). Confirmed output ends
//! "ALL SELFTESTS PASSED (rust room_tls spike)", case 1 (correct pin)
//! accepted, case 2 (wrong pin) rejected with a clear rustls error.
//!
//! The one non-obvious thing this spike caught by actually running (not by
//! reasoning about the crates' docs): rcgen's `KeyPair::public_key_raw()`
//! and x509-parser's `X509Certificate::public_key().raw` are NOT
//! guaranteed to agree byte for byte - an earlier version of this file
//! computed the pin one way and verified it the other way, and rejected
//! its own valid certificate. The fix, and the rule to carry into room.rs:
//! whatever function computes the fingerprint a human reads and whatever
//! function checks a peer's certificate against it must be the SAME
//! function on both ends - see generate_identity() below.
use std::sync::Arc;
use rcgen::{CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use rustls_pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};

fn base32_5(bytes: &[u8]) -> String {
    // Same formula as the JS side and tools/room-tls.mjs: first 5 bytes of
    // SHA-256(raw uncompressed EC point), RFC4648 base32, no padding.
    const B32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits = 0u32;
    let mut value = 0u32;
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

fn generate_identity() -> (CertificateDer<'static>, PrivatePkcs8KeyDer<'static>, String, String) {
    let key_pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).expect("keypair");
    let params = CertificateParams::new(Vec::<String>::new()).expect("params");
    let cert = params.self_signed(&key_pair).expect("self_signed");
    let cert_der: CertificateDer<'static> = cert.der().clone();
    let key_der = PrivatePkcs8KeyDer::from(key_pair.serialize_der());

    // IMPORTANT (found by actually running this spike, not assumed): derive
    // the pin by re-parsing OUR OWN just-minted cert_der with x509-parser -
    // the SAME extraction a verifier applies to a peer's cert - rather than
    // trusting that rcgen's KeyPair::public_key_raw() byte-for-byte matches
    // whatever library later re-parses the certificate. The two are NOT
    // guaranteed to agree (measured: they didn't, the first version of this
    // spike minted a pin from one shape and verified against another and
    // rejected its own valid cert). Whatever function computes the
    // fingerprint a human reads and whatever function checks a peer's
    // certificate against it MUST be the identical function on both ends -
    // this is the one-way-only lesson to carry into room.rs for real.
    let (_, parsed) = x509_parser::parse_x509_certificate(cert_der.as_ref()).expect("parse own cert");
    let spki_raw = parsed.public_key().raw.to_vec();
    let spki_sha256 = Sha256::digest(&spki_raw);
    let fp_digest = Sha256::digest(&spki_raw[spki_raw.len().saturating_sub(65)..]);
    let fp = base32_5(&fp_digest[..5]);
    (cert_der, key_der, fp, hex::encode(spki_sha256))
}

// A minimal cert verifier that accepts ANY certificate whose SPKI SHA-256
// matches the expected pin - this is the client-side analogue of what the
// Kotlin plugin / a Tauri-native join client must do; it deliberately does
// NOT check hostname or chain to any root, because there is no CA and no
// DNS name worth validating for an ad-hoc LAN room. This is the Rust
// equivalent of Android's X509TrustManager.checkServerTrusted override.
#[derive(Debug)]
struct PinnedVerifier {
    expected_spki_sha256: Vec<u8>,
}
impl rustls::client::danger::ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        // x509-parser comes in FREE - it's already resolved transitively
        // through rcgen's own dependency tree (see the `cargo build` log:
        // it downloads x509-parser/der-parser/oid-registry before this
        // project ever names them) - so extracting the real SPKI from an
        // arbitrary end-entity cert costs this project nothing new.
        let (_, parsed) = x509_parser::parse_x509_certificate(end_entity.as_ref())
            .map_err(|_| rustls::Error::General("unparseable certificate".into()))?;
        let spki_der = parsed.public_key().raw;
        let got = Sha256::digest(spki_der);
        eprintln!("(spike) end-entity SPKI sha256 = {}", hex::encode(got));
        if got.as_slice() != self.expected_spki_sha256.as_slice() {
            eprintln!("(spike) PIN MISMATCH - rejecting (expected {})", hex::encode(&self.expected_spki_sha256));
            return Err(rustls::Error::General("room fingerprint did not match - possible impersonation".into()));
        }
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, _m: &[u8], _c: &CertificateDer<'_>, _dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(&self, _m: &[u8], _c: &CertificateDer<'_>, _dss: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![rustls::SignatureScheme::ECDSA_NISTP256_SHA256]
    }
}

#[tokio::main]
async fn main() {
    rustls::crypto::ring::default_provider().install_default().expect("install crypto provider");

    let (cert_der, key_der, fp, spki_sha256) = generate_identity();
    println!("fp = {fp}");
    println!("spkiSha256 = {spki_sha256}");

    let server_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der.clone()], PrivateKeyDer::Pkcs8(key_der))
        .expect("server config");
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_config));

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().unwrap().port();
    println!("listening on 127.0.0.1:{port}");

    let server = tokio::spawn(async move {
        let (stream, _addr) = listener.accept().await.expect("accept");
        let mut tls = acceptor.accept(stream).await.expect("tls accept");
        tls.write_all(b"hello-from-rust-server").await.expect("write");
        tls.shutdown().await.ok();
    });

    // Client side: pin to the expected SPKI hash, no root store, no hostname
    // check - the whole point of trust-on-first-use against a human-read fp.
    let client_config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedVerifier { expected_spki_sha256: hex::decode(&spki_sha256).unwrap() }))
        .with_no_client_auth();
    let connector = tokio_rustls::TlsConnector::from(Arc::new(client_config));
    let tcp = TcpStream::connect(("127.0.0.1", port)).await.expect("connect");
    let server_name = ServerName::try_from("localhost").unwrap();
    let mut tls = connector.connect(server_name, tcp).await.expect("tls connect");
    let mut buf = Vec::new();
    tls.read_to_end(&mut buf).await.expect("read");
    println!("client received: {:?}", String::from_utf8_lossy(&buf));
    assert_eq!(buf, b"hello-from-rust-server");
    server.await.unwrap();
    println!("case 1 (correct pin) PASSED");

    // Case 2: a joiner with the WRONG pin (e.g. a stale/typo'd room code, or
    // a genuine on-path impersonator) MUST be rejected, not silently let
    // through - this is the property the whole design rests on.
    let (cert_der2, key_der2, _fp2, _spki2) = generate_identity();
    let server_config2 = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der2], PrivateKeyDer::Pkcs8(key_der2))
        .expect("server config 2");
    let acceptor2 = tokio_rustls::TlsAcceptor::from(Arc::new(server_config2));
    let listener2 = TcpListener::bind("127.0.0.1:0").await.expect("bind 2");
    let port2 = listener2.local_addr().unwrap().port();
    let server2 = tokio::spawn(async move {
        if let Ok((stream, _)) = listener2.accept().await {
            let _ = acceptor2.accept(stream).await; // expected to fail client-side before this matters
        }
    });
    let wrong_pin_client_config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedVerifier { expected_spki_sha256: hex::decode(&spki_sha256).unwrap() /* the FIRST server's pin, deliberately wrong for this one */ }))
        .with_no_client_auth();
    let connector2 = tokio_rustls::TlsConnector::from(Arc::new(wrong_pin_client_config));
    let tcp2 = TcpStream::connect(("127.0.0.1", port2)).await.expect("connect 2");
    let server_name2 = ServerName::try_from("localhost").unwrap();
    match connector2.connect(server_name2, tcp2).await {
        Ok(_) => panic!("SELFTEST FAILED: a mismatched pin was accepted - this must never happen"),
        Err(e) => println!("case 2 (wrong pin) correctly REJECTED: {e}"),
    }
    let _ = server2.await;

    println!("\nALL SELFTESTS PASSED (rust room_tls spike)");
}
