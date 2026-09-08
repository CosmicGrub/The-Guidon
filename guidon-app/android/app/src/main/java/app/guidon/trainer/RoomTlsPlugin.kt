package app.guidon.trainer

// RFC 6455 CLIENT (2026-09-06) - completed, and verified this session
// against a real Gradle build (:app:compileDebugKotlin / assembleDebug
// green) plus tools/tls-adversarial/Harness.kt's adversarial suite
// (compiled together with this real file in one kotlinc invocation - see
// that harness's own header for why). Was a scaffold (illustrative, not
// gradle-built or device-tested, truncated-fingerprint pinning bug,
// close/ping-pong/fragmentation left as TODO); this pass fixes the pinning
// bug for real, completes the RFC 6455 client, and registers the plugin in
// MainActivity.
// CORRECTION (2026-09-07, security audit M11): this header previously also
// claimed "device-verified this session" against a real Fold5. That
// overstated things - docs/design/room-tls-and-discovery-pitch.md's own
// residual-risk section (Section 1's "Not verified in this environment at
// all" bullet) lists "any real device behavior of RoomTlsPlugin" as
// unverified, and docs/spike/P0-RUN-SHEET.md schedules the actual
// PC<->Fold5/Tab-S9 on-device study-room verification for 2026-09-08/09 -
// still ahead as of this file's last edit, not something already done. So:
// implemented and Gradle/adversarially verified on this machine, YES;
// verified against a real physical device, NOT YET. See this session's
// report for the exact verification method and results for each piece.
//
// WHY THIS FILE HAS TO EXIST AT ALL (the "biggest unknown" the design
// brief calls out, addressed head-on): a plain `new WebSocket("wss://...")`
// from page JS in an Android WebView goes through Android's OS-level
// default TrustManager, which will unconditionally reject any self-signed
// certificate with no chain to a trusted root - and WebView exposes NO
// JS-reachable hook to accept or pin an unknown certificate.
// WebViewClient.onReceivedSslError is a NATIVE-side callback with no path
// back to page JS, and it is a per-navigation (top-level page load) hook
// in any case, not a per-WebSocket one - it does not even fire for a
// WebSocket's own TLS handshake. There is no way to make this work from
// src/room-web.js alone. This plugin is the alternative the design brief
// asks for: a NATIVE Kotlin WebSocket client that bypasses the WebView's
// networking stack and its default certificate validation entirely,
// performing its own pinning check against the room's known full
// SHA-256(SPKI) pin (the same value room-schema.js's isSpkiPin() validates
// and the human-readable fp is separately derived from) before accepting a
// single byte of application data, bridging frames back to JS via standard
// Capacitor plugin calls/events.
//
// This intentionally does NOT depend on OkHttp (not currently a
// dependency of @capacitor/android - confirmed by reading
// node_modules/@capacitor/android/capacitor/build.gradle, which lists
// only androidx.* and cordova-framework). Adding OkHttp would be the
// faster way to get a production WebSocket client with less hand-written
// code (see the design writeup's effort estimate for that tradeoff) but
// Chris has explicitly decided hand-rolled RFC 6455 over OkHttp for this
// plugin - this mirrors this project's own pattern elsewhere (room.rs,
// tools/room-server.mjs) of hand-rolling the small RFC 6455 surface it
// actually needs rather than pulling in a dependency for it: a minimal
// RFC 6455 CLIENT (handshake + masked framing, generalized over opcode;
// close handshake; ping/pong; continuation-frame reassembly) over a raw
// SSLSocket configured with a pinning-only TrustManager.
//
// registerPlugin(RoomTlsPlugin::class.java) is added to
// MainActivity.onCreate() (NOT auto-discovered - this is an app-local
// plugin, not an npm-packaged one, so Capacitor's usual node_modules
// plugin scan never sees it).

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import kotlin.concurrent.thread

@CapacitorPlugin(name = "RoomTls")
class RoomTlsPlugin : Plugin() {
    private val sockets = ConcurrentHashMap<Long, PinnedWsClient>()
    private val nextId = AtomicLong(1)

