package org.focuslock.app

import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val CAPTURE_TIMEOUT_MS = 30_000L
private const val OPEN = 0.7f
private const val CLOSED = 0.3f

/**
 * Front-camera face capture. Finds exactly one frontal face, optionally asks for a blink (a basic check against a
 * still photo, not strong liveness), then averages [frames] embeddings. Frames are processed in memory only.
 */
@Composable
fun FaceCapture(requireBlink: Boolean, frames: Int, onEmbedding: (FloatArray) -> Unit, onStatus: (String) -> Unit,
                onError: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val embeddingCallback by rememberUpdatedState(onEmbedding)
    val statusCallback by rememberUpdatedState(onStatus)
    val errorCallback by rememberUpdatedState(onError)
    val previewView = remember { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE; scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(lifecycleOwner, previewView) {
        val executor = Executors.newSingleThreadExecutor()
        val detector = FaceDetection.getClient(FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .setMinFaceSize(0.3f).build())
        val finished = AtomicBoolean(false)
        val main = ContextCompat.getMainExecutor(context)
        val startedAt = SystemClock.elapsedRealtime()
        var phase = if (requireBlink) 0 else 3 // 0 eyes open, 1 eyes closed, 2 eyes open again, 3 collecting
        val collected = ArrayList<FloatArray>()
        var lastStatus = ""
        fun status(text: String) { if (text != lastStatus) { lastStatus = text; main.execute { statusCallback(text) } } }
        fun fail(message: String) { if (finished.compareAndSet(false, true)) main.execute { errorCallback(message) } }

        fun frame(image: ImageProxy) {
            if (finished.get()) return
            if (SystemClock.elapsedRealtime() - startedAt > CAPTURE_TIMEOUT_MS) { fail("Face check timed out."); return }
            val raw = image.toBitmap()
            val upright = if (image.imageInfo.rotationDegrees == 0) raw else
                Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }, true)
            val faces = Tasks.await(detector.process(InputImage.fromBitmap(upright, 0)))
            if (faces.isEmpty()) { status("Look at the camera"); return }
            if (faces.size > 1) { status("Only one face should be visible"); return }
            val face = faces[0]
            if (Math.abs(face.headEulerAngleY) > 15f || Math.abs(face.headEulerAngleX) > 15f || Math.abs(face.headEulerAngleZ) > 20f) {
                status("Look straight at the camera"); return
            }
            val left = face.leftEyeOpenProbability; val right = face.rightEyeOpenProbability
            if (left == null || right == null) { status("Keep both eyes visible"); return }
            val open = left >= OPEN && right >= OPEN
            val closed = left <= CLOSED && right <= CLOSED
            when (phase) {
                0 -> { status("Look straight at the camera"); if (open) phase = 1 }
                1 -> { status("Blink slowly once"); if (closed) phase = 2 }
                2 -> { status("Open your eyes and hold still"); if (open) phase = 3 }
                else -> {
                    if (!open) return
                    val points = landmarks(face) ?: run { status("Keep your whole face in view"); return }
                    status("Hold still…")
                    val engine = FaceEngine.get(context)
                    collected += engine.embed(engine.align(upright, points))
                    if (collected.size >= frames && finished.compareAndSet(false, true)) {
                        val template = FaceMath.average(collected)
                        main.execute { embeddingCallback(template) }
                    }
                }
            }
        }

        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            if (executor.isShutdown) return@addListener
            runCatching {
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).build()
                analysis.setAnalyzer(executor) { image ->
                    try { frame(image) } catch (error: Exception) { fail("Face check could not run: ${error.message}") } finally { image.close() }
                }
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_FRONT_CAMERA, preview, analysis)
            }.onFailure { fail("Camera could not start.") }
        }, main)
        onDispose {
            finished.set(true)
            if (providerFuture.isDone) runCatching { providerFuture.get().unbindAll() }
            detector.close()
            executor.shutdown()
        }
    }
    AndroidView(factory = { previewView }, modifier = modifier)
}

private fun landmarks(face: Face): DoubleArray? {
    fun point(type: Int) = face.getLandmark(type)?.position?.let { doubleArrayOf(it.x.toDouble(), it.y.toDouble()) }
    return FaceMath.orderLandmarks(
        point(FaceLandmark.LEFT_EYE) ?: return null, point(FaceLandmark.RIGHT_EYE) ?: return null, point(FaceLandmark.NOSE_BASE) ?: return null,
        point(FaceLandmark.MOUTH_LEFT) ?: return null, point(FaceLandmark.MOUTH_RIGHT) ?: return null)
}
