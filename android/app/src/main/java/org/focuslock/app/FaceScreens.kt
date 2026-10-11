package org.focuslock.app

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

private const val MAX_FAILURES = 3

/** Fixed-size, clipped camera window. Nothing is drawn over it except an optional face outline, and it never overlaps the text below. */
@Composable
fun CameraFrame(modifier: Modifier = Modifier, aspect: Float = 3f / 4f, guide: Boolean = true, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().aspectRatio(aspect).clip(RoundedCornerShape(24.dp)).background(Color.Black)) {
        content()
        if (guide) Canvas(Modifier.fillMaxSize()) {
            val w = size.width * 0.6f
            val h = size.height * 0.6f
            drawOval(Color.White.copy(alpha = 0.8f), topLeft = Offset((size.width - w) / 2f, (size.height - h) / 2f), size = Size(w, h), style = Stroke(width = 3.dp.toPx()))
        }
    }
}

/** Shown right after the first QR scan when staff recorded this student's face. The camera image never leaves the phone. */
@Composable
fun FaceVerifyScreen(template: FloatArray?, onMatched: () -> Unit, onGiveUp: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    var attempt by remember { mutableStateOf(0) }
    var failures by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf("Look at the camera") }
    var notice by remember { mutableStateOf<String?>(null) }
    BackHandler { onCancel() }
    LaunchedEffect(template) { if (template == null) onGiveUp("The face check is unavailable, so I need the teacher to review my attendance") }
    fun failed(message: String) {
        failures += 1
        if (failures >= MAX_FAILURES) onGiveUp("The face check did not succeed after three tries, so I need teacher review")
        else { notice = "$message Try again ($failures of $MAX_FAILURES)."; attempt += 1 }
    }
    Column(Modifier.fillMaxSize().padding(vertical = 8.dp).glass().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Confirm it is you", style = MaterialTheme.typography.headlineMedium)
        Text("Your phone compares your face with the record your college made. The camera picture stays on this phone: it is not saved or sent. The match is evidence for your teacher, not proof.")
        if (template != null) {
            if (!granted) Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Allow camera for the face check") }
            else key(attempt) {
                CameraFrame {
                    FaceCapture(requireBlink = true, frames = 3,
                        onEmbedding = { live -> if (FaceMath.matches(live, template)) onMatched() else failed("That did not match.") },
                        onStatus = { status = it }, onError = { failed(it) },
                        modifier = Modifier.fillMaxSize())
                }
                Text(status, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleMedium)
            }
        }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        OutlinedButton(onClick = { onGiveUp("I chose teacher review instead of the face check") }) { Text("Ask my teacher to review instead") }
        TextButton(onClick = onCancel) { Text("Cancel") }
    }
}

/** Staff-only: record a student's face template in person, with the student's consent. */
@Composable
fun FaceEnrollScreen(roster: List<FaceRosterEntry>, loading: Boolean, message: String?, error: String?,
                     onRefresh: () -> Unit, onEnroll: (Int, FloatArray) -> Unit, onDelete: (Int) -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    var selected by remember { mutableStateOf<FaceRosterEntry?>(null) }
    var consent by remember { mutableStateOf(false) }
    var capturing by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var captureError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { onRefresh() }
    LazyColumn(Modifier.padding(vertical = 8.dp).glass(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Record student faces", style = MaterialTheme.typography.headlineMedium) }
        item { Text("Do this in person. The student looks at this phone and blinks once. Only a 128-number template is stored, encrypted on the server. Record a face only with the student's agreement.") }
        if (loading) item { CircularProgressIndicator() }
        message?.let { item { Text(it, color = MaterialTheme.colorScheme.primary) } }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        selected?.let { student ->
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Recording: ${student.name}", style = MaterialTheme.typography.titleMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = consent, onCheckedChange = { consent = it })
                        Text("${student.name} agrees to this face record for attendance checks.")
                    }
                    if (!granted) Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
                    else if (!capturing) Button(onClick = { captureError = null; capturing = true }, enabled = consent) { Text("Start camera") }
                    else {
                        key(student.id) {
                            CameraFrame {
                                FaceCapture(requireBlink = true, frames = 5,
                                    onEmbedding = { template -> capturing = false; selected = null; consent = false; onEnroll(student.id, template) },
                                    onStatus = { status = it }, onError = { captureError = it; capturing = false },
                                    modifier = Modifier.fillMaxSize())
                            }
                        }
                        Text(status, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleMedium)
                    }
                    captureError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    TextButton(onClick = { selected = null; consent = false; capturing = false }) { Text("Cancel") }
                }
            }
        }
        item { TextButton(onClick = onRefresh, enabled = !loading) { Text("Refresh list") } }
        items(roster, key = { it.id }) { student ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(student.name, style = MaterialTheme.typography.titleMedium)
                Text("${student.email} · ${if (student.enrolled) "Face recorded" else "No face recorded"}", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { selected = student; consent = false; capturing = false; captureError = null }, enabled = !loading) {
                        Text(if (student.enrolled) "Re-record" else "Record face")
                    }
                    if (student.enrolled) OutlinedButton(onClick = { onDelete(student.id) }, enabled = !loading) { Text("Delete record") }
                }
            }
        }
        if (!loading && roster.isEmpty()) item { Text("No students to show.") }
    }
}

/** Covers the app after the student left it during focus, until the teacher approves. */
@Composable
fun ResumeLockScreen(state: String, onRequest: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(20.dp).glass().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
        Text("You left FocusLock", style = MaterialTheme.typography.headlineMedium)
        Text("Your teacher must approve before you can continue. Attendance is not changed by this.")
        when (state) {
            "pending" -> { CircularProgressIndicator(); Text("Waiting for your teacher to approve…") }
            "denied" -> {
                Text("Your teacher did not approve yet. You can ask again.", color = MaterialTheme.colorScheme.error)
                Button(onClick = onRequest) { Text("Ask again") }
            }
            else -> {
                Text("Sending your request to the teacher…")
                OutlinedButton(onClick = onRequest) { Text("Send request now") }
            }
        }
        Text("If the session ends or the signed focus time runs out, this lock clears on its own.", style = MaterialTheme.typography.bodySmall)
    }
}
