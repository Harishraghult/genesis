package org.focuslock.app

import android.content.Context
import android.content.Intent

/** Release artifacts contain no VpnService implementation or manifest declaration. */
object VpnFeature {
    fun consentIntent(context: Context): Intent? = null
    fun start(context: Context, sessionId: Int) = Unit
    fun stop(context: Context) = Unit
    fun reconcile(context: Context): Boolean = false
}
