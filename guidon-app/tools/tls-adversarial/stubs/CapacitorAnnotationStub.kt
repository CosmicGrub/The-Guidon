package com.getcapacitor.annotation

/**
 * See CapacitorStub.kt's header - same rationale, just the one annotation
 * that lives in its own real Capacitor package (com.getcapacitor.annotation
 * rather than com.getcapacitor), so it needs its own package declaration.
 */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class CapacitorPlugin(val name: String = "")
