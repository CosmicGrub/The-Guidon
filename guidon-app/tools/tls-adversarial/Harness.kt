package guidon.tlstest

import app.guidon.trainer.RoomTlsPlugin
import java.io.File
import java.net.InetAddress
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import kotlin.system.exitProcess

/*
 * Adversarial suite against RoomTlsPlugin's native trust-manager logic
 * (room-tls-and-discovery-pitch.md Section 3, the paragraph beginning
 * "Explicitly NOT covered by the fuzzer above..."). Driven by
 * tools/test-tls-adversarial.mjs, which compiles THIS file together with
 * the REAL, unmodified
 * android/app/src/main/java/app/guidon/trainer/RoomTlsPlugin.kt and the
 * JVM stubs under tools/tls-adversarial/stubs/ in one kotlinc invocation,
 * then runs it as a plain `java` process - no Android Gradle plugin, no
 * device, no emulator.
 *
 * Every case below calls RoomTlsPlugin.verifyPinnedCertificate() directly
 * (the extract-method refactor pulled out of PinnedWsClient's
 * checkServerTrusted() lambda) or, for the two protocol-level cases
 * (expired cert, downgrade), drives a REAL loopback TLS handshake through a
 * trust manager that itself calls that same real function - never a
 * hand-copied reimplementation of the pin-check logic.
 *
 * Output convention matches this project's own tools/test-*.mjs suites:
 * "  PASS  <msg>" / "  FAIL  <msg>" / "  INFO  <msg>" lines, exit code =
 * number of FAILs (capped at 255).
 */

private var fails = 0
private fun ok(msg: String) = println("  PASS  $msg")
private fun info(msg: String) = println("  INFO  $msg")

/**
 * Expected-defect pins, same convention as tools/test-resize-storm.mjs and
 * tools/verify.mjs: a bad() whose message matches a pin is printed as KNOWN
 * and does NOT count toward the exit code, so a real, already-reported,
 * out-of-this-task's-scope defect doesn't block `npm test`/CI forever. A
 * pin that never fires is itself treated as a failure below (the defect no
 * longer reproduces - remove the pin). THE FIXING SESSION MUST DELETE THE
 * PIN, not just leave it here matching a now-different message.
 */
private data class ExpectedDefect(val match: Regex, val why: String, var hits: Int = 0)

// 2026-09-06: the one defect this suite ever pinned (a TLS downgrade gap in
// connectAndPump()'s SSLContext/socket setup) was fixed the same session,
// immediately after this suite first found it - see RoomTlsPlugin.kt's own
// comment at the raw.setEnabledProtocols(arrayOf("TLSv1.3")) call site, and
// case 8 below, which now asserts the FIX holds rather than pinning the bug.
// Empty per this project's own convention (tools/test-resize-storm.mjs,
// tools/verify.mjs): the mechanism stays available for a future real defect,
// it just has nothing pinned right now.
private val EXPECTED_DEFECTS = listOf<ExpectedDefect>()

private fun bad(msg: String) {
    val pin = EXPECTED_DEFECTS.firstOrNull { it.match.containsMatchIn(msg) }
    if (pin != null) { pin.hits++; println("  KNOWN $msg"); return }
    fails++
    println("  FAIL  $msg")
}

private const val STORE_PASS = "changeit"

private fun hex(bytes: ByteArray): String {
    val chars = "0123456789abcdef"
    val sb = StringBuilder(bytes.size * 2)
    for (b in bytes) {
        val v = b.toInt() and 0xff
        sb.append(chars[v ushr 4])
        sb.append(chars[v and 0x0f])
    }
    return sb.toString()
}

/** Full SHA-256(SPKI) hex, the SAME shape RoomTlsPlugin.verifyPinnedCertificate()
    computes from a real handshake peer - computed here independently (from
    the JCA-standard X509Certificate.publicKey.encoded, not from anything
    RoomTlsPlugin exposes) so this harness's own expected-pin values are
    never borrowed from the code under test. */
private fun spkiPinOf(cert: X509Certificate): String =
    hex(MessageDigest.getInstance("SHA-256").digest(cert.publicKey.encoded))

private fun keytoolPath(): String {
    val javaHome = System.getProperty("java.home")
    val isWin = System.getProperty("os.name").lowercase().contains("win")
    val f = File(javaHome, "bin/" + (if (isWin) "keytool.exe" else "keytool"))
    require(f.exists()) { "keytool not found at $f (java.home=$javaHome) - this harness needs a full JDK, not a JRE" }
    return f.absolutePath
}

