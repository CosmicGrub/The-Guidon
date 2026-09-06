package app.guidon.trainer

// SCAFFOLD (2026-09-06) - illustrative, NOT gradle-built or device-tested in
// this session (no Android toolchain invoked here; see the design writeup
// for what verifying this for real requires: `./gradlew assembleDebug`,
// then the same adb/CDP probe tools/probe-android-ws.mjs already used to
// confirm the ORIGINAL cleartext-blocker finding, pointed at a real Tauri
// or Node room-tls host).
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
// performing its own pinning check against the room's known fingerprint
// (the same 8-char fp the human already read off the host's screen)
// before accepting a single byte of application data, bridging frames
// back to JS via standard Capacitor plugin calls/events.
//
// This intentionally does NOT depend on OkHttp (not currently a
// dependency of @capacitor/android - confirmed by reading
// node_modules/@capacitor/android/capacitor/build.gradle, which lists
// only androidx.* and cordova-framework). Adding OkHttp would be the
// faster way to get a production WebSocket client with less hand-written
// code (see the design writeup's effort estimate for that tradeoff) but
// this project's own pattern (room.rs, tools/room-server.mjs) is to hand-
// roll the small RFC 6455 surface it actually needs rather than pull in a
// dependency for it, so this mirrors that: a minimal RFC 6455 CLIENT
// (handshake + text-frame client masking, mirroring room.rs's own
// RFC 6455 SERVER framing byte for byte) over a raw SSLSocket configured
// with a pinning-only TrustManager.
//
// registerPlugin(RoomTlsPlugin::class.java) must be added to
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
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import kotlin.concurrent.thread

@CapacitorPlugin(name = "RoomTls")
class RoomTlsPlugin : Plugin() {
    private val sockets = ConcurrentHashMap<Long, PinnedWsClient>()
    private val nextId = AtomicLong(1)

    // connect(url: "wss://host:port/ws?...", fp: "ABCDEFGH") -> { id }
    // `fp` is the SAME 8-char base32 fingerprint G.roomSchema already
    // validates (FP_RE = /^[A-Z2-7]{8}$/) - room-web.js passes it through
    // unchanged from the join link/host screen; this plugin never invents
    // or negotiates a fingerprint of its own.
    @PluginMethod
    fun connect(call: PluginCall) {
        val urlStr = call.getString("url") ?: return call.reject("url required")
        val fp = call.getString("fp") ?: return call.reject("fp required")
        if (!fp.matches(Regex("^[A-Z2-7]{8}$"))) return call.reject("fp is not a well-formed room fingerprint")
        val id = nextId.getAndIncrement()
        thread(name = "guidon-room-tls-$id") {
            try {
                val client = PinnedWsClient(urlStr, fp) { type, data ->
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
        val id = call.getLong("id") ?: return call.reject("id required")
        val text = call.getString("text") ?: return call.reject("text required")
        val sock = sockets[id] ?: return call.reject("no such connection")
        sock.sendText(text)
        call.resolve()
    }

    @PluginMethod
    fun close(call: PluginCall) {
        val id = call.getLong("id") ?: return call.reject("id required")
        sockets[id]?.close()
        call.resolve()
    }
}

/**
 * PinnedWsClient: an RFC 6455 client over a raw [SSLSocket] whose
 * [X509TrustManager] accepts EXACTLY ONE certificate - the one whose
 * SPKI SHA-256, base32-encoded (first 5 bytes), equals [expectedFp]. This
 * is Android's equivalent of the Rust spike's `PinnedVerifier`
 * (src-tauri/spikes/room_tls_spike) and tools/room-tls.mjs's client-side
 * check in its own selftest - THREE implementations of the identical
 * "hash the SPKI, compare to what the human already read" rule, one per
 * runtime that terminates a room's TLS connection from the joining side.
 * Never falls back to the platform's default trust store: an unpinned
 * cert is refused, full stop, exactly like an unmatched one.
 */
private class PinnedWsClient(
    urlStr: String,
    private val expectedFp: String,
    private val onEvent: (String, String?) -> Unit,
) {
    private val uri = URI(urlStr)
    @Volatile private var socket: SSLSocket? = null
    @Volatile private var closed = false

    fun connectAndPump() {
        val host = uri.host
        val port = if (uri.port > 0) uri.port else 443
        val trustManager = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
                throw java.security.cert.CertificateException("client certs not used")
            }
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                val leaf = chain.firstOrNull() ?: throw java.security.cert.CertificateException("no certificate presented")
                val spki = leaf.publicKey.encoded // X.509 SubjectPublicKeyInfo DER, per the JCA contract
                val digest = MessageDigest.getInstance("SHA-256").digest(spki)
                val fp = base32(digest.copyOfRange(0, 5))
                if (fp != expectedFp) {
                    throw java.security.cert.CertificateException(
                        "room fingerprint mismatch: host presented $fp, expected $expectedFp - " +
                        "refusing the connection (this is either a stale/mistyped room code, or " +
                        "someone else answering for this room on the LAN)"
                    )
                }
                // Fingerprint matched: this exact key is who the human
                // already vouched for by reading the room code aloud.
                // No chain-of-trust or hostname check beyond this - see
                // the design writeup's residual-risk section for why that
                // is the deliberate model here, not an oversight.
            }
        }
        val ctx = SSLContext.getInstance("TLSv1.3")
        ctx.init(null, arrayOf(trustManager), SecureRandom())
        val factory = ctx.socketFactory
        val raw = factory.createSocket(host, port) as SSLSocket
        raw.startHandshake() // checkServerTrusted() above runs synchronously inside this call
        socket = raw
        onEvent("open", null)

        val out = DataOutputStream(raw.outputStream)
        val input = DataInputStream(raw.inputStream)
        performHandshake(uri, out, input)

        readLoop(input, out) // blocks until closed or the peer closes
        onEvent("close", null)
    }

