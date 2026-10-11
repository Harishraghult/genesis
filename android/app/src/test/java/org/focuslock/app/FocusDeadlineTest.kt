package org.focuslock.app

import org.junit.Assert.*
import org.junit.Test

class FocusDeadlineTest {
    @Test fun outageAndActivityRecreationKeepLocalDeadline() {
        val deadline = FocusDeadline.fromPolicy(100_000, 1000, 1600, 900)
        assertEquals(700_000, deadline)
        // A recreated activity reads the same persisted boot and elapsed deadline; no server response is needed.
        assertTrue(FocusDeadline.isLive(8, 8, deadline, 300_000))
        assertFalse(FocusDeadline.isLive(8, 8, deadline, 700_000))
    }

    @Test fun restartFailsClosedEvenIfElapsedClockResets() {
        assertFalse(FocusDeadline.isLive(8, 9, 700_000, 1000))
        assertFalse(FocusDeadline.isLive(-1, -1, 700_000, 1000))
    }

    @Test fun phoneWallClockCannotExtendSession() {
        val deadline = FocusDeadline.fromPolicy(5000, 1000, 1060, 120)
        val wallClockChanges = listOf(-86_400_000L, 86_400_000L)
        wallClockChanges.forEach { _ -> assertFalse(FocusDeadline.isLive(8, 8, deadline, 65_000)) }
    }

    @Test(expected = IllegalArgumentException::class)
    fun invalidPolicyDurationFails() { FocusDeadline.fromPolicy(0, 1000, 2000, 900) }
}
