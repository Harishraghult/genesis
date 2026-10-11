package org.focuslock.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class FaceMathTest {
    private fun apply(t: DoubleArray, points: DoubleArray) = DoubleArray(points.size) { i ->
        val x = points[i - i % 2]; val y = points[i - i % 2 + 1]
        if (i % 2 == 0) t[0] * x - t[1] * y + t[2] else t[1] * x + t[0] * y + t[3]
    }

    @Test fun templateMapsOntoItselfAsIdentity() {
        val t = FaceMath.similarity(FaceMath.TEMPLATE, FaceMath.TEMPLATE)
        assertArrayEquals(doubleArrayOf(1.0, 0.0, 0.0, 0.0), t, 1e-9)
    }

    @Test fun recoversScaleRotationAndShift() {
        val angle = Math.toRadians(12.0); val scale = 2.4
        val a = scale * cos(angle); val b = scale * sin(angle)
        val moved = apply(doubleArrayOf(a, b, 130.0, -40.0), FaceMath.TEMPLATE)
        val recovered = FaceMath.similarity(moved, FaceMath.TEMPLATE)
        assertArrayEquals(FaceMath.TEMPLATE, apply(recovered, moved), 1e-6)
    }

    @Test fun landmarksAreOrderedByImagePosition() {
        val ordered = FaceMath.orderLandmarks(doubleArrayOf(90.0, 50.0), doubleArrayOf(40.0, 51.0), doubleArrayOf(65.0, 80.0),
            doubleArrayOf(85.0, 110.0), doubleArrayOf(48.0, 111.0))
        assertArrayEquals(doubleArrayOf(40.0, 51.0, 90.0, 50.0, 65.0, 80.0, 48.0, 111.0, 85.0, 110.0), ordered, 0.0)
    }

    @Test fun normalizeCosineAndAverage() {
        val a = FaceMath.normalize(floatArrayOf(3f, 4f))
        assertEquals(1.0, FaceMath.cosine(a, a), 1e-6)
        assertEquals(0.0, FaceMath.cosine(floatArrayOf(1f, 0f), floatArrayOf(0f, 1f)), 1e-9)
        val mean = FaceMath.average(listOf(floatArrayOf(1f, 0f), floatArrayOf(0f, 1f)))
        assertEquals(0.7071, mean[0].toDouble(), 1e-3)
        assertEquals(1.0, FaceMath.cosine(mean, mean), 1e-6)
    }

    @Test fun thresholdSeparatesSimilarFromDifferent() {
        val enrolled = FaceMath.normalize(FloatArray(128) { (it % 7 - 3).toFloat() })
        val noisy = FaceMath.normalize(FloatArray(128) { (it % 7 - 3).toFloat() + if (it % 5 == 0) 0.4f else 0f })
        val other = FaceMath.normalize(FloatArray(128) { ((it * 13) % 11 - 5).toFloat() })
        assertTrue(FaceMath.matches(noisy, enrolled))
        assertFalse(FaceMath.matches(other, enrolled))
    }

    @Test(expected = IllegalArgumentException::class) fun degenerateLandmarksAreRejected() {
        FaceMath.similarity(DoubleArray(10) { 5.0 }, FaceMath.TEMPLATE)
    }
}
