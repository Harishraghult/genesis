package org.focuslock.app

import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Base64
import java.nio.ByteBuffer
import java.time.Instant
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Short-lived, anonymous BLE advertising. No credential is persisted on device. */
object BleFeature {
    @Volatile var status: String = "off"
        private set
    private val handler = Handler(Looper.getMainLooper())
    private var callback: AdvertiseCallback? = null
    private var advertiser: android.bluetooth.le.BluetoothLeAdvertiser? = null
    private var secret: ByteArray? = null
    private var deadline = 0L
    private var serverEpoch = 0L
    private var requestElapsed = 0L
    private var slotSeconds = 15
    private var context: Context? = null
    private var sessionId = -1
    private val rotate = object : Runnable {
        override fun run() {
            val app = context ?: return
            val student = FocusLocal(app).localStudentId()
            if (student == null || FocusLocal(app).state(student, sessionId) != "active" || SystemClock.elapsedRealtime() >= deadline) {
                stop(); status = "expired_or_paused"; return
            }
            val current = secret ?: return
            val slot = (serverEpoch + (SystemClock.elapsedRealtime() - requestElapsed) / 1000) / slotSeconds
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(current, "HmacSHA256"))
            val token = mac.doFinal(slot.toString().toByteArray(Charsets.US_ASCII))
            val values = ByteBuffer.wrap(byteArrayOf(0xF1.toByte(), 0x0C, 0x0C, 0x10) + token.copyOfRange(0, 12))
            val uuid = UUID(values.long, values.long)
            try {
                callback?.let { advertiser?.stopAdvertising(it) }
                val next = object : AdvertiseCallback() {
                    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) { status = "advertising" }
                    override fun onStartFailure(errorCode: Int) { stop(); status = "unsupported_or_unavailable" }
                }
                callback = next
                advertiser?.startAdvertising(
                    AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
                        .setConnectable(false).setTimeout(0).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_LOW).build(),
                    AdvertiseData.Builder().setIncludeDeviceName(false).addServiceUuid(ParcelUuid(uuid)).build(), next)
                handler.postDelayed(this, 1000L.coerceAtLeast((slotSeconds - ((serverEpoch + (SystemClock.elapsedRealtime() - requestElapsed) / 1000) % slotSeconds)) * 1000))
            } catch (_: Exception) { stop(); status = "unsupported_or_unavailable" }
        }
    }

    fun start(appContext: Context, credential: BleCredential, requestStart: Long, session: Int) {
        stop()
        if (!BuildConfig.ENABLE_BLE_PRESENCE || !appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            status = "unsupported_or_unavailable"; return
        }
        try {
            val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            advertiser = manager.adapter?.bluetoothLeAdvertiser
            if (advertiser == null) { status = "unsupported_or_unavailable"; return }
            secret = Base64.decode(credential.secret, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            require(secret?.size == 32 && credential.slotSeconds == 15)
            serverEpoch = Instant.parse(credential.serverTime).epochSecond
            val expires = Instant.parse(credential.expiresAt).epochSecond
            require(expires > serverEpoch && expires - serverEpoch <= 300)
            deadline = Math.addExact(requestStart, Math.multiplyExact(expires - serverEpoch, 1000L))
            require(SystemClock.elapsedRealtime() < deadline)
            requestElapsed = requestStart
            slotSeconds = credential.slotSeconds
            context = appContext.applicationContext
            sessionId = session
            status = "starting"
            handler.post(rotate)
        } catch (_: Exception) { stop(); status = "unsupported_or_unavailable" }
    }

    fun stop() {
        handler.removeCallbacks(rotate)
        try { callback?.let { advertiser?.stopAdvertising(it) } } catch (_: Exception) { }
        callback = null
        advertiser = null
        secret?.fill(0)
        secret = null
        context = null
        status = "off"
    }
}
