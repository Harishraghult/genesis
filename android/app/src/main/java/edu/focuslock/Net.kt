package edu.focuslock

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer
import org.json.JSONObject
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/** Per-session credentials returned by /api/checkin. */
data class Creds(val sessionId: String, val studentId: String, val secretHex: String)

/**
 * Signs every /portal/ and /api/client/ request. It runs as a *network* interceptor, so it signs
 * exactly the method, path, query and body that go on the wire. The maths lives in [Signer].
 */
class SigningInterceptor(
    private val creds: () -> Creds?,
    private val serverClockOffsetSec: () -> Long,
) : Interceptor {
    private val rng = SecureRandom()

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val c = creds()
        val path = req.url.encodedPath
        if (c == null || !(path.startsWith("/portal") || path.startsWith("/api/client/"))) {
            return chain.proceed(req)
        }
        val body = req.body?.let { b -> Buffer().also { b.writeTo(it) }.readByteArray() } ?: ByteArray(0)
        val pathWithQuery = path + (req.url.encodedQuery?.let { "?$it" } ?: "")
        // Use server time (offset learnt at check-in) so a phone with a wrong clock is not rejected as stale.
        val ts = (System.currentTimeMillis() / 1000 + serverClockOffsetSec()).toString()
        val nonce = ByteArray(12).also(rng::nextBytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val sig = Signer.sign(c.secretHex, req.method, pathWithQuery, ts, nonce, body)
        return chain.proceed(
            req.newBuilder()
                .header("X-FL-Session", c.sessionId)
                .header("X-FL-Student", c.studentId)
                .header("X-FL-Ts", ts)
                .header("X-FL-Nonce", nonce)
                .header("X-FL-Sig", sig)
                .build()
        )
    }
}

/** Thin API wrapper. All calls are blocking, so call them off the main thread. They throw IOException on network errors. */
class Api(baseUrl: String) {
    val base = baseUrl.trimEnd('/')
    @Volatile var creds: Creds? = null
    @Volatile var clockOffsetSec: Long = 0

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .addNetworkInterceptor(SigningInterceptor({ creds }, { clockOffsetSec }))
        .build()

    private val json = "application/json".toMediaType()

    fun syncClock() {
        http.newCall(Request.Builder().url("$base/api/health").build()).execute().use { r ->
            val serverTime = JSONObject(r.body!!.string()).getDouble("server_time").toLong()
            clockOffsetSec = serverTime - System.currentTimeMillis() / 1000
        }
    }

    /** Returns (httpCode, json-or-null). */
    fun checkin(sessionId: String, studentId: String, code: String, deviceKeyHex: String): Pair<Int, JSONObject?> {
        val ts = (System.currentTimeMillis() / 1000 + clockOffsetSec).toString()
        val payload = JSONObject()
            .put("session_id", sessionId).put("student_id", studentId).put("code", code)
            .put("ts", ts.toLong())
            .put("device_sig", Signer.deviceSig(deviceKeyHex, sessionId, studentId, code, ts))
        val req = Request.Builder().url("$base/api/checkin").post(payload.toString().toRequestBody(json)).build()
        http.newCall(req).execute().use { r ->
            val text = r.body?.string().orEmpty()
            return r.code to runCatching { JSONObject(text) }.getOrNull()
        }
    }

    /** The VPN state rides in the query string, which is part of the signed path. */
    fun heartbeat(vpnActive: Boolean): Int =
        code(Request.Builder().url("$base/api/client/heartbeat?vpn=${if (vpnActive) 1 else 0}").get().build())

    fun event(type: String, detail: String? = null, quick: Boolean = false): Int {
        val body = JSONObject().put("type", type).apply { if (detail != null) put("detail", detail) }
        return code(Request.Builder().url("$base/api/client/event").post(body.toString().toRequestBody(json)).build(), quick)
    }

    /** Uses the short-timeout client: exiting must never hang on an unreachable server. */
    fun leave(): Int =
        code(Request.Builder().url("$base/api/client/leave").post(ByteArray(0).toRequestBody(null)).build(), quick = true)

    /** Same interceptor and timeouts as [http], but every call gives up after 3 s in total. */
    private val quickHttp: OkHttpClient by lazy { http.newBuilder().callTimeout(3, TimeUnit.SECONDS).build() }

    private fun code(req: Request, quick: Boolean = false): Int =
        (if (quick) quickHttp else http).newCall(req).execute().use { it.code }
}

/**
 * Fix for the mobile-data problem: keep FocusLock's own traffic on the classroom Wi-Fi.
 *
 * A classroom Wi-Fi often has no internet uplink, so Android marks it "no internet" and makes
 * mobile data the default network. Then check-in and heartbeats leave over the carrier
 * network, arrive from outside FL_CLASSROOM_NETS and get a 403. Binding *this process* to the
 * Wi-Fi network sends our requests (OkHttp and the WebView) over Wi-Fi even when it is not
 * the default. It affects only FocusLock, not other apps.
 */
class ClassroomNetwork(context: Context, private val onChange: (onWifi: Boolean) -> Unit) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun pin() {
        if (callback != null) return
        val req = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { cm.bindProcessToNetwork(network); onChange(true) }
            override fun onLost(network: Network) { cm.bindProcessToNetwork(null); onChange(false) }
        }
        callback = cb
        cm.requestNetwork(req, cb)
    }

    fun release() {
        callback?.let { runCatching { cm.unregisterNetworkCallback(it) } }
        callback = null
        cm.bindProcessToNetwork(null)
    }
}
