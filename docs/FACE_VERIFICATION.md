# Face verification, leaving-the-app approval and dashboard notifications

## How the face check works

1. **Staff record a face in person.** A teacher or administrator signs in to the Android app with their own account, which opens **Record student faces**. The student looks at the phone and blinks once. Staff must tick that the student agrees. The phone turns the live camera frames into a 128-number template; no photo is uploaded or stored.
2. **The server stores only the template**, encrypted with AES-256-GCM (`FACE_TEMPLATE_KEY`) and bound to the student ID. Recording and deleting a template writes an `admin_audit` entry. Teachers can only record students in their own courses; administrators can record anyone.
3. **After the student's first QR scan** (and the focus disclosure) the phone downloads that student's own template, asks for a blink, and compares the live face with it **on the phone**. A match lets the check-in continue. The live camera image is never saved or sent.
4. **If it fails three times, the camera is unavailable, or the student prefers it,** the app sends a teacher review request instead. Nobody is marked absent automatically.
5. The signed check-in includes a `face-match-v1` claim. The server refuses a QR check-in from a student with a recorded face unless the claim is present, and the device signature covers the claim.

`FACE_CHECK_MODE`: `off` (default), `enrolled` (only students with a recorded face), or `required` (students without a record go to teacher review).

## Focus starts only after QR and face

The server issues a focus policy only when the student has a QR check-in for that session (`method = qr`, present) and, if staff recorded their face, that check-in carried the face-match claim. Teacher-confirmed attendance does not unlock focus. The app has no manual Start focus button: focus starts by itself after a successful check-in once the class is active. Automatic quiet mode (Do Not Disturb) uses the same policy, so it also waits for the check-in. Ending focus early still needs the teacher's QR or approval.

## What it does and does not prove

- The match is made by the student's phone and reported to the server. A modified or rooted app could lie. Play Integrity (`PLAY_INTEGRITY_MODE=optional` or `required`) raises the bar but is not enabled by default.
- The blink check stops a still photo held up to the camera. It does not stop a video replay or a mask. Treat the result as **evidence for the teacher, not proof of identity**.
- The match threshold (`FaceMath.MATCH_THRESHOLD`, cosine 0.42) is a starting value. Measure false rejects and false accepts with your own students, lighting and phones before relying on it. Face matching is less accurate for some groups of people; the teacher-review fallback exists for that reason.
- Offline phones cannot download the template or send the check-in, so they cannot complete a face-checked QR check-in. Teacher confirmation still works.

## Model and licence

The model is SFace (`face_recognition_sface_2021dec.onnx`) from the [OpenCV Model Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface), released under Apache 2.0. The build checks its SHA-256 (see `android/app/src/main/assets/face/README.txt`). Apache 2.0 covers the files; **review the terms of the data the weights were trained on with your institution before production use.** The runtime is ONNX Runtime (MIT) and detection uses Google ML Kit.

## Privacy and legal checklist (before any real students)

A face template is biometric personal data. Before enrolling real students: get the college's written approval and a lawful basis (explicit consent where required, for example under India's DPDP Act or GDPR); state the purpose, who can see it and the retention period; offer an equal alternative (the teacher-review path already works without a face); decide how a student can ask for deletion (staff can delete a record in the app; add it to the privacy-request process); keep `FACE_TEMPLATE_KEY` secret and identical across API replicas; and do a security review. This repository does not make that decision for you.

## Leaving the app needs teacher approval

While focus is active or paused, if the student leaves FocusLock with the screen on (not for the Phone button or a permission screen), the app covers itself with **You left FocusLock** and asks the teacher for approval. The lock survives an app restart. The dashboard shows an **Approve / Deny** request; approval removes the lock. It clears on its own when the teacher ends the session or the signed focus time expires. Attendance is never changed by this. An incoming phone call also counts as leaving the app.

## Dashboard notifications

The dashboard's session page shows a **Notifications** card above the tabs with: focus exit and resume requests (with Approve and Deny), attendance review requests, student privacy requests, and recent "left the app" events. A pop-up and optional sound announce new requests while the dashboard is open. These are not background push notifications.
