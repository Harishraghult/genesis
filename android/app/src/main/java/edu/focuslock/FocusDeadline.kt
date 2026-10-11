package edu.focuslock

/** Only elapsed time and a matching boot may keep a voluntary session open. */
object FocusDeadline {
    fun fromPolicy(requestStartMs: Long, issuedSeconds: Long, expirySeconds: Long, maximumSeconds: Long): Long {
        require(expirySeconds > issuedSeconds && maximumSeconds in 1..2700)
        require(expirySeconds - issuedSeconds <= maximumSeconds)
        return Math.addExact(requestStartMs, Math.multiplyExact(expirySeconds - issuedSeconds, 1000L))
    }

    fun isLive(savedBoot: Int, currentBoot: Int, deadlineMs: Long, elapsedNowMs: Long): Boolean =
        savedBoot >= 0 && currentBoot == savedBoot && elapsedNowMs < deadlineMs
}