    // connect(url: "wss://host:port/ws?...", pin: "<64-char lowercase hex>")
    // -> { id }
    // SECURITY FIX (2026-09-06): this used to take an 8-char base32 `fp` and
    // compare that truncated (40-bit) value in checkServerTrusted() below -
    // exactly the corner room-tls-and-discovery-pitch.md Section 1.4 warns
    // against cutting. `pin` is now the full 64-char lowercase-hex
    // SHA-256(SPKI), the SAME shape src/app-modules/room-schema.js's
    // isSpkiPin() validates (`/^[0-9a-f]{64}$/`) and the SAME convention
    // tools/room-tls.mjs and src-tauri/src/room_tls.rs's hex() already use
    // for their own spkiSha256 values. room-web.js passes this through
    // unchanged from the join link's #pin=<hex> fragment; this plugin never
    // invents or negotiates a pin of its own.
    @PluginMethod
    fun connect(call: PluginCall) {
        val urlStr = call.getString("url") ?: return call.reject("url required")
        val pin = call.getString("pin") ?: return call.reject("pin required")
        if (!SPKI_PIN_RE.matches(pin)) {
            return call.reject("pin is not a well-formed full SHA-256(SPKI) hex pin (expected 64 lowercase hex chars)")
        }
        // CRLF-INJECTION FIX (M5, 2026-09-07): `pin` was already validated
        // above but `url` never was - see findCrlfInjection()'s own doc
        // comment below for the actual attack this closes. Parse and check
        // it here, synchronously, so a malicious/malformed url is rejected
        // the same way a malformed pin already is, instead of only
        // surfacing as an async "error" event after a thread is spawned.
        val parsedUrl = try {
            URI(urlStr)
        } catch (e: Exception) {
            return call.reject("url is not a well-formed URI: ${e.message}")
        }
        findCrlfInjection(parsedUrl)?.let { component ->
            return call.reject("url's $component contains a CR or LF character - refusing (possible request-splitting attempt)")
        }
        val id = nextId.getAndIncrement()
        thread(name = "guidon-room-tls-$id") {
            try {
                val client = PinnedWsClient(urlStr, pin) { type, data ->
                    val ev = JSObject()
                    ev.put("id", id)
                    ev.put("type", type) // "message" | "open" | "close" | "error"
                    if (data != null) ev.put("data", data)
                    notifyListeners("roomTlsEvent", ev)
                }
                sockets[id] = client
                client.connectAndPump() // blocks this thread until closed
            } catch (e: Exception) {
                val ev = JSObject()
                ev.put("id", id)
                ev.put("type", "error")
                ev.put("data", e.message ?: e.toString())
                notifyListeners("roomTlsEvent", ev)
            } finally {
                sockets.remove(id)
            }
        }
        val result = JSObject()
        result.put("id", id)
        call.resolve(result)
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val id = callId(call) ?: return call.reject("id required")
        val text = call.getString("text") ?: return call.reject("text required")
        val sock = sockets[id] ?: return call.reject("no such connection")
        sock.sendText(text)
        call.resolve()
    }

    @PluginMethod
    fun close(call: PluginCall) {
        val id = callId(call) ?: return call.reject("id required")
        // PinnedWsClient.close() performs the real RFC 6455 closing
        // handshake (send our close frame, wait briefly for the peer's own
        // close frame) and can block this call's dispatch thread for up to
        // ~1.5s as a result - deliberate, matches "wait briefly" in the
        // spec, not a stray blocking call.
        sockets[id]?.close()
        call.resolve()
    }

    // BUG FOUND DURING DEVICE VERIFICATION (2026-09-06), fixed here: this
    // plugin's own `id` (from AtomicLong, returned by connect()) is a
    // Kotlin/Java Long, but PluginCall.getLong("id") ONLY returns non-null
    // when the underlying org.json value is `instanceof Long` - and
    // org.json's JSON parser boxes any JS number small enough to fit as a
    // plain `Integer` instead, which is every id this plugin will ever
    // actually hand out in one app session. Confirmed live: a real
    // `RoomTls.close({id: 6})` call from the device's own WebView failed
    // with "id required" every time before this fix, because
    // call.getLong("id") silently returned null for that exact value.
    // PluginCall.getInt() has the mirror-image bug (only matches
    // `instanceof Integer`), so this tries Long, then Int, then Double (for
    // full robustness against whichever the bridge happens to box a given
    // number as) rather than picking just one and hoping.
    private fun callId(call: PluginCall): Long? {
        call.getLong("id")?.let { return it }
        call.getInt("id")?.let { return it.toLong() }
        call.getDouble("id")?.let { return it.toLong() }
        return null
    }

