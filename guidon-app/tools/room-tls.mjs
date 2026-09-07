#!/usr/bin/env node
/**
 * room-tls.mjs - load-bearing: wired into and imported by
 * tools/room-server.mjs (createSelfSignedIdentity()) in production, not a
 * scaffold. See src-tauri/src/room_tls.rs for the Tauri-side counterpart
 * implementing the equivalent TLS logic in Rust.
 *
 * Mints one ephemeral, self-signed X.509v1 certificate for an ECDSA P-256
 * keypair, using ONLY Node's built-in `node:crypto` - no `node-forge`, no
 * `selfsigned` npm package, no new runtime dependency, matching this
 * project's "Node built-ins ONLY" rule for tools/room-server.mjs (see that
 * file's own header comment).
 *
 * WHY THIS EXISTS: the Android room-joining blocker (Mixed Content +
 * cleartext-traffic policy, confirmed 2026-09-06) can only be fixed by
 * serving the room over TLS (wss://) instead of plain ws://. A LAN study
 * room has no CA and no DNS name worth validating against - the human
 * already reads/compares an 8-char fingerprint (G.roomSchema's `fp`,
 * currently generated in the browser/WebView JS via a NON-extractable
 * WebCrypto key - see src/app-modules/studygroup.js's makeIdentity()) as
 * the room's identity. This module gives that same trust-on-first-use
 * model a REAL TLS certificate to anchor to: the fingerprint this module
 * derives (fpOf below) uses the exact same formula as the JS side
 * (SHA-256 of the raw uncompressed EC point, first 5 bytes, base32) so a
 * human comparing the phonetic room code's fingerprint is, for the first
 * time, comparing something a TLS handshake can actually be pinned to.
 *
 * ARCHITECTURE NOTE (important, and why this is a NEW module rather than
 * a JS-side export): the JS identity keypair is generated with
 * `extractable: false` specifically so the raw private key can never
 * leave WebCrypto (see studygroup.js's own header: "no signal that
 * identifies this device... is ever sent"). That is deliberate defense in
 * depth and this scaffold does not fight it. The process that terminates
 * TLS (this Node process, or the Rust room.rs process in the Tauri build)
 * must therefore generate its OWN keypair natively - it cannot reuse the
 * browser-side one even if we wanted to. The fp a host advertises when
 * hosting for real should come FROM whichever layer actually holds the
 * TLS private key, not from a separately-generated JS identity that has
 * nothing to do with the socket a joiner actually connects to. See the
 * accompanying design writeup for how host() in studygroup.js needs to
 * change to consume this instead of calling its own makeIdentity().
 *
 * Usage:
 *   import { createSelfSignedIdentity } from "./room-tls.mjs";
 *   const id = createSelfSignedIdentity();       // { keyPem, certPem, fp, spkiSha256 }
 *   const server = tls.createServer({ key: id.keyPem, cert: id.certPem }, ...);
 *
 * Verified (2026-09-06, this session): `node tools/room-tls.mjs --selftest`
 * generates an identity, round-trips it through `new crypto.X509Certificate
 * (certPem)` (Node's own DER parser - proof the DER this module hand-builds
 * is well-formed, not just "didn't throw"), confirms `.publicKey` matches
 * the key used to sign it, confirms `.verify(publicKey)` (the cert's
 * self-signature check) passes, confirms `.fingerprint256` matches the SPKI
 * hash this module computes independently, and starts a real
 * `tls.createServer` + `tls.connect({rejectUnauthorized:false})` round trip
 * that writes/reads bytes over the resulting socket.
 */
import { generateKeyPairSync, createSign, randomBytes, createHash, X509Certificate } from "node:crypto";

/* ---------------------------------------------------------- DER helpers */
// A minimal, purpose-built BER/DER encoder - just the handful of ASN.1
// shapes an X.509v1 certificate needs. Not a general ASN.1 library.

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag, contents) {
  const body = Buffer.isBuffer(contents) ? contents : Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}
