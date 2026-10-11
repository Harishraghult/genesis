package org.focuslock.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import java.io.FileInputStream

/** Debug-lab only. Reads and discards tunnel bytes without parsing, logging or forwarding them. */
class FocusVpnService : VpnService() {
    companion object {
        const val START = "org.focuslock.app.START_LOCAL_VPN"
        const val STOP = "org.focuslock.app.STOP_LOCAL_VPN"
        const val SESSION = "session_id"
        @Volatile var running = false
            private set
        private const val CHANNEL = "focuslock-local-vpn"
        private const val NOTIFICATION = 4104
    }

    private var tunnel: ParcelFileDescriptor? = null
    private var reader: Thread? = null
    private val handler = Handler(Looper.getMainLooper())
    private var deadline = 0L
    private var boot = -1
    private var sessionId = -1
    private var shuttingDown = false
    private val watchdog = object : Runnable {
        override fun run() {
            if (!valid()) { shutdown(); return }
            handler.postDelayed(this, 1000)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { shutdown(); return Service.START_NOT_STICKY }
        if (!BuildConfig.ENABLE_LOCAL_VPN || intent?.action != START || running) {
            stopSelf(); return Service.START_NOT_STICKY
        }
        sessionId = intent.getIntExtra(SESSION, -1)
        val focus = FocusLocal(this)
        val student = focus.localStudentId()
        val lease = student?.let { focus.deadline(it, sessionId) }
        if (lease == null || VpnService.prepare(this) != null) {
            shutdown(); return Service.START_NOT_STICKY
        }
        boot = lease.first
        deadline = lease.second
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "FocusLock local focus", NotificationManager.IMPORTANCE_LOW))
            val notice = notification()
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(NOTIFICATION, notice)
            tunnel = Builder().setSession("FocusLock voluntary focus")
                .setMtu(1500)
                .addAddress("10.111.0.1", 32).addAddress("fd42:1111:1111::1", 128)
                .addRoute("0.0.0.0", 0).addRoute("::", 0)
                .addDnsServer("10.111.0.1").addDnsServer("fd42:1111:1111::1")
                .addDisallowedApplication(packageName)
                .establish() ?: error("Android did not establish the local VPN")
            running = true
            getSharedPreferences("focuslock-vpn", MODE_PRIVATE).edit().putBoolean("running", true).apply()
            reader = Thread({ discardPackets() }, "focuslock-discard").apply { isDaemon = true; start() }
            handler.post(watchdog)
        } catch (_: Exception) { shutdown() }
        return Service.START_NOT_STICKY
    }

    private fun valid(): Boolean {
        val student = FocusLocal(this).localStudentId() ?: return false
        val saved = FocusLocal(this).deadline(student, sessionId) ?: return false
        return saved.first == boot && saved.second == deadline &&
            FocusDeadline.isLive(boot, android.provider.Settings.Global.getInt(contentResolver, android.provider.Settings.Global.BOOT_COUNT, -1), deadline, SystemClock.elapsedRealtime())
    }

    private fun discardPackets() {
        val descriptor = tunnel ?: return
        try {
            FileInputStream(descriptor.fileDescriptor).use { input ->
                val bytes = ByteArray(32768)
                while (running && valid()) {
                    val count = input.read(bytes)
                    if (count < 0) break
                    if (count == 0) Thread.sleep(25)
                    // Intentionally discard opaque bytes; no packet metadata is parsed or stored.
                }
            }
        } catch (_: Exception) { /* Closing the tunnel interrupts the read. */ }
        handler.post { shutdown() }
    }

    private fun notification(): Notification {
        val stop = Intent(this, FocusVpnService::class.java).setAction(STOP)
        val stopAction = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("FocusLock local focus is on")
            .setContentText("Other apps' network traffic is discarded locally. Stop VPN at any time.")
            .setContentIntent(open).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Stop Focus VPN", stopAction).build())
            .build()
    }

    private fun shutdown() {
        if (shuttingDown) return
        shuttingDown = true
        handler.removeCallbacks(watchdog)
        running = false
        getSharedPreferences("focuslock-vpn", MODE_PRIVATE).edit().putBoolean("running", false).apply()
        tunnel?.close(); tunnel = null
        reader?.interrupt(); reader = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onRevoke() { shutdown(); super.onRevoke() }
    override fun onDestroy() { shutdown(); super.onDestroy() }
}