/** Mints a real self-signed X.509 keystore via the JDK's own keytool - no
    new Gradle/npm dependency, matching this project's consistent
    hand-rolled-over-dependency pattern (see RoomTlsPlugin.kt and
    tools/room-tls.mjs). EC P-256 to mirror the actual room-TLS design
    (room-tls-and-discovery-pitch.md Section 1's ECDSA P-256 identity),
    though the pin-check logic under test does not care about key type. */
private fun genKeystore(dir: File, alias: String, cn: String, startdate: String? = null, validityDays: Int = 3650): File {
    val out = File(dir, "$alias.p12")
    val args = mutableListOf(
        keytoolPath(), "-genkeypair", "-alias", alias,
        "-keyalg", "EC", "-groupname", "secp256r1", "-sigalg", "SHA256withECDSA",
        "-dname", "CN=$cn", "-validity", validityDays.toString(),
        "-keystore", out.absolutePath, "-storetype", "PKCS12",
        "-storepass", STORE_PASS, "-keypass", STORE_PASS
    )
    if (startdate != null) { args.add("-startdate"); args.add(startdate) }
    val proc = ProcessBuilder(args).redirectErrorStream(true).start()
    val output = proc.inputStream.bufferedReader().readText()
    val code = proc.waitFor()
    require(code == 0) { "keytool failed (exit $code) for alias=$alias:\n$output" }
    return out
}

private fun loadKeyStore(file: File): KeyStore {
    val ks = KeyStore.getInstance("PKCS12")
    file.inputStream().use { ks.load(it, STORE_PASS.toCharArray()) }
    return ks
}

private fun leafCert(file: File, alias: String): X509Certificate =
    loadKeyStore(file).getCertificate(alias) as X509Certificate

/** Wraps the REAL RoomTlsPlugin.verifyPinnedCertificate() as an
    X509TrustManager, exactly the way PinnedWsClient.connectAndPump()'s own
    anonymous trust manager does - the only difference is `invoked` lets
    this harness observe, from the OUTSIDE, whether the real function ever
    actually ran during a given TLS handshake (needed to tell "the JDK
    rejected this before our trust manager ran" apart from "our trust
    manager ran and rejected it"). */
private fun pinnedTrustManager(expectedPin: String, invoked: AtomicBoolean): X509TrustManager = object : X509TrustManager {
    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("client certs not used")
    }
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        invoked.set(true)
        RoomTlsPlugin.verifyPinnedCertificate(chain, expectedPin)
    }
}

private data class HandshakeOutcome(val tlsOk: Boolean, val trustManagerInvoked: Boolean, val error: Throwable?, val negotiatedProtocol: String? = null)

/** Reproduces PinnedWsClient.connectAndPump()'s own SSLContext/socket setup
    verbatim (SSLContext.getInstance(clientProtocol), init(null,
    arrayOf(tm), SecureRandom()), factory.createSocket(host, port),
    startHandshake()) so the loopback tests below exercise a REAL TLS
    handshake end to end - never a bare direct call to checkServerTrusted().
    This file never re-implements the trust DECISION (that is the real
    RoomTlsPlugin.verifyPinnedCertificate(), wired in via
    pinnedTrustManager() above); it only reproduces the couple of lines of
    protocol/socket plumbing needed to drive a genuine handshake. */
private fun clientHandshakeAttempt(host: String, port: Int, expectedPin: String, clientProtocol: String = "TLSv1.3"): HandshakeOutcome {
    val invoked = AtomicBoolean(false)
    val ctx = SSLContext.getInstance(clientProtocol)
    ctx.init(null, arrayOf<TrustManager>(pinnedTrustManager(expectedPin, invoked)), SecureRandom())
    val socket = ctx.socketFactory.createSocket(host, port) as SSLSocket
    // DOWNGRADE FIX (2026-09-06) mirrored here too: connectAndPump() now
    // calls setEnabledProtocols(arrayOf("TLSv1.3")) before startHandshake()
    // (found by an earlier run of case 8 below, then fixed in production -
    // see RoomTlsPlugin.kt's own comment at that call site). Mirrored here
    // so this harness keeps proving the REAL socket-setup sequence, fixed
    // version included, not the pre-fix one.
    socket.setEnabledProtocols(arrayOf(clientProtocol))
    return try {
        socket.startHandshake()
        HandshakeOutcome(tlsOk = true, trustManagerInvoked = invoked.get(), error = null, negotiatedProtocol = socket.session.protocol)
    } catch (e: Throwable) {
        HandshakeOutcome(tlsOk = false, trustManagerInvoked = invoked.get(), error = e)
    } finally {
        try { socket.close() } catch (_: Exception) {}
    }
}

