# Student web app (`/student`)

Students who cannot or do not want to install the Android app can use the same deployment in a phone browser at `https://<your-site>/student`. It uses the same API, signed check-in and rules as the Android app.

- **Device key:** on first check-in the browser generates a non-extractable ECDSA P-256 key with WebCrypto, keeps it in IndexedDB, and registers its public key through the signed device challenge (`FL2|register|…`). Check-ins sign the canonical `FL2|checkin|…` payload from [QR protocol](QR_PROTOCOL.md). Signatures are converted from WebCrypto's raw form to DER, which the server verifies. If the server no longer knows the device (for example after a demo reset), the browser registers a new key once.
- **Check-in:** the student reads the focus disclosure, then scans the teacher's rotating QR with the phone camera (or takes a photo of it). Declining, or "Can't scan? Ask teacher", sends a pending teacher-review request instead. The teacher confirms from the roster.
- **Voluntary focus:** starts automatically once the teacher has pressed Start session and the student has checked in with the QR. It offers Pause/Resume. Quitting needs the teacher's consent: **Ask teacher to quit** sends a request, focus continues until the teacher approves or denies, and a student who already quit and asks again sets off an alarm on the dashboard. After approval, **Join again** rescans the current QR. Leaving the page or locking the screen with focus on sends a neutral `backgrounded` note; nothing is locked. Focus never changes attendance.
- **Do Not Disturb:** a browser cannot switch on DND or silence calls. The web app shows the steps for the phone and a reminder; the Android app can silence calls automatically with the student's permission.
- **History:** the student's own records, plus correction and deletion requests for teacher review.

Limits: a browser cannot prevent switching apps, and its key lives in that browser profile (clearing site data means registering again). The browser needs HTTPS (or `localhost`) for WebCrypto and the camera. The site's `Permissions-Policy` allows the camera only for its own origin (`camera=(self)`).