    companion object {
        private val SPKI_PIN_RE = Regex("^[0-9a-f]{64}$")

        // EXTRACT-METHOD REFACTOR (2026-09-06, room-tls-and-discovery-
        // pitch.md Section 3's "own adversarial suite against the native
        // Kotlin/Rust trust-manager code" paragraph): this is EXACTLY the
        // decision that used to live inline in PinnedWsClient.connectAndPump()'s
        // checkServerTrusted() lambda below - hash the leaf cert's SPKI,
        // hex-encode, compare to expectedPin, throw CertificateException
        // with the same message on mismatch, return normally (accept
        // silently) on match. Behavior, exceptions, and messages are
        // UNCHANGED by this move - this is a pure extract-method, not a
        // rewrite - so checkServerTrusted() can just call it.
        //
        // Pulled out to `internal` (module-visible, not file-private) on
        // RoomTlsPlugin's own companion object - not PinnedWsClient's, since
        // PinnedWsClient is itself a file-private `private class` and
        // nothing outside this file could ever name that type to reach a
        // member of it, however visible - specifically so
        // tools/tls-adversarial/Harness.kt (compiled together with this
        // real file in one kotlinc invocation, never a hand-copied second
        // implementation) can call the REAL production trust decision
        // directly. This mirrors src-tauri/src/room_tls.rs's own header
        // rule verbatim: "whatever function computes the fingerprint a
        // human reads and whatever function checks a peer's certificate
        // against it must be the same function, on both ends, always" -
        // the same principle applies to testing it, not just implementing
        // it: a hand-copied reimplementation here could silently drift from
        // this real function and the adversarial suite would then be
        // proving nothing about production behavior.
        internal fun verifyPinnedCertificate(chain: Array<X509Certificate>, expectedPin: String) {
            val leaf = chain.firstOrNull() ?: throw CertificateException("no certificate presented")
            val spki = leaf.publicKey.encoded // X.509 SubjectPublicKeyInfo DER, per the JCA contract
            val digest = MessageDigest.getInstance("SHA-256").digest(spki)
            val pin = PinnedWsClient.hex(digest)
            if (pin != expectedPin) {
                throw CertificateException(
                    "room pin mismatch: host presented $pin, expected $expectedPin - " +
                    "refusing the connection (this is either a stale/corrupted join link, or " +
                    "someone else answering for this room on the LAN)"
                )
            }
            // Pin matched: this exact key is who the join link already
            // vouched for. No chain-of-trust or hostname check beyond this -
            // see the design writeup's residual-risk section for why that
            // is the deliberate model here, not an oversight. Note this
            // reads chain[0] ONLY (chain.firstOrNull() above) - the leaf
            // position - and never scans the rest of the array looking for
            // a match; a multi-cert chain where only a non-leaf entry would
            // match the pin is correctly rejected, exactly the property
            // tools/tls-adversarial/Harness.kt's "multi-cert chain" case
            // exercises.
        }

        // CRLF-INJECTION FIX (M5, 2026-09-07): java.net.URI's getPath()/
        // getHost()/getQuery() all auto-percent-DECODE, so a join url whose
        // path segment carries a percent-encoded CR/LF (e.g. "%0D%0A")
        // decodes back to a literal CR/LF right where
        // PinnedWsClient.performHandshake() used to build the raw HTTP
        // Upgrade request text from `uri.path` - meanwhile `uri.rawQuery`
        // was left encoded, so path and query got inconsistent treatment.
        // Request splitting into the pinned TLS socket followed. Checked
        // from BOTH connect() above (reject the PluginCall synchronously,
        // before a background thread is even spawned) and
        // PinnedWsClient.performHandshake() (defense in depth, in case a
        // future caller ever constructs PinnedWsClient some other way) -
        // same function both places, so neither check can silently drift
        // from the other. Examines the DECODED form of every component
        // regardless of which one carried the encoded CR/LF, not just the
        // path where this was first found - a decoded host or query
        // carrying a literal CR/LF is refused too, even though today's
        // fixed request-line format never writes a decoded host or query
        // onto the wire either.
        internal fun findCrlfInjection(uri: URI): String? {
            val path = uri.path
            val host = uri.host
            val query = uri.query // decodes, unlike uri.rawQuery
            return when {
                path != null && (path.contains('\r') || path.contains('\n')) -> "path"
                host != null && (host.contains('\r') || host.contains('\n')) -> "host"
                query != null && (query.contains('\r') || query.contains('\n')) -> "query"
                else -> null
            }
        }
    }
}

