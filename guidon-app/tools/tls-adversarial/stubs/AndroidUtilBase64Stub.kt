package android.util

/**
 * Minimal JVM-only stand-in for android.util.Base64 - just enough surface
 * (NO_WRAP + encodeToString(ByteArray, Int)) for
 * android/app/src/main/java/app/guidon/trainer/RoomTlsPlugin.kt's
 * PinnedWsClient.performHandshake() to compile on a plain JVM, with no
 * Android SDK, no emulator, no device (room-tls-and-discovery-pitch.md
 * Section 3's adversarial-suite paragraph, closed out by
 * tools/test-tls-adversarial.mjs).
 *
 * This stub carries ZERO logic this task cares about testing - no pin
 * check, no networking, nothing security-relevant. It exists purely so the
 * REAL, unmodified production .kt file can be compiled and run against a
 * genuine adversarial harness instead of a hand-copied reimplementation
 * (see RoomTlsPlugin.kt's own verifyPinnedCertificate() doc comment on why
 * that distinction matters here). Backed by java.util.Base64 so it is at
 * least a real, correct encoder rather than a dead no-op, in case any test
 * case ever exercises PinnedWsClient's handshake path end to end.
 */
object Base64 {
    const val NO_WRAP: Int = 2

    fun encodeToString(input: ByteArray, flags: Int): String =
        java.util.Base64.getEncoder().encodeToString(input)
}
