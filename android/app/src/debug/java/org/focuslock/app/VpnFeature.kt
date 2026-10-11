package org.focuslock.app

import android.content.Context
import android.content.Intent
import android.net.VpnService

object VpnFeature {
    fun consentIntent(context: Context): Intent? = VpnService.prepare(context)
    fun start(context: Context, sessionId: Int) {
        if (!BuildConfig.ENABLE_LOCAL_VPN) return
        context.startForegroundService(Intent(context, FocusVpnService::class.java).setAction(FocusVpnService.START).putExtra(FocusVpnService.SESSION, sessionId))
    }
    fun stop(context: Context) {
        context.startService(Intent(context, FocusVpnService::class.java).setAction(FocusVpnService.STOP))
    }
    fun reconcile(context: Context): Boolean {
        val prefs = context.getSharedPreferences("focuslock-vpn", Context.MODE_PRIVATE)
        if (prefs.getBoolean("running", false) && !FocusVpnService.running) prefs.edit().putBoolean("running", false).apply()
        return FocusVpnService.running
    }
}