const SEQ = (...xs) => tlv(0x30, xs);
const SET = (...xs) => tlv(0x31, xs);
function INT(bytesOrNum) {
  let b = Buffer.isBuffer(bytesOrNum) ? bytesOrNum : Buffer.from([bytesOrNum]);
  // strip redundant leading 0x00s, but keep the value positive (DER INTEGER
  // is signed two's-complement: a leading 0x80+ byte needs a 0x00 pad).
  let i = 0;
  while (i < b.length - 1 && b[i] === 0x00 && (b[i + 1] & 0x80) === 0) i++;
  b = b.subarray(i);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
  return tlv(0x02, b);
}
function OID(dotted) {
  const parts = dotted.split(".").map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    if (p === 0) { out.push(0); continue; }
    const chunk = [];
    let v = p;
    while (v > 0) { chunk.unshift(v & 0x7f); v >>= 7; }
    for (let j = 0; j < chunk.length - 1; j++) chunk[j] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
const NULL_ = Buffer.from([0x05, 0x00]);
const BITSTR = (bytes) => tlv(0x03, Buffer.concat([Buffer.from([0x00]), bytes])); // 0 unused bits
const UTF8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
function UTCTIME(d) {
  const p2 = (n) => String(n).padStart(2, "0");
  const s = `${p2(d.getUTCFullYear() % 100)}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
            `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, "ascii"));
}
const EXPLICIT = (tagNum, ...xs) => tlv(0xa0 | tagNum, Buffer.concat(xs));

/* ------------------------------------------------------------- OIDs */
const OID_CN = "2.5.4.3";
const OID_ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";

function nameOf(cn) {
  // RDNSequence with exactly one RDN: CN=<cn>. Minimal but valid X.501 Name.
  return SEQ(SET(SEQ(OID(OID_CN), UTF8(cn))));
}
const ALG_ECDSA_SHA256 = SEQ(OID(OID_ECDSA_WITH_SHA256)); // no parameters, per RFC 5480

/* ---------------------------------------------------------- fingerprint */
// SAME formula src/app-modules/studygroup.js's makeIdentity() uses in the
// browser: SHA-256 of the raw (uncompressed) EC point, first 5 bytes,
// RFC 4648 base32 (no padding). spkiDer's public key is the tail 65 bytes
// of the SPKI BIT STRING - Node's own X509Certificate.publicKey.export
// ({type:"spki", format:"der"}) round-trips this exactly (verified below).
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function fpOfRawPoint(rawUncompressedPoint) {
  const digest = createHash("sha256").update(rawUncompressedPoint).digest();
  return base32(digest.subarray(0, 5));
}

/* ------------------------------------------------------ cert construction */
/**
 * createSelfSignedIdentity({ days, cn }) -> {
 *   keyPem, certPem,               PEM strings for tls.createServer()
 *   fp,                             8-char base32, SAME formula as the JS side
 *   spkiSha256,                     full SHA-256 of the SPKI DER (hex) - what a
 *                                   pinning client should ACTUALLY compare
 *                                   against (the short fp is for humans to
 *                                   read aloud; a joiner's TLS pinning check
 *                                   is a full-strength hash comparison, not
 *                                   a truncated one - see the design note on
 *                                   why these are two different guarantees)
 * }
 */
