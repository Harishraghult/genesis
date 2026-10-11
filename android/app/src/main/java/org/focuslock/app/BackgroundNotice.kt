package org.focuslock.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock

/** A local reminder for a backgrounded active focus session; no destination app is identified. */
object BackgroundNotice {
    private const val CHANNEL = "focuslock-background-reminder"
    private const val ID = 4107
    private var suppressUntil = 0L

    fun suppressForExpectedExternalActivity() { suppressUntil = SystemClock.elapsedRealtime() + 10_000L }

    fun showIfAppropriate(context: Context): Int? {
        val interactive = (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
        if (!interactive || SystemClock.elapsedRealtime() < suppressUntil) return null
        val local = FocusLocal(context)
        val student = local.localStudentId() ?: return null
        val session = local.localSession() ?: return null
        if (local.state(student, session) !in setOf("active", "paused")) return null
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return session
        runCatching {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(CHANNEL, "Focus session reminders", NotificationManager.IMPORTANCE_HIGH)
            if (QuietMode.access(context)) channel.setBypassDnd(true)
            manager.createNotificationChannel(channel)
            val open = PendingIntent.getActivity(context, ID, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            manager.notify(ID, Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("FocusLock is in the background")
                .setContentText("Return to FocusLock. Your teacher must approve before you can continue.")
                .setContentIntent(open).setAutoCancel(true).build())
        }
        return session
    }

    fun clear(context: Context) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ID)
    }
}
