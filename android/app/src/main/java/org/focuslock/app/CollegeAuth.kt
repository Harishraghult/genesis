package org.focuslock.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

/** Public-client authorization code with PKCE. A system browser handles college credentials. */
class CollegeAuth(context: Context) {
    private val prefs = context.getSharedPreferences("focuslock-oidc-pending", Context.MODE_PRIVATE)
    private fun random(size: Int): String {
        val bytes = ByteArray(size)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
    fun begin(config: AuthConfig): Intent {
        val endpoint = config.authorizationEndpoint ?: error("College authorization endpoint is unavailable")
        val client = config.androidClientId ?: error("College Android client is unavailable")
        val redirect = config.androidRedirectUri ?: error("College Android redirect is unavailable")
        val verifier = random(48)
        val state = random(32)
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()),
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        prefs.edit().putString("verifier", verifier).putString("state", state)
            .putLong("started", SystemClock.elapsedRealtime()).apply()
        val uri = Uri.parse(endpoint).buildUpon()
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("client_id", client)
            .appendQueryParameter("redirect_uri", redirect)
            .appendQueryParameter("scope", "openid profile email")
            .appendQueryParameter("state", state)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .build()
        return Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
    }
    fun consume(uri: Uri): Pair<String, String> {
        val state = prefs.getString("state", null)
        val verifier = prefs.getString("verifier", null)
        val started = prefs.getLong("started", 0)
        prefs.edit().clear().apply()
        if (uri.scheme != "focuslock" || uri.host != "oidc" || uri.path != "/callback" ||
            state == null || verifier == null || uri.getQueryParameter("state") != state ||
            started <= 0 || SystemClock.elapsedRealtime() - started !in 0..300_000) {
            error("College sign-in state did not match or expired")
        }
        val code = uri.getQueryParameter("code") ?: error("College sign-in was cancelled")
        return code to verifier
    }
}