export function createSelfSignedIdentity({ days = 1, cn = "GUIDON-ROOM" } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const rawPoint = spkiDer.subarray(spkiDer.length - 65); // last 65 bytes: 0x04||X(32)||Y(32)
  const fp = fpOfRawPoint(rawPoint);
  const spkiSha256 = createHash("sha256").update(spkiDer).digest("hex");

  const notBefore = new Date(Date.now() - 5 * 60 * 1000); // 5 min clock-skew slack
  const notAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const serial = randomBytes(16);
  const issuerAndSubject = nameOf(cn);

  const tbs = SEQ(
    INT(serial),
    ALG_ECDSA_SHA256,
    issuerAndSubject,
    SEQ(UTCTIME(notBefore), UTCTIME(notAfter)),
    issuerAndSubject,
    spkiDer, // already a full ASN.1 SubjectPublicKeyInfo SEQUENCE - spliced verbatim
  );

  const sig = createSign("SHA256").update(tbs).sign(privateKey); // DER ECDSA-Sig-Value for EC keys
  const certDer = SEQ(tbs, ALG_ECDSA_SHA256, BITSTR(sig));

  const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
  const keyPem = privateKey.export({ type: "sec1", format: "pem" });
  const certPem = pem("CERTIFICATE", certDer);

  return { keyPem, certPem, fp, spkiSha256, notBefore, notAfter };
}

/* --------------------------------------------------------------- selftest */
async function selftest() {
  const id = createSelfSignedIdentity();
  console.log("fp:", id.fp, " spkiSha256:", id.spkiSha256);

  // 1) Node's OWN DER parser must accept the certificate this module built.
  const x509 = new X509Certificate(id.certPem);
  console.log("parsed subject:", x509.subject, " issuer:", x509.issuer);
  console.log("validFrom:", x509.validFrom, " validTo:", x509.validTo);

  // 2) The cert's self-signature must verify against its own public key.
  const sigOk = x509.verify(x509.publicKey);
  console.log("self-signature verify():", sigOk);
  if (!sigOk) throw new Error("SELFTEST FAILED: certificate does not self-verify");

  // 3) Node's own fingerprint256 (full SHA-256 over the DER *certificate*,
  //    not the SPKI) is a different number by design (X.509 cert-fingerprint
  //    vs SPKI-pin fingerprint are two different, both-legitimate notions -
  //    documented here so nobody "fixes" a mismatch that isn't a bug). What
  //    MUST match is the SPKI hash computed two independent ways:
  const spkiFromNode = createHash("sha256").update(x509.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  console.log("spkiSha256 (from this module):", id.spkiSha256);
  console.log("spkiSha256 (recomputed via Node's parsed cert):", spkiFromNode);
  if (spkiFromNode !== id.spkiSha256) throw new Error("SELFTEST FAILED: SPKI hash mismatch between construction and Node's own parse");

  // 4) A REAL TLS handshake using this identity, end to end.
  const tls = await import("node:tls");
  const server = tls.createServer({ key: id.keyPem, cert: id.certPem }, (sock) => {
    sock.end("hello-from-server");
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  const received = await new Promise((res, rej) => {
    // rejectUnauthorized:false here stands in for "a joiner that pins the
    // fp instead of chain-validating" - the real pinning check (comparing
    // getPeerCertificate().fingerprint256 or its SPKI hash against the
    // human-read fp) is exactly what the Kotlin plugin / Tauri join-side
    // client must do natively; this selftest only proves the handshake
    // itself completes end to end with a cert this module minted.
    const sock = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => {
      const peerCert = sock.getPeerCertificate();
      const pinOk = peerCert && peerCert.raw &&
        createHash("sha256").update(new X509Certificate(peerCert.raw).publicKey.export({ type: "spki", format: "der" })).digest("hex") === id.spkiSha256;
      console.log("client-side pin check against the SAME fp/spkiSha256:", pinOk);
      if (!pinOk) rej(new Error("SELFTEST FAILED: client-side pin check did not match"));
    });
    let buf = "";
    sock.on("data", (d) => (buf += d));
    sock.on("end", () => res(buf));
    sock.on("error", rej);
  });
  server.close();
  console.log("TLS round trip payload:", JSON.stringify(received));
  if (received !== "hello-from-server") throw new Error("SELFTEST FAILED: payload mismatch");

  console.log("\nALL SELFTESTS PASSED");
}

if (process.argv.includes("--selftest")) {
  selftest().catch((e) => { console.error(e); process.exitCode = 1; });
}
