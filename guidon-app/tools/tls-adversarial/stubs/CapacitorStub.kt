package com.getcapacitor

/**
 * Minimal JVM-only stand-ins for the small slice of the real com.getcapacitor
 * API surface android/app/src/main/java/app/guidon/trainer/RoomTlsPlugin.kt
 * uses (Plugin, PluginCall, JSObject; PluginMethod lives in its own file
 * alongside this one). See AndroidUtilBase64Stub.kt's header for why these
 * exist and what they are NOT for: zero pin-check or networking logic -
 * they only let the REAL production file compile on a plain JVM, with no
 * Capacitor/AGP/androidx dependency of any kind, so
 * tools/tls-adversarial/Harness.kt can call its real
 * RoomTlsPlugin.verifyPinnedCertificate() directly instead of a hand-copied
 * duplicate.
 *
 * Signatures (param/return types) match the real Capacitor API closely
 * enough for RoomTlsPlugin.kt to compile unmodified - in particular
 * PluginCall.reject()/resolve() must return Unit, matching the real
 * `void`-returning Java methods, since RoomTlsPlugin.kt calls
 * `return call.reject(...)` inside otherwise-Unit-returning plugin methods.
 */
open class Plugin {
    open fun notifyListeners(eventName: String, data: JSObject) { /* no-op stub: this suite never constructs a real RoomTlsPlugin instance or drives its Capacitor bridge */ }
}

open class JSObject {
    open fun put(key: String, value: Any?): JSObject = this
}

open class PluginCall {
    open fun getString(key: String): String? = null
    open fun getLong(key: String): Long? = null
    open fun getInt(key: String): Int? = null
    open fun getDouble(key: String): Double? = null
    open fun reject(message: String) { /* no-op stub */ }
    open fun resolve() { /* no-op stub */ }
    open fun resolve(data: JSObject) { /* no-op stub */ }
}

@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class PluginMethod
