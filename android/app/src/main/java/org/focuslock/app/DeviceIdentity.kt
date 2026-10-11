package org.focuslock.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Private key never leaves Android Keystore. Device IDs and aliases contain no hardware identifier. */
class DeviceIdentity(private val context: Context) {
    private val prefs = context.getSharedPreferences("focuslock-devices", Context.MODE_PRIVATE)
    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private fun aliasKey(studentId: Int) = "alias-$studentId"
    private fun idKey(studentId: Int) = "device-$studentId"

    suspend fun ensureRegistered(api: Api, studentId: Int): String = withContext(Dispatchers.IO) {
        val storedId = prefs.getString(idKey(studentId), null)
        if (storedId != null && api.devices().contains(storedId)) return@withContext storedId
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val oldAlias = prefs.getString(aliasKey(studentId), null)
        if (oldAlias != null && keystore.containsAlias(oldAlias)) keystore.deleteEntry(oldAlias)
        val alias = "focuslock-$studentId-${UUID.randomUUID()}"
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256).build())
        val pair = generator.generateKeyPair()
        prefs.edit().putString(aliasKey(studentId), alias).remove(idKey(studentId)).apply()
        val challenge = api.registrationChallenge()
        val message = "FL2|register|$studentId|${challenge.id}|${challenge.nonce}"
        val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(pair.private); update(message.toByteArray(Charsets.UTF_8)) }
        // A linked Play/Cloud project is required before the Android client can obtain a real Integrity token.
        val deviceId = api.registerDevice(challenge, encode(pair.public.encoded), encode(signature.sign()), null)
        prefs.edit().putString(idKey(studentId), deviceId).apply()
        deviceId
    }

    suspend fun signCheckIn(studentId: Int, deviceId: String, challenge: ServerChallenge, qr: String): String = withContext(Dispatchers.IO) {
        val alias = prefs.getString(aliasKey(studentId), null) ?: error("Device registration is missing")
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val privateKey = keystore.getKey(alias, null) as? java.security.PrivateKey ?: error("Device key is unavailable; register again")
        val qrDigest = java.security.MessageDigest.getInstance("SHA-256").digest(qr.toByteArray(Charsets.US_ASCII)).joinToString("") { "%02x".format(it) }
        val message = "FL2|checkin|$studentId|$deviceId|${challenge.id}|${challenge.nonce}|$qrDigest|focus-disclosure-v1|accepted"
        val signer = Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey); update(message.toByteArray(Charsets.UTF_8)) }
        encode(signer.sign())
    }
}
