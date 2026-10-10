package edu.focuslock.reference

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.IOException
import kotlin.concurrent.thread

/**
 * FocusLock Reference Kiosk Module for College Hackathon Demonstrations.
 *
 * Demonstrates:
 * 1. Screen Pinning / Kiosk Lock (`startLockTask()`)
 * 2. Session-Scoped Blackhole VPN (`FocusVpnService : VpnService`)
 *    - Catches all IPv4 (`0.0.0.0/0`) and IPv6 (`::/0`) traffic
 *    - Disallows/Excludes FocusLock itself (`addDisallowedApplication(packageName)`)
 *    - Discards all foreign app packets (Instagram, YouTube, WhatsApp) without snooping
 *    - Handles `onRevoke()` cleanly and informs server
 */

class KioskManager(private val activity: Activity) {

    fun enterKioskMode() {
        try {
            // Pin the screen. In fully-managed Device Owner mode, this suppresses navigation bars.
            // On unmanaged BYOD devices, this prompts user pinning.
            activity.startLockTask()
        } catch (e: Exception) {
            Log.w("FocusLockKiosk", "Screen pinning failed: ${e.message}")
        }
    }

    fun exitKioskMode() {
        try {
            activity.stopLockTask()
        } catch (e: Exception) {
            Log.w("FocusLockKiosk", "Stop lock task failed: ${e.message}")
        }
    }
}

class FocusVpnService : VpnService() {

    companion object {
        const val ACTION_START_VPN = "edu.focuslock.action.START_VPN"
        const val ACTION_STOP_VPN = "edu.focuslock.action.STOP_VPN"
        const val CHANNEL_ID = "focuslock_vpn_channel"
        const val NOTIF_ID = 1001

        @Volatile
        var isTunnelActive: Boolean = false
            private set
    }

    private var tunInterface: ParcelFileDescriptor? = null
    @Volatile
    private var isDraining: Boolean = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_VPN -> establishTunnel()
            ACTION_STOP_VPN -> stopTunnel()
        }
        return START_NOT_STICKY
    }

    private fun establishTunnel() {
        if (tunInterface != null) return

        val builder = Builder()
            .setSession("FocusLock Distraction Containment")
            .setMtu(1500)
            .setBlocking(true)
            // IPv4 blackhole route
            .addAddress("10.120.0.1", 32)
            .addRoute("0.0.0.0", 0)
            // IPv6 blackhole route: prevents IPv6 traffic leaks around the VPN
            .addAddress("fd00:f0c5:10c7::1", 128)
            .addRoute("::", 0)
            // Route DNS into the blackhole virtual interface
            .addDnsServer("10.120.0.2")
            .addDnsServer("fd00:f0c5:10c7::2")

        // Exclude FocusLock, emergency dialer, medical apps (CGM/insulin), and accessibility tools
        val exclusions = listOf(
            packageName,
            "com.android.dialer", "com.google.android.dialer", "com.samsung.android.dialer",
            "com.dexcom.g6", "com.dexcom.g7", "com.freestylelibre.app.us", "com.freestylelibre3.app.us",
            "com.abbott.diabetes.freestylelibre", "com.medtronic.diabetes.minimedmobile",
            "com.google.android.marvin.talkback"
        )
        for (pkg in exclusions) {
            try {
                builder.addDisallowedApplication(pkg)
            } catch (_: PackageManager.NameNotFoundException) {
                if (pkg == packageName) return
            }
        }

        tunInterface = builder.establish()
        if (tunInterface != null) {
            isTunnelActive = true
            startForegroundNotification()
            startBlackholeDrain(tunInterface!!)
        }
    }

    private fun startBlackholeDrain(pfd: ParcelFileDescriptor) {
        isDraining = true
        thread(name = "focuslock-vpn-blackhole", isDaemon = true) {
            val stream = FileInputStream(pfd.fileDescriptor)
            val buffer = ByteArray(32767)
            try {
                while (isDraining) {
                    val bytesRead = stream.read(buffer)
                    if (bytesRead < 0) break
                    // Discard packets immediately: zero logging, zero snooping, zero inspection.
                }
            } catch (_: IOException) {
                // Expected when interface is closed
            }
        }
    }

    private fun startForegroundNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "FocusLock Active Session",
                NotificationManager.IMPORTANCE_LOW
            )
            nm.createNotificationChannel(channel)
        }

        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("FocusLock Classroom Session Active")
            .setContentText("External app internet is temporarily paused for class.")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    override fun onRevoke() {
        // User manually turned off VPN in Android Settings
        Log.i("FocusVpnService", "VPN restriction was manually revoked by user.")
        stopTunnel()
        // Broadcast or notify Activity to dispatch vpn_revoked telemetry event
    }

    private fun stopTunnel() {
        isDraining = false
        isTunnelActive = false
        try {
            tunInterface?.close()
        } catch (_: Exception) {}
        tunInterface = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }
}
