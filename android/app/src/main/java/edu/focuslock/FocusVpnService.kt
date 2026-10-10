package edu.focuslock

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
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.IOException
import kotlin.concurrent.thread

/**
 * Temporary, consent-based, session-scoped traffic restriction. This is NOT an unbreakable lock.
 *
 * How it works: we create a local VPN whose routes cover all IPv4 and IPv6 destinations. Every
 * app except FocusLock then sends its packets into our tun interface. A background thread reads
 * them and throws them away (a "blackhole"). Nothing is parsed, logged, stored or forwarded, so
 * we never see what other apps were trying to reach.
 *
 * The student can turn this off at any time in system settings. We detect that (onRevoke) and
 * report it. We do not, and cannot, prevent it.
 */
class FocusVpnService : VpnService() {

    enum class Change { STARTED, STOPPED, REVOKED, FAILED }

    companion object {
        private const val TAG = "FocusVpn"
        private const val ACTION_START = "edu.focuslock.vpn.START"
        private const val EXTRA_ENDS_AT_MS = "ends_at_ms"
        private const val CHANNEL_ID = "class_restriction"
        private const val NOTIF_ID = 42

        // Addresses inside the tun interface. They are private, never routed anywhere real.
        private const val TUN_V4 = "10.111.222.1"
        private const val TUN_V4_DNS = "10.111.222.2"
        private const val TUN_V6 = "fd00:f0c5:10c7::1"
        private const val TUN_V6_DNS = "fd00:f0c5:10c7::2"

        /** True while the tunnel is established. Read by the heartbeat (?vpn=1/0). */
        @Volatile var isActive: Boolean = false
            private set

        /** The Activity sets this to hear about start/stop/revoke. Callbacks arrive on the main thread. */
        @Volatile var listener: ((Change) -> Unit)? = null

        /** Set if the user revoked while no listener was attached, so the Activity can report it later. */
        @Volatile var revokedWhileDetached: Boolean = false

        @Volatile private var instance: FocusVpnService? = null

        /**
         * Start the restriction. Call only after VpnService.prepare() returned null or the
         * user accepted the system dialog, and only while the Activity is in the foreground.
         * [endsAtLocalMs] is a hard stop: the service tears itself down at that time even if the
         * Activity is gone and the server is unreachable.
         */
        fun start(ctx: Context, endsAtLocalMs: Long) {
            ctx.startService(
                Intent(ctx, FocusVpnService::class.java)
                    .setAction(ACTION_START)
                    .putExtra(EXTRA_ENDS_AT_MS, endsAtLocalMs)
            )
        }

        /**
         * Stop the restriction and return to normal connectivity. This is a direct in-process call,
         * not an Intent, so it works from onDestroy, on the emergency path and when the app is in
         * the background (where startService() can be refused).
         */
        fun stop() {
            instance?.shutdown(Change.STOPPED)
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var tun: ParcelFileDescriptor? = null
    @Volatile private var draining = false
    private val endsAtStop = Runnable { Log.i(TAG, "ends_at reached, stopping"); shutdown(Change.STOPPED) }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Only start when FocusLock asks during a session. If the system starts us any other way
        // (always-on attempt, process restart), do not create a restriction.
        if (intent?.action != ACTION_START) {
            stopSelf()
            return START_NOT_STICKY
        }
        val endsAt = intent.getLongExtra(EXTRA_ENDS_AT_MS, 0L)
        val remaining = endsAt - System.currentTimeMillis()
        if (remaining <= 0) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (tun == null && !establish()) {
            notify(Change.FAILED)
            stopSelf()
            return START_NOT_STICKY
        }
        main.removeCallbacks(endsAtStop)
        main.postDelayed(endsAtStop, remaining)
        // NOT_STICKY: if the process dies, never resurrect a restriction on our own.
        return START_NOT_STICKY
    }

    private fun establish(): Boolean {
        val builder = Builder()
            .setSession("FocusLock class session")
            .setMtu(1500)
            .setBlocking(true) // the drain thread blocks in read() instead of spinning
            // IPv4: the default route sends all IPv4 traffic of other apps into the tun.
            .addAddress(TUN_V4, 32)
            .addRoute("0.0.0.0", 0)
            // IPv6: without an IPv6 address and the ::/0 route, IPv6 traffic would skip the
            // VPN and go straight out on Wi-Fi or mobile data. Many carriers are IPv6-first.
            .addAddress(TUN_V6, 128)
            .addRoute("::", 0)
            // DNS servers that point back into the tun. Lookups (plain DNS, and Private DNS / DoT
            // to these resolvers) are dropped like everything else, never read.
            .addDnsServer(TUN_V4_DNS)
            .addDnsServer(TUN_V6_DNS)
        // We deliberately do NOT call allowBypass(), so apps cannot opt out of the VPN.

        // Exclude FocusLock itself so it can reach the class server normally.
        // Also exclude phone dialer, continuous glucose monitors (CGM), insulin delivery,
        // and student-registered accommodation apps so medical & life-safety tools
        // are never blocked.
        val defaultExclusions = listOf(
            packageName,
            // Phone & Emergency dialers
            "com.android.dialer",
            "com.google.android.dialer",
            "com.samsung.android.dialer",
            // Medical & Life Safety (CGMs, insulin delivery)
            "com.dexcom.g6",
            "com.dexcom.g7",
            "com.freestylelibre.app.us",
            "com.freestylelibre3.app.us",
            "com.abbott.diabetes.freestylelibre",
            "com.medtronic.diabetes.minimedmobile",
            "com.insulet.myomnipod",
            "com.tandemdiabetes.tconnect",
            // Accessibility & Assistive technology
            "com.google.android.marvin.talkback",
            "com.samsung.android.accessibility.talkback"
        )

        // Read any additional student-registered accommodation packages from preferences
        val registeredAccommodations = try {
            val prefs = getSharedPreferences("focuslock", Context.MODE_PRIVATE)
            prefs.getStringSet("accommodation_packages", emptySet()) ?: emptySet()
        } catch (_: Exception) {
            emptySet()
        }

        val allExclusions = defaultExclusions + registeredAccommodations

        for (pkg in allExclusions) {
            try {
                builder.addDisallowedApplication(pkg)
            } catch (e: PackageManager.NameNotFoundException) {
                // Expected when package is not installed on this device; continue safely
                if (pkg == packageName) {
                    Log.e(TAG, "cannot exclude self", e)
                    return false
                }
            }
        }

        // Network switching: we do not call setUnderlyingNetworks() and we do not listen for
        // connectivity changes. The system keeps the VPN up when the phone moves between Wi-Fi
        // and mobile data, and the routes above apply to whatever network is underneath.
        val pfd = try {
            builder.establish()
        } catch (e: Exception) {
            Log.e(TAG, "establish failed", e)
            null
        } ?: return false // null means the app is not prepared (consent missing or revoked)

        tun = pfd
        isActive = true
        startDrain(pfd)
        goForeground()
        notify(Change.STARTED)
        return true
    }

    /** Read packets and throw them away. No parsing, no logging, no forwarding. */
    private fun startDrain(pfd: ParcelFileDescriptor) {
        draining = true
        thread(name = "focuslock-vpn-drain", isDaemon = true) {
            val input = FileInputStream(pfd.fileDescriptor)
            val buf = ByteArray(32767)
            try {
                while (draining) {
                    if (input.read(buf) < 0) break
                    // Intentionally discarded. We keep reading only so the tun queue does not back up.
                }
            } catch (_: IOException) {
                // Expected when shutdown() closes the descriptor.
            }
        }
    }

    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.vpn_notif_channel), NotificationManager.IMPORTANCE_LOW)
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle(getString(R.string.vpn_notif_title))
            .setContentText(getString(R.string.vpn_notif_text))
            .setStyle(Notification.BigTextStyle().bigText(getString(R.string.vpn_notif_text)))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
            } else {
                startForeground(NOTIF_ID, n)
            }
        } catch (e: Exception) {
            // The tunnel still works without the FGS (the system binds active VPN services itself).
            // The notification is just the visible "restriction is on" signal.
            Log.w(TAG, "startForeground failed; continuing without notification", e)
        }
    }

    /** The user turned the VPN off in Settings, or another VPN app took over. */
    override fun onRevoke() {
        Log.i(TAG, "revoked by user/system")
        if (listener == null) revokedWhileDetached = true
        shutdown(Change.REVOKED)
    }

    override fun onDestroy() {
        shutdown(Change.STOPPED)
        if (instance === this) instance = null
        super.onDestroy()
    }

    @Synchronized
    private fun shutdown(reason: Change) {
        main.removeCallbacks(endsAtStop)
        val pfd = tun ?: return
        tun = null
        draining = false
        isActive = false
        // Closing the descriptor tears the VPN down. Normal connectivity returns at once.
        runCatching { pfd.close() }
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        stopSelf()
        notify(reason)
    }

    private fun notify(change: Change) {
        main.post { listener?.invoke(change) }
    }
}