    fun sendText(text: String) {
        val s = socket ?: return
        synchronized(s) {
            val out = DataOutputStream(s.outputStream)
            writeClientTextFrame(out, text)
        }
    }

    fun close() {
        closed = true
        try { socket?.close() } catch (_: Exception) {}
    }

    // ---- RFC 6455 handshake (mirrors src-tauri/src/room.rs's accept_key(),
    //      same SHA-1 + base64 + the fixed WS_GUID, client side of it) ----
    private fun performHandshake(uri: URI, out: DataOutputStream, input: DataInputStream) {
        val keyBytes = ByteArray(16)
        SecureRandom().nextBytes(keyBytes)
        val key = Base64.encodeToString(keyBytes, Base64.NO_WRAP)
        val path = if (uri.rawQuery != null) "${uri.path}?${uri.rawQuery}" else uri.path
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
        if (!statusLine.contains(" 101 ")) throw java.io.IOException("handshake refused: $statusLine")
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
        if (acceptHeader != expectAccept) throw java.io.IOException("Sec-WebSocket-Accept mismatch - not a real GUIDON room host")
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

    // ---- minimal RFC 6455 client framing: outgoing frames MUST be masked
    //      (server frames are not) - see room.rs's own parse_frames()/
    //      encode_frame() for the server-side mirror of this exact shape ----
    private fun writeClientTextFrame(out: DataOutputStream, text: String) {
        val payload = text.toByteArray(Charsets.UTF_8)
        val mask = ByteArray(4)
        SecureRandom().nextBytes(mask)
        out.writeByte(0x81) // FIN + text opcode
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
    private fun readLoop(input: DataInputStream, out: DataOutputStream) {
        while (!closed) {
            val b0 = input.readByte().toInt() and 0xff
            val op = b0 and 0x0f
            val b1 = input.readByte().toInt() and 0xff
            var len = (b1 and 0x7f).toLong()
            if (len == 126L) len = input.readShort().toLong() and 0xffffL
            else if (len == 127L) len = input.readLong()
            val payload = ByteArray(len.toInt())
            input.readFully(payload)
            when (op) {
                0x1 -> onEvent("message", String(payload, Charsets.UTF_8))
                0x8 -> { closed = true } // close frame - RFC 6455 close handshake omitted from this scaffold
                0x9 -> { /* ping: a real client should pong; omitted from this scaffold */ }
                else -> { /* binary/continuation/pong: this protocol never sends them (room-schema.js) */ }
            }
        }
    }

    companion object {
        private const val WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        private const val B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        // SAME formula as tools/room-tls.mjs and src-tauri/spikes/room_tls_spike:
        // first 5 bytes of SHA-256(SPKI DER), RFC 4648 base32, no padding.
        fun base32(bytes: ByteArray): String {
            var bits = 0; var value = 0; val out = StringBuilder()
            for (b in bytes) {
                value = (value shl 8) or (b.toInt() and 0xff)
                bits += 8
                while (bits >= 5) {
                    out.append(B32[(value ushr (bits - 5)) and 31])
                    bits -= 5
                }
            }
            if (bits > 0) out.append(B32[(value shl (5 - bits)) and 31])
            return out.toString()
        }
    }
}