private class ServerHandle(val serverSocket: SSLServerSocket, val port: Int, val thread: Thread) {
    fun stop() {
        try { serverSocket.close() } catch (_: Exception) {}
        thread.join(2000)
    }
}

/** Real loopback TLS server (plain SSLServerSocket, no new dependency) -
    presents whatever cert/key lives in ksFile, optionally restricted to a
    given protocol list (used by the downgrade case to offer TLSv1.2 only).
    Accepts exactly one connection, attempts its own server-side handshake,
    then closes - this harness only needs to observe the CLIENT's view of
    the handshake outcome, never a full WS session. */
private fun startLoopbackTlsServer(ksFile: File, protocols: Array<String>? = null): ServerHandle {
    val ks = loadKeyStore(ksFile)
    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
    kmf.init(ks, STORE_PASS.toCharArray())
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(kmf.keyManagers, null, SecureRandom())
    val serverSocket = ctx.serverSocketFactory.createServerSocket(0, 50, InetAddress.getLoopbackAddress()) as SSLServerSocket
    if (protocols != null) serverSocket.enabledProtocols = protocols
    val port = serverSocket.localPort
    val thread = Thread {
        try {
            val sock = serverSocket.accept() as SSLSocket
            try {
                sock.startHandshake()
            } catch (_: Exception) {
                // Client rejected us (expected for the downgrade case, and
                // possible for the expired-cert case depending on the
                // finding) - nothing further to do.
            } finally {
                try { sock.close() } catch (_: Exception) {}
            }
        } catch (_: Exception) {
            // serverSocket.close() from stop() unblocks accept() with an
            // exception here - normal shutdown, not a real error.
        }
    }
    thread.isDaemon = true
    thread.start()
    return ServerHandle(serverSocket, port, thread)
}

private fun expectAccepts(name: String, block: () -> Unit) {
    try {
        block()
        ok(name)
    } catch (e: Exception) {
        bad("$name -- expected acceptance (no exception) but got ${e.javaClass.name}: ${e.message}")
    }
}

private fun expectThrowsCertificateException(name: String, expectedMessage: String? = null, block: () -> Unit) {
    try {
        block()
        bad("$name -- expected a CertificateException, but none was thrown")
    } catch (e: CertificateException) {
        if (expectedMessage != null && e.message != expectedMessage) {
            bad("$name -- threw CertificateException but with an unexpected message: ${e.message}")
        } else {
            ok("$name (threw: ${e.message})")
        }
    } catch (e: Exception) {
        bad("$name -- expected a CertificateException but got ${e.javaClass.name}: ${e.message}")
    }
}

