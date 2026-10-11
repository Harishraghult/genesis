package edu.focuslock

import android.app.Activity
import android.app.ActivityManager
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import okhttp3.Request
import java.io.IOException
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * FocusLock student client. There is one Activity with three panels:
 *   check-in  ->  VPN consent (optional restriction)  ->  locked portal
 *
 * The optional VPN is a temporary, consent-based restriction of other apps' internet. It is not an
 * unbreakable lock: the student can switch it off in Settings. We detect and report that.
 */
class MainActivity : Activity() {

    private enum class Mode { CHECKIN, CONSENT, LOCKED }

    private companion object {
        const val REQ_VPN = 7
    }

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val prefs by lazy { getSharedPreferences("focuslock", MODE_PRIVATE) }
    private lateinit var classroomNet: ClassroomNetwork

    private var mode = Mode.CHECKIN
    private var api: Api? = null
    private var serverHost = ""
    private var allowedHosts = emptySet<String>()
    private var endsAtLocalMs = 0L
    private var heartbeatS = 10
    private var heartbeatThread: Thread? = null
    private var vpnState = "off"          // off | on | declined | revoked | failed
    private var netNote = ""
    private var leaving = false
    private var unpinnedReported = false

    // Client-side safety timer: unlock and stop the VPN at ends_at even if the server is unreachable.
    private val endsAtTimer = Runnable { endSession("Class time is over.") }

    private val panelCheckin by lazy { findViewById<View>(R.id.panelCheckin) }
    private val panelConsent by lazy { findViewById<View>(R.id.panelConsent) }
    private val panelLocked by lazy { findViewById<View>(R.id.panelLocked) }
    private val web by lazy { findViewById<WebView>(R.id.web) }
    private val txtStatus by lazy { findViewById<TextView>(R.id.txtStatus) }
    private val txtCheckinStatus by lazy { findViewById<TextView>(R.id.txtCheckinStatus) }
    private val btnVpnRetry by lazy { findViewById<Button>(R.id.btnVpnRetry) }

    // ------------------------------------------------------------------ lifecycle

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Hardened Anti-Tamper Layer: FLAG_SECURE blocks external screen-capture,
        // mirroring malware, and blanks the Recent Apps task switcher preview.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        setContentView(R.layout.activity_main)

        field(R.id.inServer).setText(prefs.getString("server", ""))
        field(R.id.inStudent).setText(prefs.getString("student", ""))
        field(R.id.inDeviceKey).setText(prefs.getString("device_key", ""))

        classroomNet = ClassroomNetwork(this) { onWifi ->
            main.post { if (!onWifi) netNote = "Classroom Wi-Fi lost."; refreshStatus() }
        }
        classroomNet.pin()

        FocusVpnService.listener = ::onVpnChange

        findViewById<Button>(R.id.btnCheckin).setOnClickListener { doCheckin() }
        findViewById<Button>(R.id.btnConsentYes).setOnClickListener { requestVpn() }
        findViewById<Button>(R.id.btnConsentNo).setOnClickListener { vpnDeclined() }
        findViewById<Button>(R.id.btnExit).setOnClickListener { exitSession() }
        findViewById<Button>(R.id.btnEmergency).setOnClickListener { emergency() }
        btnVpnRetry.setOnClickListener { requestVpn() }

