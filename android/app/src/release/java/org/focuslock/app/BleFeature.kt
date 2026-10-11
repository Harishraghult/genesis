package org.focuslock.app

import android.content.Context

/** Release artifact has no BLE permission or advertiser implementation. */
object BleFeature {
    val status: String = "disabled"
    fun start(appContext: Context, credential: BleCredential, requestStart: Long, session: Int) = Unit
    fun stop() = Unit
}