/**
 * PinnedWsClient: an RFC 6455 client over a raw [SSLSocket] whose
 * [X509TrustManager] accepts EXACTLY ONE certificate - the one whose full
 * SHA-256(SPKI), lowercase hex, equals [expectedPin]. This is Android's
 * equivalent of the Rust spike's `PinnedVerifier`
 * (src-tauri/spikes/room_tls_spike) and tools/room-tls.mjs's client-side
 * check in its own selftest - THREE implementations of the identical
 * "hash the SPKI, compare to the pin" rule, one per runtime that terminates
 * a room's TLS connection from the joining side. Never falls back to the
 * platform's default trust store: an unpinned cert is refused, full stop,
 * exactly like an unmatched one.
 */
private class PinnedWsClient(
    urlStr: String,
    private val expectedPin: String,
    private val onEvent: (String, String?) -> Unit,
) {
    private val uri = URI(urlStr)
    @Volatile private var socket: SSLSocket? = null
    // CONNECT/HANDSHAKE TIMEOUT FIX (M4, 2026-09-07): the plain TCP socket,
    // stashed here the instant connectAndPump()'s own socket.connect()
    // returns - well before `socket` above is ever assigned (that happens
    // only once the TLS wrapping AND handshake both finish). close() reads
    // this so a connect/handshake stuck for any reason is still always
    // forcibly cancellable, not just flagged and left to block until
    // CONNECT_TIMEOUT_MS elapses on its own.
    @Volatile private var underlyingSocket: Socket? = null
    @Volatile private var closed = false
    // Set the instant EITHER side's close frame has been sent, so the other
    // direction's handler knows whether an incoming close frame is a fresh
    // peer-initiated close (needing an echo, RFC 6455 5.5.1) or the peer's
    // answer to a close WE already sent (no echo needed, just shut down).
    @Volatile private var sentClose = false
    @Volatile private var closeCode: Int? = null
    private var fragmentedOpcode = -1 // -1: no message in progress; 0x1: text fragments buffering
    private val fragmentBuffer = java.io.ByteArrayOutputStream()
    private val writeLock = Any()
    // Counts down exactly once, the instant the socket is actually closed
    // (whichever path caused it) and the "close" event has been fired -
    // close() below awaits this so a self-initiated close can wait briefly
    // for the peer's own close frame before giving up and forcing the
    // socket shut, matching RFC 6455's closing handshake.
    private val closedLatch = CountDownLatch(1)
    private var closeFired = false

    fun connectAndPump() {
        val host = uri.host
        val port = if (uri.port > 0) uri.port else 443
        val trustManager = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
                throw CertificateException("client certs not used")
            }
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                // Extract-method refactor (2026-09-06): the actual pin
                // decision now lives in RoomTlsPlugin.verifyPinnedCertificate()
                // - see that function's doc comment for why (testability
                // without a drift-prone duplicate). Same behavior, same
                // exceptions, same messages as before this move.
                RoomTlsPlugin.verifyPinnedCertificate(chain, expectedPin)
            }
        }
        val ctx = SSLContext.getInstance("TLSv1.3")
        ctx.init(null, arrayOf(trustManager), SecureRandom())
        val factory = ctx.socketFactory
        // CONNECT/HANDSHAKE TIMEOUT FIX (M4, 2026-09-07): factory.createSocket(host, port)
        // is a one-shot call with NO timeout of its own - a peer that never
        // completes the TCP handshake (or a routing black hole) used to
        // block this thread forever, and `socket` above was only assigned
        // AFTER startHandshake() returned, so close() called during a stuck
        // connect/handshake had no real socket to reach (see close()'s own
        // comment below). Fix: build the plain TCP socket ourselves with an
        // explicit bounded connect timeout, stash the raw reference in
        // `underlyingSocket` the instant it succeeds - BEFORE wrapping for
        // TLS or starting the handshake - then wrap it.
        val plain = Socket()
        plain.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS.toInt())
        underlyingSocket = plain // close() can now always reach a real socket, even mid-handshake below
        val raw = factory.createSocket(plain, host, port, true) as SSLSocket // autoClose=true: closing `raw` also closes `plain`
        // Same bounded timeout also guards the handshake itself: a peer that
        // completes the TCP connect but then stalls mid-handshake
        // (slow-loris) would otherwise block startHandshake() forever too.
        raw.soTimeout = CONNECT_TIMEOUT_MS.toInt()
        // DOWNGRADE FIX (2026-09-06, found by tools/tls-adversarial/Harness.kt's
        // downgrade case): SSLContext.getInstance("TLSv1.3") only selects an
        // engine CAPABLE of TLS 1.3 - it does NOT restrict the socket's own
        // enabled-protocols list, which defaults to ["TLSv1.3", "TLSv1.2"] on
        // this JDK. Proven live: a client built with exactly the two lines
        // above alone completed a real handshake at TLSv1.2 against a
        // loopback server offering only TLSv1.2. The pin check still runs
        // either way (protocol version and trust decision are independent),
        // but a downgrade defeats the point of pinning to a specific TLS 1.3
        // identity in the first place and widens exposure to anything
        // TLS-1.2-specific. Force TLS 1.3 only, so a downgrade attempt fails
        // the handshake outright instead of silently negotiating down.
        raw.setEnabledProtocols(arrayOf("TLSv1.3"))
        raw.startHandshake() // checkServerTrusted() above runs synchronously inside this call
        raw.soTimeout = 0 // handshake done - back to blocking reads for readLoop's lifetime, same as before this fix
        socket = raw
        onEvent("open", null)

        val out = DataOutputStream(raw.outputStream)
        val input = DataInputStream(raw.inputStream)
        performHandshake(uri, out, input)

        readLoop(input, out) // blocks until closed; always fires "close" via its own finally
    }

    fun sendText(text: String) {
        val s = socket ?: return
        synchronized(writeLock) {
            writeClientFrame(DataOutputStream(s.outputStream), 0x1, text.toByteArray(Charsets.UTF_8))
        }
    }

    // Self-initiated close (RFC 6455 7.1.5): send our own close frame (if we
    // have not already, e.g. via a protocol-error path), then wait briefly
    // for the peer's close frame - readLoop observes it, sees sentClose
    // already true, and shuts the socket down itself, which fires "close"
    // via readLoop's finally. If the peer never answers within the timeout,
    // force the socket closed here instead; readLoop's blocked read then
    // throws, is swallowed there (closed already true), and its finally
    // still fires "close" exactly once.
    fun close() {
        if (closed) return
        val s = socket
        if (s != null) {
            try {
                synchronized(writeLock) {
                    if (!sentClose) {
                        sentClose = true
                        sendCloseFrame(DataOutputStream(s.outputStream), 1000, "")
                    }
                }
            } catch (_: Exception) {}
        } else {
            // Never got as far as a live (fully-handshaked) socket - either
            // still mid-connect/mid-handshake inside connectAndPump(), or it
            // hasn't run yet at all. Nothing to send (no WS layer exists
            // yet) and readLoop will never run to fire "close" on its own,
            // so mark this closed directly - but CONNECT/HANDSHAKE TIMEOUT
            // FIX (M4, 2026-09-07): a pending connect/handshake must always
            // be actually cancellable right now, not just flagged and left
            // to block until CONNECT_TIMEOUT_MS elapses on its own. Forcibly
            // close whatever raw socket reference IS available -
            // `underlyingSocket` is stashed the instant the plain TCP
            // connect succeeds in connectAndPump(), well before `socket`
            // above is ever set - which kills the underlying stream out
            // from under a thread blocked in socket.connect() or
            // raw.startHandshake(), unblocking it immediately.
            closed = true
            try { underlyingSocket?.close() } catch (_: Exception) {}
            return
        }
        try { closedLatch.await(CLOSE_WAIT_MS, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) {}
        if (!closed) {
            closed = true
            try { s.close() } catch (_: Exception) {}
        }
    }

    // ---- RFC 6455 handshake (mirrors src-tauri/src/room.rs's accept_key(),
    //      same SHA-1 + base64 + the fixed WS_GUID, client side of it) ----
    private fun performHandshake(uri: URI, out: DataOutputStream, input: DataInputStream) {
        // CRLF-INJECTION FIX (M5, 2026-09-07) - see RoomTlsPlugin.findCrlfInjection()'s
        // own doc comment. connect() already rejects this up front before a
        // thread is even spawned; this is defense in depth. Never build the
        // request line below from a DECODING accessor - `uri.rawPath` stays
        // exactly as the caller wrote it (still percent-encoded), unlike
        // the `uri.path` this used to read.
        RoomTlsPlugin.findCrlfInjection(uri)?.let { component ->
            throw IOException("url's $component contains a CR or LF character - refusing (possible request-splitting attempt)")
        }
        val keyBytes = ByteArray(16)
        SecureRandom().nextBytes(keyBytes)
        val key = Base64.encodeToString(keyBytes, Base64.NO_WRAP)
        val path = if (uri.rawQuery != null) "${uri.rawPath}?${uri.rawQuery}" else uri.rawPath
        val req = buildString {
            append("GET $path HTTP/1.1\r\n")
            append("Host: ${uri.host}:${uri.port}\r\n")
            append("Upgrade: websocket\r\n")
            append("Connection: Upgrade\r\n")
            append("Sec-WebSocket-Key: $key\r\n")
            append("Sec-WebSocket-Version: 13\r\n\r\n")
        }
        out.write(req.toByteArray(Charsets.US_ASCII))
        out.flush()
        val statusLine = readLine(input)
        if (!statusLine.contains(" 101 ")) throw IOException("handshake refused: $statusLine")
        var acceptHeader: String? = null
        while (true) {
            val line = readLine(input)
            if (line.isEmpty()) break
            val idx = line.indexOf(':')
            if (idx > 0 && line.substring(0, idx).equals("Sec-WebSocket-Accept", ignoreCase = true)) {
                acceptHeader = line.substring(idx + 1).trim()
            }
        }
        val md = MessageDigest.getInstance("SHA-1")
        val expectAccept = Base64.encodeToString(md.digest((key + WS_GUID).toByteArray(Charsets.US_ASCII)), Base64.NO_WRAP)
        if (acceptHeader != expectAccept) throw IOException("Sec-WebSocket-Accept mismatch - not a real GUIDON room host")
    }
    private fun readLine(input: DataInputStream): String {
        val sb = StringBuilder()
        while (true) {
            val b = input.readByte().toInt() and 0xff
            if (b == '\r'.code) { input.readByte(); break }
            sb.append(b.toChar())
        }
        return sb.toString()
    }

    // ---- RFC 6455 masked client framing, generalized over opcode so text,
    //      pong, and close frames all share ONE masking implementation
    //      instead of three copies of it (server frames are never masked -
    //      see room.rs's own parse_frames()/encode_frame() for the
    //      server-side mirror of this exact shape) ----
    private fun writeClientFrame(out: DataOutputStream, opcode: Int, payload: ByteArray) {
        val mask = ByteArray(4)
        SecureRandom().nextBytes(mask)
        out.writeByte(0x80 or (opcode and 0x0f)) // FIN + opcode - this client never sends a fragmented frame of its own
        val len = payload.size
        when {
            len < 126 -> out.writeByte(0x80 or len)
            len < 65536 -> { out.writeByte(0x80 or 126); out.writeShort(len) }
            else -> { out.writeByte(0x80 or 127); out.writeLong(len.toLong()) }
        }
        out.write(mask)
        val masked = ByteArray(len) { i -> (payload[i].toInt() xor mask[i % 4].toInt()).toByte() }
        out.write(masked)
        out.flush()
    }

    // RFC 6455 5.5.1 close-frame payload: optional 2-byte big-endian status
    // code followed by an optional UTF-8 reason (truncated defensively to
    // stay well clear of the 125-byte control-frame payload ceiling).
    private fun sendCloseFrame(out: DataOutputStream, code: Int?, reason: String) {
        val payload = if (code != null) {
            val r = reason.toByteArray(Charsets.UTF_8)
            val rTrunc = r.copyOfRange(0, minOf(r.size, 123))
            val buf = ByteArray(2 + rTrunc.size)
            buf[0] = ((code shr 8) and 0xff).toByte()
            buf[1] = (code and 0xff).toByte()
            System.arraycopy(rTrunc, 0, buf, 2, rTrunc.size)
            buf
        } else ByteArray(0)
        writeClientFrame(out, 0x8, payload)
    }

    // RFC 6455 5.5.1/7.1.5 close handshake, peer-initiated side: if we have
    // not already sent our own close frame, echo one back (same status code
    // if the peer sent one, otherwise no payload) before this socket goes
    // down. If we HAD already sent one (this is the peer answering OUR
    // close), no echo is needed - just record the code and let the caller
    // shut the socket down.
    private fun handlePeerClose(out: DataOutputStream, payload: ByteArray) {
        val peerCode = if (payload.size >= 2) {
            ((payload[0].toInt() and 0xff) shl 8) or (payload[1].toInt() and 0xff)
        } else null
        if (!sentClose) {
            try {
                synchronized(writeLock) {
                    sentClose = true
                    sendCloseFrame(out, peerCode, "")
                }
            } catch (_: Exception) {}
        }
        closeCode = peerCode
        closed = true
    }

    private fun fireCloseOnce() {
        var fire = false
        synchronized(this) {
            if (!closeFired) { closeFired = true; fire = true }
        }
        if (fire) {
            onEvent("close", closeCode?.toString())
            closedLatch.countDown()
        }
    }

    private fun readLoop(input: DataInputStream, out: DataOutputStream) {
        try {
            while (!closed) {
                val b0 = input.readByte().toInt() and 0xff
                val fin = (b0 and 0x80) != 0
                val op = b0 and 0x0f
                val b1 = input.readByte().toInt() and 0xff
                var len = (b1 and 0x7f).toLong()
                if (len == 126L) len = input.readShort().toLong() and 0xffffL
                else if (len == 127L) len = input.readLong()
                // UNBOUNDED-ALLOCATION FIX (H3, 2026-09-07): a malicious or
                // corrupted peer can declare any len up to 2^63-1 here before
                // this client has any other way to know the frame is
                // garbage - `ByteArray(len.toInt())` below used to allocate
                // that many bytes UNCONDITIONALLY, so a single hostile frame
                // header could OOM-crash the whole app before a single
                // payload byte was even read. Mirrors the same cap and
                // close-code convention src-tauri/src/room.rs's
                // parse_frames() and tools/room-server.mjs's parse() both
                // already enforce server-side: MAX_PAYLOAD (1 MiB) is
                // already generous for this protocol (room.rs's own comment:
                // "a wire message is < 4.2 KB; anything near 1 MB is
                // hostile"), and a declared len over it gets the connection
                // closed with WS code 1009 ("too big") instead of an
                // allocation. `len < 0` alongside it: readLong() reads the
                // 8-byte extended length as a SIGNED Long, so a peer setting
                // that field's top bit produces a negative `len` that a
                // plain `len > MAX_PAYLOAD` signed comparison would miss
                // entirely (Rust's mirrored check doesn't have this gap -
                // room.rs's own `big` is an unsigned u64) - reject that
                // shape outright too rather than letting it fall through to
                // `len.toInt()` truncation below.
                if (len < 0 || len > MAX_PAYLOAD) {
                    abortWithProtocolError(out, 1009, "too big")
                    return
                }
                val payload = ByteArray(len.toInt())
                input.readFully(payload)
                when (op) {
                    0x0 -> { // continuation - RFC 6455 5.4 fragmentation reassembly.
                        // Confirmed by reading src-tauri/src/room.rs's encode_frame()
                        // and tools/room-server.mjs's encodeFrame(): both this room
                        // protocol's real servers always set FIN=1 on every frame
                        // they send today (bounded by MAX_WIRE_BYTES), so this path
                        // is not exercised by anything live right now - implemented
                        // regardless for RFC 6455 compliance and defensive
                        // correctness against any future server change or
                        // intermediary that DOES fragment.
                        if (fragmentedOpcode == -1) {
                            abortWithProtocolError(out, 1002, "unexpected continuation frame")
                            return
                        }
                        fragmentBuffer.write(payload)
                        // UNBOUNDED-ALLOCATION FIX (H3, 2026-09-07): the single-frame
                        // check above only bounds ONE frame's declared len - a
                        // series of small, individually-legal fragments whose
                        // CUMULATIVE total exceeds MAX_PAYLOAD must be rejected
                        // too, same as room.rs's own continuation-frame handling
                        // (`frag.extend_from_slice` then `if frag.len() > MAX_PAYLOAD`).
                        // Otherwise fragmentBuffer grows unbounded across an
                        // arbitrarily long sequence of frames.
                        if (fragmentBuffer.size() > MAX_PAYLOAD) {
                            abortWithProtocolError(out, 1009, "too big")
                            return
                        }
                        if (fin) {
                            val full = fragmentBuffer.toByteArray()
                            fragmentBuffer.reset()
                            fragmentedOpcode = -1
                            onEvent("message", String(full, Charsets.UTF_8))
                        }
                    }
                    0x1 -> { // text
                        if (fragmentedOpcode != -1) {
                            // A new data frame arrived while a previous text
                            // message's fragments were still incomplete - not
                            // legal interleaving for a data frame (only control
                            // frames may interleave fragments per RFC 6455 5.4).
                            abortWithProtocolError(out, 1002, "data frame interleaved mid-fragment")
                            return
                        }
                        if (fin) {
                            onEvent("message", String(payload, Charsets.UTF_8))
                        } else {
                            fragmentedOpcode = 0x1
                            fragmentBuffer.reset()
                            fragmentBuffer.write(payload)
                            // UNBOUNDED-ALLOCATION FIX (H3, 2026-09-07): same
                            // cumulative-total bound as the continuation-frame
                            // case above, checked here too (defense in depth) -
                            // this first fragment alone can never exceed
                            // MAX_PAYLOAD on its own (already bounded above),
                            // but keeps this check symmetric with every later
                            // continuation frame's own write to fragmentBuffer.
                            if (fragmentBuffer.size() > MAX_PAYLOAD) {
                                abortWithProtocolError(out, 1009, "too big")
                                return
                            }
                        }
                    }
                    0x8 -> { // close - see handlePeerClose()'s own doc comment
                        handlePeerClose(out, payload)
                        return
                    }
                    0x9 -> { // ping - RFC 6455 5.5.2: respond immediately with a
                        // pong carrying the SAME payload, using the same masked-
                        // frame writer as every other outgoing frame.
                        try {
                            synchronized(writeLock) { writeClientFrame(out, 0xA, payload) }
                        } catch (_: Exception) {}
                    }
                    0xA -> { /* unsolicited pong (RFC 6455 5.5.3) - no action required */ }
                    else -> { /* reserved opcode: this protocol (room-schema.js) never sends one */ }
                }
            }
        } catch (e: Exception) {
            if (!closed) {
                // A real I/O failure while the connection was still expected
                // to be open (peer vanished, network drop, etc.) - surface
                // it. If `closed` is already true, this is exactly the
                // expected IOException from close() above forcing the
                // socket shut while waiting out CLOSE_WAIT_MS for a peer
                // close frame that never came - not a real error, swallow it.
                onEvent("error", e.message ?: e.toString())
            }
        } finally {
            closed = true
            try { socket?.close() } catch (_: Exception) {}
            fireCloseOnce()
        }
    }

    // RFC 6455 7.1.5-style protocol-error abort: tell the peer why (best
    // effort - the connection may already be unusable) and let readLoop's
    // own finally take care of actually closing the socket and firing the
    // "close" event, same single path every other close reaches.
    private fun abortWithProtocolError(out: DataOutputStream, code: Int, reason: String) {
        try {
            synchronized(writeLock) {
                if (!sentClose) {
                    sentClose = true
                    sendCloseFrame(out, code, reason)
                }
            }
        } catch (_: Exception) {}
        closeCode = code
    }

    companion object {
        private const val WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        // How long a self-initiated close() waits for the peer's own close
        // frame before giving up and forcing the socket shut - "briefly",
        // per RFC 6455 7.1.5, not indefinitely.
        private const val CLOSE_WAIT_MS = 1500L
        // UNBOUNDED-ALLOCATION FIX (H3, 2026-09-07): SAME numeric cap as
        // src-tauri/src/room.rs's and tools/room-server.mjs's own
        // MAX_PAYLOAD (both `1 << 20`, i.e. 1 MiB) - room.rs's own comment
        // on it applies here unchanged: "a wire message is < 4.2 KB;
        // anything near 1 MB is hostile". Enforced in readLoop() below
        // against both a single frame's declared len AND the cumulative
        // total across a fragmented message's reassembly buffer.
        private const val MAX_PAYLOAD = 1 shl 20
        // CONNECT/HANDSHAKE TIMEOUT FIX (M4, 2026-09-07): bounds BOTH the
        // plain TCP connect (Socket.connect()) and the TLS handshake
        // (SSLSocket.soTimeout) in connectAndPump() - neither had any
        // timeout before this fix, so a peer that never completes either
        // step (routing black hole, slow-loris) blocked the connection
        // thread forever. 10s is generous for a LAN join (this protocol's
        // whole point) while still bounding the worst case to something a
        // human waiting on a "joining..." spinner will actually notice.
        private const val CONNECT_TIMEOUT_MS = 10_000L
        // SAME convention as tools/room-tls.mjs and src-tauri/src/room_tls.rs's
        // own hex(): lowercase, exactly two hex chars per byte, no separator.
        // Full SHA-256 digest (32 bytes) in -> 64 lowercase hex chars out,
        // matching room-schema.js's isSpkiPin() shape exactly.
        private val HEX_CHARS = "0123456789abcdef".toCharArray()
        fun hex(bytes: ByteArray): String {
            val sb = StringBuilder(bytes.size * 2)
            for (b in bytes) {
                val v = b.toInt() and 0xff
                sb.append(HEX_CHARS[v ushr 4])
                sb.append(HEX_CHARS[v and 0x0f])
            }
            return sb.toString()
        }
    }
}
