# QR and device signature protocol (version 2)

All timestamps in this protocol are Unix seconds in UTC. The server clock determines validity. All base64url values use RFC 4648 URL alphabet without `=` padding. QR payloads and device signatures are ASCII-safe, but signatures cover **UTF-8 bytes** of the exact canonical string shown below. The separator is a literal vertical bar (`|`), with no whitespace or newline.

## Rotating teacher QR

An assigned teacher starts a session using `POST /sessions/{id}/start`. Once active, `GET /sessions/{id}/qr` returns `{qr, expires_at, rotation_seconds}`. The backend creates a compact JSON object with keys sorted lexically and no spaces:

```json
{"cid":1,"exp":1234567920,"iat":1234567900,"sid":1,"start":1234567800,"v":2}
```

`sid` is session ID, `cid` is course ID, `start` is the stored actual session-start timestamp, `iat` is the floor of current Unix time to a 20-second slot, and `exp` is the smaller of `iat+30` and the planned session end. It constructs:

```text
FL2.<base64url(compact-json-utf8)>.<base64url(HMAC-SHA256(QR_SIGNING_KEY, ascii(base64url(compact-json-utf8))))>
```

The signing secret exists only on the backend. The QR is display data, not a student credential. The backend verifies the HMAC with constant-time comparison, rejects `now >= exp`, confirms an active session and matching stored course/start time, and checks student enrollment. An ended session rejects new check-ins even if a recently issued QR has seconds left. QR validity is capped at thirty seconds; refreshing the dashboard does not extend a particular token.

## Device registration

After student sign-in, Android generates a P-256 key pair with `SHA256withECDSA` signing permission in Android Keystore. It does not export the private key or upload a hardware identifier. `POST /devices/challenge` returns a random `challenge_id` (UUID), random `nonce` and `expires_at` (five minutes). Android sends the base64url DER SubjectPublicKeyInfo public key and a base64url DER ECDSA signature over:

```text
FL2|register|<authenticated-student-id>|<challenge-id>|<nonce>
```

to `POST /devices/register`. The backend loads the authenticated student from the bearer token, validates P-256 and the signature, and atomically consumes the challenge before binding the public key to that student. Public key fingerprints are unique. Students can list and revoke only their own devices; a revoked key cannot check in.

## QR check-in

Immediately after scanning, Android shows the focus disclosure. Accepting it submits `POST /check-ins/challenge` with `{device_id, qr, focus_disclosure:"accepted"}`. Declining submits a teacher-review request instead; no QR attendance is granted automatically. The backend rejects missing or declined disclosure values for the QR path. The backend checks the authenticated student, device ownership, HMAC, QR expiry, active session and enrollment before returning a new random ID and nonce. The challenge is bound to that student, device, session and SHA-256 digest of the **exact QR string**; it expires at the earlier of QR expiry or fifteen seconds after issuance. A QR may expire while the student reads the disclosure; the app then asks for a fresh scan.

Android signs the following string with its Android Keystore P-256 key using `SHA256withECDSA` and sends `{device_id, qr, challenge_id, signature, focus_disclosure:"accepted"}` to `POST /check-ins`:

```text
FL2|checkin|<authenticated-student-id>|<device-id>|<challenge-id>|<nonce>|<lowercase-hex-SHA256-of-exact-QR-ASCII>|focus-disclosure-v1|accepted
```

The ECDSA signature is DER encoded then base64url encoded without padding. The server uses the registered public key to verify the accepted-disclosure statement, rechecks QR/session/enrollment/expiry, locks the session row, and atomically marks the server challenge used. A successful first check-in creates `present` with method `qr` and an audit event recording the disclosure version. The attendance primary key is `(session_id, student_id)`. A second valid challenge for the same student/session returns the current attendance as `duplicate: true` without changing it or creating another audit event. A signed statement does not prove that a person read the dialog; it prevents an unmodified request from silently changing the declared decision.

For the same consumed challenge, the server stores `SHA256(UTF8(canonical-string + "|" + signature-base64url))`. An **identical** accepted HTTP retry returns `duplicate: true` and the current attendance; reuse with a different signature or payload returns conflict. This distinguishes safe transport retries from replay. A retry never creates another attendance row, even if the QR has since expired or the teacher ended the session. A new check-in is never accepted after expiry or session end. QR forwarding and student collusion remain possible and are not described as physical-presence verification.

## Offline and alternative path

Android does not queue a signed QR for later automatic acceptance. On network failure it persists only the session ID locally and shows **pending on this device**. The student must explicitly tap **Send teacher review request** after reconnecting; that creates a `pending_attendance` record, not attendance. The teacher sees it in the roster and explicitly records the outcome, including a reason. The same teacher-confirmed path covers a declined focus disclosure, camera failure, unsupported phones and a student's decision not to scan. Declining focus never auto-marks absence. A later device timestamp has no authority to revive an expired QR.

Teacher confirmation calls `PUT /sessions/{id}/attendance/{student_id}`. A change to an existing status requires a reason of at least ten characters and appends an audit event containing actor, old/new status, reason and server time. Existing QR attendance can be corrected but remains visible through the audit trail. The `0002` migration inserts `legacy_import` events for Stage 1 rows because prior changes cannot be reconstructed.
