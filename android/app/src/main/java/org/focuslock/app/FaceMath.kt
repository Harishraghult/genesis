package org.focuslock.app

import kotlin.math.sqrt

/** Plain-Kotlin face geometry and scoring, kept free of Android types so it can be unit tested. */
object FaceMath {
    /** Standard 112x112 five-point template used by ArcFace-style models: eye, eye, nose, mouth corner, mouth corner (image left to right). */
    val TEMPLATE = doubleArrayOf(38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041)

    /** Cosine score at or above which two faces count as the same person. Tune with real enrolment data. */
    const val MATCH_THRESHOLD = 0.42

    /**
     * Least-squares similarity transform mapping [src] points onto [dst] (both x0,y0,x1,y1...).
     * Returns [a, b, tx, ty] meaning x' = a*x - b*y + tx and y' = b*x + a*y + ty.
     */
    fun similarity(src: DoubleArray, dst: DoubleArray): DoubleArray {
        require(src.size == dst.size && src.size >= 4 && src.size % 2 == 0)
        val n = src.size / 2
        var sx = 0.0; var sy = 0.0; var dx = 0.0; var dy = 0.0
        for (i in 0 until n) { sx += src[2 * i]; sy += src[2 * i + 1]; dx += dst[2 * i]; dy += dst[2 * i + 1] }
        sx /= n; sy /= n; dx /= n; dy /= n
        var re = 0.0; var im = 0.0; var norm = 0.0
        for (i in 0 until n) {
            val ax = src[2 * i] - sx; val ay = src[2 * i + 1] - sy
            val bx = dst[2 * i] - dx; val by = dst[2 * i + 1] - dy
            re += ax * bx + ay * by
            im += ax * by - ay * bx
            norm += ax * ax + ay * ay
        }
        require(norm > 1e-9) { "Landmarks are degenerate" }
        val a = re / norm; val b = im / norm
        return doubleArrayOf(a, b, dx - (a * sx - b * sy), dy - (b * sx + a * sy))
    }

    /** Orders the five landmarks as eye, eye, nose, mouth, mouth with the smaller image x first in each pair. */
    fun orderLandmarks(leftEye: DoubleArray, rightEye: DoubleArray, nose: DoubleArray, mouthA: DoubleArray, mouthB: DoubleArray): DoubleArray {
        val eyes = listOf(leftEye, rightEye).sortedBy { it[0] }
        val mouth = listOf(mouthA, mouthB).sortedBy { it[0] }
        return doubleArrayOf(eyes[0][0], eyes[0][1], eyes[1][0], eyes[1][1], nose[0], nose[1], mouth[0][0], mouth[0][1], mouth[1][0], mouth[1][1])
    }

    fun normalize(values: FloatArray): FloatArray {
        var sum = 0.0
        for (v in values) sum += v.toDouble() * v
        val norm = sqrt(sum).toFloat()
        require(norm > 1e-6f) { "Empty embedding" }
        return FloatArray(values.size) { values[it] / norm }
    }

    fun cosine(a: FloatArray, b: FloatArray): Double {
        require(a.size == b.size)
        var dot = 0.0; var na = 0.0; var nb = 0.0
        for (i in a.indices) { dot += a[i].toDouble() * b[i]; na += a[i].toDouble() * a[i]; nb += b[i].toDouble() * b[i] }
        return dot / (sqrt(na) * sqrt(nb))
    }

    fun average(embeddings: List<FloatArray>): FloatArray {
        require(embeddings.isNotEmpty())
        val sum = FloatArray(embeddings[0].size)
        for (e in embeddings) for (i in sum.indices) sum[i] += e[i]
        return normalize(sum)
    }

    fun matches(live: FloatArray, enrolled: FloatArray): Boolean = cosine(live, enrolled) >= MATCH_THRESHOLD
}
