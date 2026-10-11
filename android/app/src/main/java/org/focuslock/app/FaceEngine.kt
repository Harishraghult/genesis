package org.focuslock.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer

/**
 * On-device face embedding with the OpenCV Zoo SFace model. Photos and live frames never leave the phone;
 * only a 128-number template recorded by staff is stored on the server.
 */
class FaceEngine private constructor(context: Context) {
    private val environment = OrtEnvironment.getEnvironment()
    private val session: OrtSession = environment.createSession(
        context.applicationContext.assets.open(MODEL_ASSET).use { it.readBytes() }, OrtSession.SessionOptions())
    private val inputName = session.inputNames.first()

    /** [landmarks] are eye, eye, nose, mouth, mouth in [source] pixel coordinates (see [FaceMath.orderLandmarks]). */
    fun align(source: Bitmap, landmarks: DoubleArray): Bitmap {
        val t = FaceMath.similarity(landmarks, FaceMath.TEMPLATE)
        val matrix = Matrix().apply {
            setValues(floatArrayOf(t[0].toFloat(), (-t[1]).toFloat(), t[2].toFloat(), t[1].toFloat(), t[0].toFloat(), t[3].toFloat(), 0f, 0f, 1f))
        }
        val output = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        Canvas(output).drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG))
        return output
    }

    /** Returns an L2-normalised 128-number embedding of an already aligned 112x112 face. */
    fun embed(aligned: Bitmap): FloatArray {
        require(aligned.width == SIZE && aligned.height == SIZE)
        val pixels = IntArray(SIZE * SIZE)
        aligned.getPixels(pixels, 0, SIZE, 0, 0, SIZE, SIZE)
        // NCHW, RGB, raw 0-255 values: the model subtracts the mean and scales internally.
        val data = FloatArray(3 * SIZE * SIZE)
        for (i in pixels.indices) {
            val p = pixels[i]
            data[i] = ((p shr 16) and 0xFF).toFloat()
            data[SIZE * SIZE + i] = ((p shr 8) and 0xFF).toFloat()
            data[2 * SIZE * SIZE + i] = (p and 0xFF).toFloat()
        }
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(data), longArrayOf(1, 3, SIZE.toLong(), SIZE.toLong())).use { input ->
            session.run(mapOf(inputName to input)).use { result ->
                @Suppress("UNCHECKED_CAST")
                val row = (result[0].value as Array<FloatArray>)[0]
                return FaceMath.normalize(row)
            }
        }
    }

    companion object {
        const val SIZE = 112
        const val MODEL_ASSET = "face/sface_2021dec.onnx"
        const val MODEL_ID = "sface-2021dec"
        @Volatile private var instance: FaceEngine? = null
        fun get(context: Context): FaceEngine = instance ?: synchronized(this) {
            instance ?: FaceEngine(context).also { instance = it }
        }
    }
}
