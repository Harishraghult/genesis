# Architecture and privacy boundaries

The FastAPI backend remains the source of identity, enrollment, session state and attendance. Dashboard requests use a same-origin `/api` proxy. Android requests go directly to the backend. Demo access tokens are random opaque values stored as hashes and held in client memory; production authentication is intentionally unavailable.

Session state is `ready`, `checkin_pending`, `active`, `paused` or `ended`. An assigned teacher opens check-in during the planned time, activates, pauses, resumes and ends a session. `checkin_pending` and `active` issue QR tokens and accept new QR check-ins; pause and end close new check-ins. The server signs each QR with its configured secret, rotates it every twenty seconds, and rejects it after thirty seconds at most. QR validation uses the server clock and stored course/session state. The display polls for a new QR; a screenshot of an old one has no extension.

Student devices prove possession of a P-256 private key generated in Android Keystore. Registration begins with a short-lived server nonce; the student signs a canonical registration payload and uploads only the public key. Check-in uses a second server nonce bound to the authenticated student, registered device, session and QR digest. The backend verifies the P-256 signature. Challenge consumption is atomic; an identical successful HTTP retry returns the existing result, while a spent challenge with a different signature is rejected. A second valid challenge cannot create a second attendance row because `(session_id, student_id)` is the primary key. Session end and check-in serialize on the session row in PostgreSQL. See [exact payloads and replay details](QR_PROTOCOL.md).

| Record | Purpose |
| --- | --- |
| users / course_offerings / enrollments / sessions | Identity, assigned teacher, membership and class lifecycle |
| attendance | One current status per student/session, with method `qr` or `teacher_confirmed` |
| attendance_events | Append-only application record of QR check-in, teacher confirmation and correction, including old/new status, actor, time and reason |
| devices | Student-owned public keys and revocation time; no phone serial number or hardware ID |
| device_challenges | Single-use registration/check-in nonces, expiry and request digest |
| pending_attendance | Student review request, reason and resolution; never attendance by itself |
| course_resources | Teacher-attached PDF/text links on exact configured college HTTPS hosts |
| focus_events | Minimal explicit focus actions with server receipt time, separate from attendance |

Teachers see only assigned course rosters, sessions, check-ins, pending requests and audit events. Students see only enrolled sessions, their own attendance and pending state. A student cannot write attendance directly. A teacher can confirm an enrolled student's attendance without QR or camera, and must provide a reason when changing an existing status. Database constraints enforce enrollment/session links, attendance method/status and uniqueness; API code enforces role and course ownership. Database row-level security is not implemented.

Android requests camera access only while scanning. The bundled barcode model processes frames on device. No image, frame, location, contacts, SMS, call log or hardware identifier is uploaded. Offline attempts persist only the session ID locally as pending; the student must explicitly send a review request when connected. That review request is not proof of a timely QR scan and cannot auto-create attendance. Teacher review remains the alternative for students without a supported phone or who decline scanning.

Course files are fetched directly by Android only after exact HTTPS host validation. Every redirect is revalidated; content must be PDF or plain text and is capped at 10 MiB. There is no arbitrary browsing, JavaScript bridge or backend URL proxy. An explicit offline-save action stores the file privately. Teacher attachments are metadata only; institution licensing and sharing authorization remain a teacher/institution responsibility.

Voluntary focus uses a server-signed P-256 policy bound to student, course, session and a fresh client nonce. Android verifies the signature and calculates a deadline from `elapsedRealtime()` captured before the request; the deadline and boot count are stored in private preferences. Activity recreation retains the deadline, a reboot or unknown boot count ends it, and changing wall time cannot extend it. Pause and Exit are immediate local actions. Server focus events are best effort and contain no app-switch details or heartbeat. A missing event means status unknown, not misconduct. Attendance is never derived from focus state.

A valid QR check-in is evidence of participation, not proof against forwarding or collusion or guaranteed physical presence. The demo shared password, lack of production identity, absence of device attestation, potential key compromise, host/database access, screenshots of roster data, and operational retention/backup choices leave privacy and security risk. Rate limiting, institution identity, immutable external audit storage, HTTPS deployment, consent and retention policies, account lifecycle and monitoring must be addressed before real student data is used.

Implementation references: [Android Keystore](https://developer.android.com/privacy-and-security/keystore), [CameraX image analysis](https://developer.android.com/media/camera/camerax/analyze), [ML Kit bundled barcode scanning](https://developers.google.com/ml-kit/vision/barcode-scanning/android), [FastAPI security](https://fastapi.tiangolo.com/tutorial/security/), and [Alembic migrations](https://alembic.sqlalchemy.org/en/latest/tutorial.html).