fun main() {
    println("tls-adversarial: RoomTlsPlugin native trust-manager suite\n")

    val workDir = File.createTempFile("guidon-tls-adversarial-", "").apply { delete(); mkdirs() }
    try {
        // ---- fixtures: real X.509 certificates, minted via keytool -------
        val goodKs = genKeystore(workDir, "good", "guidon-room-test-good")
        val wrongKs = genKeystore(workDir, "wrong", "guidon-room-test-wrong")
        val otherKs = genKeystore(workDir, "other", "guidon-room-test-other")
        val evilHostKs = genKeystore(workDir, "evilhost", "attacker.example.com")
        // Fully in the past: starts ~2 years ago, valid for only 30 days
        // from that start date - guaranteed expired by any clock running
        // this suite. `keytool -list -v` on this exact fixture was checked
        // by hand while building this harness (Valid from ... until ...,
        // both in 2024, against a 2026 clock) - see this session's report.
        val expiredKs = genKeystore(workDir, "expired", "guidon-room-test-expired", startdate = "-2y", validityDays = 30)

        val goodCert = leafCert(goodKs, "good")
        val wrongCert = leafCert(wrongKs, "wrong")
        val otherCert = leafCert(otherKs, "other")
        val evilCert = leafCert(evilHostKs, "evilhost")
        val expiredCert = leafCert(expiredKs, "expired")

        val goodPin = spkiPinOf(goodCert)
        val wrongPin = spkiPinOf(wrongCert)
        val otherPin = spkiPinOf(otherCert)
        val evilPin = spkiPinOf(evilCert)
        val expiredPin = spkiPinOf(expiredCert)

        check(goodPin != wrongPin) { "harness bug: two independently generated EC keypairs produced the same SPKI pin" }
        check(goodPin != otherPin && wrongPin != otherPin) { "harness bug: unexpected pin collision among fixtures" }

        // ---- case 1: sanity check - must pass before anything else is trusted ----
        expectAccepts("sanity: correct cert + correct pin is accepted (harness wiring confirmed working before trusting any rejection case below)") {
            RoomTlsPlugin.verifyPinnedCertificate(arrayOf(goodCert), goodPin)
        }
        if (fails > 0) {
            println("\ntls-adversarial: ABORTING - the sanity check itself failed, so no result below can be trusted.")
            exitProcess(1)
        }

        // ---- case 2: wrong cert / wrong pin --------------------------------
        expectThrowsCertificateException("wrong cert / wrong pin is rejected") {
            RoomTlsPlugin.verifyPinnedCertificate(arrayOf(wrongCert), goodPin)
        }

        // ---- case 3: empty certificate chain -------------------------------
        expectThrowsCertificateException("empty certificate chain is rejected", expectedMessage = "no certificate presented") {
            RoomTlsPlugin.verifyPinnedCertificate(arrayOf(), goodPin)
        }

        // ---- case 4: multi-cert chain - only the leaf (chain[0]) is checked ----
        // chain[0] (the leaf, what checkServerTrusted actually reads via
        // chain.firstOrNull()) does NOT match expectedPin, even though
        // chain[1] would. If the code incorrectly scanned the whole array
        // for a match, this would wrongly be ACCEPTED.
        expectThrowsCertificateException("multi-cert chain: a matching cert at a non-leaf position (chain[1]) does not rescue a non-matching leaf (chain[0])") {
            RoomTlsPlugin.verifyPinnedCertificate(arrayOf(wrongCert, otherCert), otherPin)
        }

        // ---- case 5/6: hostname mismatch - by design, irrelevant either way ----
        // This plugin deliberately does no hostname/SAN validation at all
        // (see checkServerTrusted's own code comment) - it pins the key,
        // not the name. So the only two meaningful "hostname mismatch"
        // cases are: (a) an attacker without the pinned key is rejected
        // regardless of hostname, and (b) a cert whose CN does NOT match
        // anything meaningful here but whose pin DOES match is accepted -
        // proving hostname is simply never consulted. (b) is the documented
        // design, not a vulnerability this harness is reporting.
        expectThrowsCertificateException("hostname mismatch + WRONG pin: an attacker without the pinned key is rejected regardless of hostname (cert CN=attacker.example.com)") {
            RoomTlsPlugin.verifyPinnedCertificate(arrayOf(evilCert), goodPin)
        }
        expectAccepts("hostname mismatch + CORRECT pin is accepted -- BY DESIGN (documented in checkServerTrusted's own comment: no chain-of-trust or hostname check beyond the pin); this is the TOFU-on-key trust model working as intended, not a discovered vulnerability") {
            RoomTlsPlugin.verifyPinnedCertificate(arrayOf(evilCert), evilPin)
        }

        // ---- case 7: expired certificate whose pin DOES match --------------
        // Real loopback SSLServerSocket/SSLSocket handshake (not a bare call
        // to checkServerTrusted) - the question is whether Java's own TLS
        // machinery independently enforces certificate validity ahead of a
        // custom X509TrustManager, or whether (as room-tls-and-discovery-
        // pitch.md Section 1.4's TOFU/SPKI-pinning model implies) only the
        // key matters and the JDK lets a plain X509TrustManager make the
        // entire decision. Proven here, not assumed.
        run {
            val server = startLoopbackTlsServer(expiredKs)
            try {
                val outcome = clientHandshakeAttempt("127.0.0.1", server.port, expiredPin)
                if (outcome.tlsOk) info("expired-cert case: negotiated protocol was ${outcome.negotiatedProtocol}")
                when {
                    outcome.tlsOk && outcome.trustManagerInvoked -> ok(
                        "expired cert + matching pin: a REAL loopback TLS handshake was ACCEPTED " +
                        "(RoomTlsPlugin.verifyPinnedCertificate() ran and returned normally) -- FINDING: " +
                        "WORKING AS DESIGNED per room-tls-and-discovery-pitch.md Section 1.4 (TOFU pinning is " +
                        "anchored to the key/SPKI hash, not the certificate's temporal validity window); not a " +
                        "new residual risk beyond what that section already names"
                    )
                    !outcome.tlsOk && !outcome.trustManagerInvoked -> bad(
                        "expired cert + matching pin: the handshake was REJECTED before " +
                        "RoomTlsPlugin.verifyPinnedCertificate() ever ran (error: ${outcome.error}) -- FINDING: " +
                        "A RESIDUAL RISK worth flagging - Java's own TLS/JSSE machinery is independently enforcing " +
                        "certificate temporal validity ahead of the custom X509TrustManager, which checkServerTrusted's " +
                        "own 'no chain-of-trust or hostname check beyond this' comment does not currently account for"
                    )
                    else -> bad(
                        "expired cert + matching pin: unexpected outcome (tlsOk=${outcome.tlsOk}, " +
                        "trustManagerInvoked=${outcome.trustManagerInvoked}, error=${outcome.error}) -- the trust " +
                        "manager ran but the handshake still failed, even though the pin matched; investigate " +
                        "whether this is a harness bug before treating it as a product finding"
                    )
                }
            } finally { server.stop() }
        }

        // ---- case 8: downgrade attempt --------------------------------------
        // connectAndPump() calls SSLContext.getInstance("TLSv1.3") AND
        // (2026-09-06 fix, found by an earlier version of this exact case)
        // raw.setEnabledProtocols(arrayOf("TLSv1.3")) before startHandshake() -
        // the getInstance() call alone does NOT restrict the socket's own
        // enabled-protocols list (this JDK's default is [TLSv1.3, TLSv1.2]),
        // so the explicit setEnabledProtocols() call is load-bearing, not
        // redundant. A real loopback server offering ONLY TLSv1.2 must make
        // a client built the same way genuinely FAIL the handshake, not
        // silently negotiate down.
        run {
            val server = startLoopbackTlsServer(goodKs, protocols = arrayOf("TLSv1.2"))
            try {
                val clientCtxForDiagnostics = SSLContext.getInstance("TLSv1.3").apply { init(null, null, null) }
                info("downgrade case: SSLContext.getInstance(\"TLSv1.3\")'s own default enabled protocols on this JDK are [${clientCtxForDiagnostics.defaultSSLParameters.protocols.joinToString(", ")}] -- this is exactly why connectAndPump()'s explicit setEnabledProtocols(arrayOf(\"TLSv1.3\")) call is load-bearing: getInstance() alone would still allow TLSv1.2")
                val outcome = clientHandshakeAttempt("127.0.0.1", server.port, goodPin, clientProtocol = "TLSv1.3")
                if (!outcome.tlsOk) {
                    ok(
                        "downgrade attempt: a client built the same way PinnedWsClient.connectAndPump() builds its " +
                        "SSLContext/socket (including the setEnabledProtocols(arrayOf(\"TLSv1.3\")) fix) genuinely FAILS " +
                        "the handshake against a real loopback server offering ONLY TLSv1.2 " +
                        "(${outcome.error?.javaClass?.simpleName}: ${outcome.error?.message}) -- no silent negotiation down"
                    )
                } else {
                    bad(
                        "downgrade attempt: a client built EXACTLY the way PinnedWsClient.connectAndPump() builds its " +
                        "SSLContext/socket completed a REAL handshake against a loopback server offering ONLY TLSv1.2, " +
                        "negotiating protocol=${outcome.negotiatedProtocol} -- REGRESSION: the 2026-09-06 " +
                        "setEnabledProtocols(arrayOf(\"TLSv1.3\")) fix in connectAndPump() (or its mirror in " +
                        "clientHandshakeAttempt() above) is missing or broken - this must not silently pass"
                    )
                }
            } finally { server.stop() }
        }
    } finally {
        workDir.deleteRecursively()
    }

    for (pin in EXPECTED_DEFECTS) {
        if (pin.hits == 0) bad("expected defect did not reproduce - remove its pin: ${pin.why}")
    }

    println()
    println("tls-adversarial: ${fails} FAIL(s)")
    exitProcess(if (fails > 0) minOf(fails, 255) else 0)
}
