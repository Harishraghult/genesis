# Student web app (`/student`)

Students who cannot or do not want to install the Android app can use the same deployment in a phone browser at `https://<your-site>/student`. It uses the same API, signed check-in and rules as the Android app.

- **Device key:** on first check-in the browser generates a non-extractable ECDSA P-256 key with WebCrypto, keeps it in IndexedDB, and registers its public key through the signed device challenge (`FL2|register|…`). Check-ins sign the canonical `FL2|checkin|…` payload from [QR protocol](QR_PROTOCOL.md). Signatures are converted from WebCrypto's raw form to DER, which the server verifies. If the server no longer knows the device (for example after a demo reset), the browser registers a new key once.
- **Check-in:** the student reads the focus disclosure, then scans the teacher's rotating QR with the phone camera (or takes a photo of it). Declining, or "Can't scan? Ask teacher", sends a pending teacher-review request instead. The teacher confirms from the roster.
- **Voluntary focus:** starts automatically when the class is active, after a QR check-in. Pause and Resume work locally. Leaving the page with focus on sends a neutral `backgrounded` review flag, and the student asks the teacher to continue. Ending focus early needs the teacher's current QR or the teacher's approval. Focus never changes attendance.
- **History:** the student's own records, plus correction and deletion requests for teacher review.

Limits: a browser cannot prevent switching apps, and its key lives in that browser profile (clearing site data means registering again). The browser needs HTTPS (or `localhost`) for WebCrypto and the camera. The site's `Permissions-Policy` allows the camera only for its own origin (`camera=(self)`).