        show(Mode.CHECKIN)
    }

    override fun onResume() {
        super.onResume()
        if (mode == Mode.LOCKED && !leaving) {
            report("resume")
            if (FocusVpnService.revokedWhileDetached) {
                FocusVpnService.revokedWhileDetached = false
                onVpnChange(FocusVpnService.Change.REVOKED)
            }
            checkPinned()
        }
    }

    override fun onPause() {
        super.onPause()
        if (mode == Mode.LOCKED && !leaving) report("pause")
    }

    override fun onDestroy() {
        // Rotation does not recreate us (configChanges in the manifest), but guard anyway:
        // only a real destroy ends the restriction.
        if (!isChangingConfigurations) {
            FocusVpnService.stop()
            stopHeartbeat()
            main.removeCallbacks(endsAtTimer)
            classroomNet.release()
        }
        // If the process crashes instead, the kernel closes the tun descriptor and Android removes
        // the VPN. The service is START_NOT_STICKY, so it is never restarted by itself.
        if (FocusVpnService.listener == ::onVpnChange) FocusVpnService.listener = null
        io.shutdown()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when (mode) {
            Mode.LOCKED -> if (web.canGoBack()) web.goBack()   // never leave the lock via Back
            Mode.CONSENT -> vpnDeclined()
            Mode.CHECKIN -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    // ------------------------------------------------------------------ check-in

    private fun doCheckin() {
        val server = field(R.id.inServer).text.toString().trim()
        val student = field(R.id.inStudent).text.toString().trim()
        val deviceKey = field(R.id.inDeviceKey).text.toString().trim()
        val session = field(R.id.inSession).text.toString().trim()
        val code = field(R.id.inCode).text.toString().trim()
        if (server.isEmpty() || student.isEmpty() || deviceKey.length != 64 || session.isEmpty() || code.length != 6) {
            txtCheckinStatus.text = "Fill in every field (device key is 64 hex characters)."
            return
        }
        prefs.edit().putString("server", server).putString("student", student).putString("device_key", deviceKey).apply()
        txtCheckinStatus.text = "Checking in…"

        io.execute {
            val msg: String? = try {
                val a = Api(server)
                a.syncClock()
                val (status, json) = a.checkin(session, student, code, deviceKey)
                if (status == 200 && json != null) {
                    val policy = json.getJSONObject("policy")
                    val hosts = policy.getJSONArray("allowed_hosts")
                    main.post {
                        a.creds = Creds(session, student, json.getString("secret"))
                        api = a
                        serverHost = Uri.parse(a.base).host.orEmpty().lowercase()
                        allowedHosts = (0 until hosts.length()).map { hosts.getString(it).lowercase() }.toSet() + serverHost
                        heartbeatS = policy.getInt("heartbeat_s")
                        // Convert server-clock ends_at to this phone's clock.
                        endsAtLocalMs = ((policy.getDouble("ends_at") - a.clockOffsetSec) * 1000).toLong()
                        main.postDelayed(endsAtTimer, (endsAtLocalMs - System.currentTimeMillis()).coerceAtLeast(0))
                        show(Mode.CONSENT)
                    }
                    null
                } else {
                    val detail = json?.optString("detail").orEmpty()
                    when (status) {
                        403 -> "Rejected ($detail). Check-in only works on the classroom Wi-Fi with an enrolled device."
                        else -> "Check-in failed: $status $detail"
                    }
                }
            } catch (e: Exception) {
                "Cannot reach the server. Are you on the classroom Wi-Fi? (${e.javaClass.simpleName})"
            }
            if (msg != null) main.post { txtCheckinStatus.text = msg }
        }
    }

    // ------------------------------------------------------------------ VPN consent

    /** Called after the student read our plain-language consent screen and tapped "Turn on". */
    private fun requestVpn() {
        val intent = try {
            VpnService.prepare(this)
        } catch (e: Exception) {
            report("vpn_failed", "prepare"); enterLocked(); return
        }
        if (intent == null) {
            onActivityResult(REQ_VPN, RESULT_OK, null) // already consented earlier
        } else {
            try {
                startActivityForResult(intent, REQ_VPN) // the system "Connection request" dialog
            } catch (e: ActivityNotFoundException) {
                report("vpn_failed", "no_dialog"); enterLocked()
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_VPN) return
        if (resultCode == RESULT_OK && endsAtLocalMs > System.currentTimeMillis()) {
            // Start right after check-in. FocusVpnService reports STARTED via onVpnChange.
            FocusVpnService.start(this, endsAtLocalMs)
            enterLocked()
        } else {
            vpnDeclined()
        }
    }

    /** Declining is respected: portal-only mode (the original behaviour). */
    private fun vpnDeclined() {
        if (mode == Mode.LOCKED && vpnState == "revoked") return // retry dialog cancelled; already reported
        vpnState = "declined"
        report("vpn_declined")
        enterLocked()
    }

    private fun onVpnChange(change: FocusVpnService.Change) {
        when (change) {
            FocusVpnService.Change.STARTED -> { vpnState = "on"; report("vpn_started") }
            FocusVpnService.Change.REVOKED -> if (mode == Mode.LOCKED) { vpnState = "revoked"; report("vpn_revoked") }
            FocusVpnService.Change.FAILED -> { vpnState = "failed"; report("vpn_failed") }
            FocusVpnService.Change.STOPPED -> if (vpnState == "on") vpnState = "off"
        }
        refreshStatus()
    }

    // ------------------------------------------------------------------ locked mode

    private fun enterLocked() {
        if (mode == Mode.LOCKED) { refreshStatus(); return }
        show(Mode.LOCKED)
        setupWebView()
        web.loadUrl("${api!!.base}/portal/")
        try { startLockTask() } catch (_: Exception) { /* pinning refused; reported as unpinned */ }
        enableDndMode()
        startHeartbeat()
    }

    private fun setupWebView() {
        web.settings.javaScriptEnabled = false
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host?.lowercase() in allowedHosts) return false
                Toast.makeText(this@MainActivity, R.string.nav_denied, Toast.LENGTH_SHORT).show()
                report("nav_denied") // no URL: we never log destinations
                return true
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val host = request.url.host?.lowercase() ?: return blocked()
                if (host !in allowedHosts) return blocked()
                if (host == serverHost && request.method == "GET") return fetchSigned(request.url.toString())
                return null // other allow-listed hosts load normally
            }
        }
    }

    /** Portal pages go through OkHttp so the SigningInterceptor can sign them. */
    private fun fetchSigned(url: String): WebResourceResponse {
        val a = api ?: return blocked()
        return try {
            val r = a.http.newCall(Request.Builder().url(url).get().build()).execute()
            if (r.code == 410) main.post { endSession("The instructor ended the session.") }
            val ct = r.header("Content-Type") ?: "text/html; charset=utf-8"
            val charset = Regex("charset=([^;]+)").find(ct)?.groupValues?.get(1)?.trim() ?: "utf-8"
            val code = if (r.code in 300..399) 502 else r.code
            WebResourceResponse(ct.substringBefore(';').trim(), charset, code,
                r.message.ifBlank { "OK" }, emptyMap(), r.body!!.byteStream())
        } catch (e: IOException) {
            html(503, "<h3 style='font-family:sans-serif'>Class server unreachable. Retrying…</h3>")
        }
    }

    private fun blocked() = html(403, "")
    private fun html(code: Int, body: String) = WebResourceResponse(
        "text/html", "utf-8", code, if (code == 403) "Forbidden" else "Unavailable", emptyMap(), body.byteInputStream()
    )

    private fun startHeartbeat() {
        stopHeartbeat()
        val a = api ?: return
        heartbeatThread = thread(name = "focuslock-heartbeat", isDaemon = true) {
            try {
                while (!Thread.currentThread().isInterrupted) {
                    if (System.currentTimeMillis() >= endsAtLocalMs) {
                        main.post { endSession("Class time is over.") }
                        return@thread
                    }
                    val note = try {
                        when (val code = a.heartbeat(FocusVpnService.isActive)) {
                            200 -> ""
                            410 -> { main.post { endSession("The instructor ended the session.") }; return@thread }
                            403 -> "Off the classroom network (mobile data?). Reconnect to the classroom Wi-Fi."
                            401 -> "Server no longer recognises this check-in. Exit and check in again."
                            else -> "Server error $code. Retrying."
                        }
                    } catch (e: IOException) {
                        "Class server unreachable. Retrying." // tolerated; the lock holds until ends_at
                    }
                    main.post { netNote = note; checkPinned(); refreshStatus() }
                    Thread.sleep(heartbeatS * 1000L)
                }
            } catch (_: InterruptedException) {
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeatThread?.interrupt()
        heartbeatThread = null
    }

    private fun checkPinned() {
        if (mode != Mode.LOCKED) return
        val am = getSystemService(ActivityManager::class.java)
        if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
            if (!unpinnedReported) { unpinnedReported = true; report("unpinned") }
        } else {
            unpinnedReported = false
        }
    }

    // ------------------------------------------------------------------ leaving

    /** Exit: tell the server first, then stop the VPN and unlock. */
    private fun exitSession() {
        if (leaving) return
        leaving = true
        txtStatus.text = "Exiting…"
        val a = api
        val vpnWasOn = FocusVpnService.isActive
        io.execute {
            try {
                if (vpnWasOn) a?.event("vpn_stopped", "exit", quick = true)
                a?.leave()
            } catch (_: Exception) {
                // Server unreachable: leave anyway. Exit must always work.
            }
            main.post { endSession("You left the session.") }
        }
    }

    /**
     * Emergency: the VPN stops FIRST, locally, with no network call. Then the dialer opens.
     * Emergency access must never depend on the VPN or the server.
     * The emergency number is configurable by region (defaults to 112, can be 911, 999, etc.).
     */
    private fun emergency() {
        leaving = true
        // 1. Tear down the VPN locally FIRST - immediate synchronous teardown
        FocusVpnService.stop()
        runCatching { stopLockTask() } // a pinned screen cannot launch the dialer

        // 2. Configurable regional emergency number (preferences or default 112)
        val emergencyNumber = prefs.getString("emergency_number", "112")?.ifBlank { "112" } ?: "112"

        try {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$emergencyNumber")))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "No dialer found. Call $emergencyNumber from any phone.", Toast.LENGTH_LONG).show()
        }

        // 3. Network reporting occurs asynchronously only AFTER local teardown
        val a = api
        io.execute {
            runCatching { a?.event("vpn_stopped", "emergency", quick = true) }
            runCatching { a?.event("emergency_exit", quick = true) }
            runCatching { a?.leave() }
            main.post { endSession("Emergency exit. The restriction is off.") }
        }
    }

    /** Single exit path for every reason (410, ends_at, exit, emergency). It is idempotent. */
    private fun endSession(message: String) {
        if (mode == Mode.CHECKIN) return
        main.removeCallbacks(endsAtTimer)
        stopHeartbeat()
        FocusVpnService.stop() // normal connectivity returns as soon as the tun is closed
        runCatching { stopLockTask() }
        disableDndMode()
        api?.creds = null
        api = null
        vpnState = "off"
        netNote = ""
        leaving = false
        web.loadUrl("about:blank")
        show(Mode.CHECKIN)
        field(R.id.inCode).setText("")
        txtCheckinStatus.text = "$message Normal internet is restored."
    }

    private fun enableDndMode() {
        try {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm != null && nm.isNotificationPolicyAccessGranted) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
            }
        } catch (_: Exception) {}
    }

    private fun disableDndMode() {
        try {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm != null && nm.isNotificationPolicyAccessGranted) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
            }
        } catch (_: Exception) {}
    }

    // ------------------------------------------------------------------ helpers

    private fun report(type: String, detail: String? = null) {
        val a = api ?: return
        io.execute {
            try {
                if (a.event(type, detail) == 410) main.post { endSession("The instructor ended the session.") }
            } catch (_: IOException) {
                // Best effort. The heartbeat still carries the VPN state.
            } catch (_: Exception) {
            }
        }
    }

    private fun refreshStatus() {
        if (mode != Mode.LOCKED) return
        val ends = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(endsAtLocalMs))
        val vpn = when {
            FocusVpnService.isActive -> "Other apps: blocked"
            vpnState == "revoked" -> "Restriction turned off (reported)"
            vpnState == "declined" -> "Portal-only mode"
            vpnState == "failed" -> "Restriction unavailable"
            else -> "Restriction off"
        }
        txtStatus.text = listOf("Ends $ends", vpn, netNote).filter { it.isNotBlank() }.joinToString(" · ")
        btnVpnRetry.visibility = if (vpnState == "revoked" && !FocusVpnService.isActive) View.VISIBLE else View.GONE
    }

    private fun show(m: Mode) {
        mode = m
        panelCheckin.visibility = if (m == Mode.CHECKIN) View.VISIBLE else View.GONE
        panelConsent.visibility = if (m == Mode.CONSENT) View.VISIBLE else View.GONE
        panelLocked.visibility = if (m == Mode.LOCKED) View.VISIBLE else View.GONE
        refreshStatus()
    }

    private fun field(id: Int) = findViewById<EditText>(id)
}
