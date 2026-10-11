package org.focuslock.app

import android.app.Application
import android.net.Uri
import android.content.Intent
import android.os.SystemClock
import java.util.UUID
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class UiState(
    val student: Student? = null,
    val sessions: List<ClassSession> = emptyList(),
    val history: List<HistoryEntry> = emptyList(),
    val privacyRequests: List<PrivacyRequest> = emptyList(),
    val detail: ClassSession? = null,
    val pendingLocal: Set<Int> = emptySet(),
    val checkInResult: String? = null,
    val resources: List<CourseResource> = emptyList(),
    val focusState: String = "ready",
    val focusSessionId: Int? = null,
    val autoNavigateFocusId: Int? = null,
    val quietRequested: Boolean = false,
    val receiverState: String = "unknown",
    val presenceState: String = "off",
    val authConfig: AuthConfig? = null,
    val loading: Boolean = false,
    val error: String? = null
)

class FocusViewModel(application: Application) : AndroidViewModel(application) {
    private val api = Api()
    private val identity = DeviceIdentity(application)
    private val focus = FocusLocal(application)
    private val quietContext = application.applicationContext
    private val pendingPrefs = application.getSharedPreferences("focuslock-pending", android.content.Context.MODE_PRIVATE)
    private val consentPrefs = application.getSharedPreferences("focuslock-consent-withdrawals", android.content.Context.MODE_PRIVATE)
    private val autoFocusPrefs = application.getSharedPreferences("focuslock-auto-focus", android.content.Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(UiState(focusSessionId = focus.localSession(), focusState = focus.localSession()?.let { focus.state(focus.localStudentId()!!, it) } ?: "ready"))
    val state = mutable.asStateFlow()
    private var job: Job? = null

    private fun run(block: suspend () -> Unit) {
        job?.cancel()
        job = viewModelScope.launch {
            mutable.value = mutable.value.copy(loading = true, error = null)
            try { block() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                if (error is ApiException && error.statusCode == 401 && mutable.value.student != null) {
                    api.clearToken()
                    mutable.value = UiState(error = "Your session expired. Please sign in again.")
                } else {
                    mutable.value = mutable.value.copy(error = if (error is java.io.IOException) "Cannot reach FocusLock. Check your connection and try again." else error.message ?: "Something went wrong. Try again.")
                }
            } finally { mutable.value = mutable.value.copy(loading = false) }
        }
    }

    fun signIn(email: String, password: String) = run {
        val student = api.signIn(email, password)
        reconcileWithdrawals()
        val focusSession = focus.currentSession(student.id)
        mutable.value = UiState(student = student, pendingLocal = pendingPrefs.getStringSet("student-${student.id}", emptySet())!!.mapNotNull { it.toIntOrNull() }.toSet(), focusSessionId = focusSession, focusState = focusSession?.let { focus.state(student.id, it) } ?: "ready", quietRequested = QuietMode.requested(quietContext), loading = true)
    }
    fun loadAuthConfig() = run { mutable.value = mutable.value.copy(authConfig = api.authConfig()) }
    fun beginCollegeSignIn() {
        val config = mutable.value.authConfig ?: return
        try {
            val intent = CollegeAuth(getApplication()).begin(config).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            getApplication<Application>().startActivity(intent)
        } catch (error: Exception) { mutable.value = mutable.value.copy(error = error.message) }
    }
    fun completeCollegeSignIn(uri: Uri) = run {
        val (code, verifier) = CollegeAuth(getApplication()).consume(uri)
        val student = api.collegeExchange(code, verifier)
        reconcileWithdrawals()
        val focusSession = focus.currentSession(student.id)
        mutable.value = UiState(student = student, authConfig = mutable.value.authConfig,
            pendingLocal = pendingPrefs.getStringSet("student-${student.id}", emptySet())!!.mapNotNull { it.toIntOrNull() }.toSet(),
            focusSessionId = focusSession, focusState = focusSession?.let { focus.state(student.id, it) } ?: "ready", quietRequested = QuietMode.requested(quietContext), loading = true)
    }
    private fun acceptedFocus(studentId: Int, sessionId: Int) = autoFocusPrefs.getBoolean("student-$studentId-session-$sessionId", false)
    fun acceptScannedCheckIn(id: Int, qr: String) = checkIn(id, qr)
    fun declineScannedCheckIn(id: Int) {
        val student = mutable.value.student ?: return
        autoFocusPrefs.edit().remove("student-${student.id}-session-$id").apply()
        requestReview(id, "I declined the optional focus disclosure after scanning")
    }
    fun consumeAutoNavigation() { mutable.value = mutable.value.copy(autoNavigateFocusId = null) }
    fun loadToday() = run {
        reconcileWithdrawals()
        val sessions = api.sessions()
        mutable.value = mutable.value.copy(sessions = sessions)
        val student = mutable.value.student ?: return@run
        val current = focus.currentSession(student.id)
        if (current != null && sessions.any { it.id == current && it.state == "ended" }) {
            endLocalSession(current)
        }
        if (focus.currentSession(student.id) != null) return@run
        val active = sessions.filter { it.state == "active" }.sortedBy { it.startsAt }
            .filter { focus.state(student.id, it.id) == "ready" }
        val focusTarget = active.firstOrNull { acceptedFocus(student.id, it.id) }
        if (focusTarget != null) {
            runCatching { startFocusInternal(focusTarget.id, true) }
                .onFailure { mutable.value = mutable.value.copy(error = "Automatic focus could not start: ${it.message}") }
        } else if (active.isNotEmpty() && QuietMode.optedIn(quietContext) && QuietMode.access(quietContext) && QuietMode.session(quietContext) != active.first().id) {
            runCatching { startQuietInternal(active.first().id) }
                .onFailure { mutable.value = mutable.value.copy(error = "Quiet mode could not start: ${it.message}") }
        }
    }
    fun loadHistory() = run { mutable.value = mutable.value.copy(history = api.history(), privacyRequests = api.privacyRequests()) }
    fun submitPrivacyRequest(kind: String, sessionId: Int?, reason: String) = run {
        api.submitPrivacyRequest(kind, sessionId, reason)
        mutable.value = mutable.value.copy(privacyRequests = api.privacyRequests())
    }
    fun loadDetail(id: Int) {
        run {
            val detail = api.session(id)
            val resources = api.resources(id)
            val receiver = runCatching { api.receiverStatus(id) }.getOrDefault("unknown")
            mutable.value = mutable.value.copy(detail = detail, resources = resources,
                receiverState = receiver, focusState = mutable.value.student?.let { focus.state(it.id, id) } ?: "ready")
            val student = mutable.value.student
            val localState = student?.let { focus.state(it.id, id) } ?: "ready"
            if (detail.state == "active" && student != null && acceptedFocus(student.id, id) && localState == "ready" && focus.currentSession(student.id) == null) {
                runCatching { startFocusInternal(id, true) }
                    .onFailure { mutable.value = mutable.value.copy(error = "Automatic focus could not start: ${it.message}") }
            } else if (detail.state == "active" && localState == "ready" && QuietMode.optedIn(quietContext) && QuietMode.access(quietContext) && QuietMode.session(quietContext) != id) {
                runCatching { startQuietInternal(id) }
                    .onFailure { mutable.value = mutable.value.copy(error = "Quiet mode could not start: ${it.message}") }
            } else if (detail.state == "ended" && QuietMode.session(quietContext) == id) {
                QuietMode.stop(quietContext)
            }
            if (detail.state == "ended" && student != null && focus.currentSession(student.id) == id) endLocalSession(id)
            mutable.value = mutable.value.copy(quietRequested = QuietMode.requested(quietContext))
        }
    }
    private suspend fun startQuietInternal(id: Int) {
        val studentId = mutable.value.student?.id ?: error("Sign in required")
        val started = SystemClock.elapsedRealtime()
        val nonce = UUID.randomUUID().toString()
        val policy = api.focusPolicy(id, nonce)
        val (boot, deadline) = focus.verifiedDeadline(studentId, id, policy, nonce, started)
        QuietMode.begin(quietContext, studentId, id, boot, deadline)
        mutable.value = mutable.value.copy(quietRequested = true)
    }
    fun enableQuiet(id: Int) = run {
        require(QuietMode.supported()) { "Automatic Do Not Disturb needs Android 10 or newer" }
        require(QuietMode.access(quietContext)) { "Allow Do Not Disturb access in Android Settings" }
        QuietMode.setOptedIn(quietContext, true)
        if (mutable.value.detail?.id == id && mutable.value.detail?.state == "active") startQuietInternal(id)
    }
    fun enableQuietForFutureSessions() = run {
        require(QuietMode.supported() && QuietMode.access(quietContext)) { "Allow Do Not Disturb access in Android Settings" }
        QuietMode.setOptedIn(quietContext, true)
        val student = mutable.value.student ?: return@run
        val active = mutable.value.sessions.firstOrNull { it.state == "active" && focus.state(student.id, it.id) !in setOf("paused", "ended") }
        if (active != null && QuietMode.session(quietContext) != active.id) startQuietInternal(active.id)
    }
    fun refreshSessionStatus(id: Int) {
        if (mutable.value.student == null) return
        viewModelScope.launch {
            runCatching { api.session(id) }.onSuccess { session ->
                if (mutable.value.detail?.id == id) mutable.value = mutable.value.copy(detail = session)
                if (session.state == "ended") endLocalSession(id)
            }
        }
    }
    fun recordBackgroundInterruption(id: Int) {
        val student = mutable.value.student ?: return
        if (focus.state(student.id, id) != "active") return
        val policy = focus.token()
        if (policy.isBlank()) return
        viewModelScope.launch {
            runCatching { api.focusEvent(id, UUID.randomUUID().toString(), policy, "backgrounded") }
        }
    }
    fun stopQuiet() {
        QuietMode.setOptedIn(quietContext, false)
        mutable.value = mutable.value.copy(quietRequested = false)
    }
    fun refreshQuietStatus() {
        QuietMode.reconcile(quietContext)
        val requested = QuietMode.requested(quietContext)
        if (requested != mutable.value.quietRequested) mutable.value = mutable.value.copy(quietRequested = requested)
    }
    fun prepareScan() { mutable.value = mutable.value.copy(checkInResult = null, error = null) }
    private fun savePending(id: Int, include: Boolean) {
        val studentId = mutable.value.student?.id ?: return
        val changed = mutable.value.pendingLocal.toMutableSet().apply { if (include) add(id) else remove(id) }
        pendingPrefs.edit().putStringSet("student-$studentId", changed.map(Int::toString).toSet()).apply()
        mutable.value = mutable.value.copy(pendingLocal = changed)
    }
    fun checkIn(id: Int, qr: String) = run {
        val studentId = mutable.value.student?.id ?: error("Sign in required")
        mutable.value = mutable.value.copy(checkInResult = null)
        try {
            val deviceId = identity.ensureRegistered(api, studentId)
            val challenge = api.checkInChallenge(deviceId, qr)
            val signature = identity.signCheckIn(studentId, deviceId, challenge, qr)
            val result = api.checkIn(deviceId, qr, challenge.id, signature, null)
            autoFocusPrefs.edit().putBoolean("student-$studentId-session-$id", true).apply()
            savePending(id, false)
            val detail = api.session(id)
            mutable.value = mutable.value.copy(checkInResult = if (result.duplicate) "Attendance was already recorded: ${result.status}." else "Check-in recorded: ${result.status}.", detail = detail)
            if (detail.state == "active" && acceptedFocus(studentId, id) && focus.state(studentId, id) == "ready")
                runCatching { startFocusInternal(id, true) }
                    .onFailure { mutable.value = mutable.value.copy(error = "Attendance recorded. Focus could not start: ${it.message}") }
        } catch (offline: java.io.IOException) {
            savePending(id, true)
            throw offline
        }
    }
    fun requestReview(id: Int, reason: String) = run {
        try {
            api.requestReview(id, reason.trim())
            savePending(id, false)
            mutable.value = mutable.value.copy(checkInResult = "Request sent. Attendance is pending teacher review.", detail = api.session(id))
        } catch (offline: java.io.IOException) {
            savePending(id, true)
            throw offline
        }
    }
    private suspend fun startFocusInternal(id: Int, automatic: Boolean) {
        val studentId = mutable.value.student?.id ?: error("Sign in required")
        val requestStart = SystemClock.elapsedRealtime()
        val nonce = UUID.randomUUID().toString()
        val policy = api.focusPolicy(id, nonce)
        focus.start(studentId, id, policy, nonce, requestStart)
        mutable.value = mutable.value.copy(focusState = "active", focusSessionId = id,
            autoNavigateFocusId = if (automatic) id else null)
        emitFocus(id, "started")
        if (QuietMode.optedIn(quietContext) && QuietMode.access(quietContext)) {
            runCatching {
                val (boot, deadline) = focus.verifiedDeadline(studentId, id, policy, nonce, requestStart)
                QuietMode.begin(quietContext, studentId, id, boot, deadline)
                mutable.value = mutable.value.copy(quietRequested = true)
            }.onFailure { mutable.value = mutable.value.copy(error = "Focus started, but DND did not: ${it.message}") }
        }
    }
    fun startFocus(id: Int) = run { startFocusInternal(id, false) }
    private fun emitFocus(id: Int, action: String) {
        val policy = focus.token()
        if (policy.isNotBlank()) viewModelScope.launch {
            runCatching { api.focusEvent(id, UUID.randomUUID().toString(), policy, action) }
        }
    }
    fun pauseFocus(id: Int) {
        QuietMode.stop(quietContext)
        mutable.value = mutable.value.copy(quietRequested = false)
        stopPresence()
        stopVpnConsent()
        val studentId = mutable.value.student?.id ?: focus.localStudentId() ?: return
        focus.pause(studentId, id)
        mutable.value = mutable.value.copy(focusState = focus.state(studentId, id))
        emitFocus(id, "paused")
    }
    fun resumeFocus(id: Int) {
        val studentId = mutable.value.student?.id ?: focus.localStudentId() ?: return
        focus.resume(studentId, id)
        mutable.value = mutable.value.copy(focusState = focus.state(studentId, id))
        if (mutable.value.focusState == "active" && QuietMode.optedIn(quietContext) && QuietMode.access(quietContext)) {
            focus.deadline(studentId, id)?.let { (boot, deadline) ->
                runCatching { QuietMode.begin(quietContext, studentId, id, boot, deadline) }
                    .onSuccess { mutable.value = mutable.value.copy(quietRequested = true) }
            }
        }
        emitFocus(id, "resumed")
    }
    private fun endLocalSession(id: Int) {
        val studentId = mutable.value.student?.id ?: focus.localStudentId() ?: return
        QuietMode.stop(quietContext)
        focus.exit(studentId, id)
        stopPresence()
        stopVpnConsent()
        mutable.value = mutable.value.copy(focusState = "ended", focusSessionId = null, quietRequested = false)
    }
    fun exitFocus(id: Int) {
        endLocalSession(id)
        emitFocus(id, "exited")
    }
    fun tickFocus(id: Int) {
        val studentId = mutable.value.student?.id ?: focus.localStudentId() ?: return
        val current = focus.state(studentId, id)
        if (current != mutable.value.focusState) {
            mutable.value = mutable.value.copy(focusState = current)
            if (current == "ended") emitFocus(id, "expired")
            if (current == "ended") { QuietMode.stop(quietContext); stopPresence(); stopVpnConsent() }
            if (current == "ended") mutable.value = mutable.value.copy(focusSessionId = null)
        }
    }
    fun startPresence(id: Int) = run {
        if (!BuildConfig.ENABLE_BLE_PRESENCE) error("Bluetooth presence is disabled in this build")
        api.grantConsent("bluetooth")
        consentPrefs.edit().remove("bluetooth").apply()
        val requestStart = SystemClock.elapsedRealtime()
        val credential = api.bleCredential(id)
        BleFeature.start(getApplication(), credential, requestStart, id)
        mutable.value = mutable.value.copy(presenceState = BleFeature.status)
    }
    fun enableVpnConsent(onGranted: () -> Unit) = run {
        api.grantConsent("vpn")
        consentPrefs.edit().remove("vpn").apply()
        onGranted()
    }
    private suspend fun reconcileWithdrawals() {
        for (feature in listOf("vpn", "bluetooth")) if (consentPrefs.getBoolean(feature, false)) {
            runCatching { api.withdrawConsent(feature) }.onSuccess { consentPrefs.edit().remove(feature).apply() }
        }
    }
    fun stopVpnConsent() {
        consentPrefs.edit().putBoolean("vpn", true).apply()
        viewModelScope.launch { reconcileWithdrawals() }
    }
    fun stopPresence() {
        BleFeature.stop()
        mutable.value = mutable.value.copy(presenceState = "off")
        consentPrefs.edit().putBoolean("bluetooth", true).apply()
        viewModelScope.launch { reconcileWithdrawals() }
    }
    fun signOut() {
        QuietMode.stop(quietContext)
        stopPresence()
        stopVpnConsent()
        job?.cancel()
        job = viewModelScope.launch {
            reconcileWithdrawals()
            try { api.signOut() } catch (_: Exception) { api.clearToken() }
            val localSession = focus.localSession()
            mutable.value = UiState(focusSessionId = localSession,
                focusState = localSession?.let { focus.state(focus.localStudentId()!!, it) } ?: "ready")
        }
    }
}
