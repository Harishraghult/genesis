# Security controls: status and evidence

These controls reduce risk. They do not make FocusLock hack-proof, and a QR check-in does not prove physical presence.

| Control | Where | How it is verified | Limits |
|---|---|---|---|
| HTTPS production API | Release build defaults to an `https://` API; hosted demo is HTTPS with HSTS (`backend/render_app.py`, `vercel.json`) | Live checks against the Render deployment | Debug builds allow plain HTTP only to `10.0.2.2`, `127.0.0.1` and `localhost` (`android/app/src/debug/res/xml/network_security_config.xml`) |
| Signed rotating QR challenges | `backend/app/qr_security.py` (`FL2.` tokens signed with `QR_SIGNING_KEY`); a new code every 20 s | `tests/test_stage2.py`, `scripts/e2e.py` (tampered QR rejected) | A photo of the screen forwarded within its lifetime can still be used (collusion) |
| Short-lived QR expiry | Each code expires 30 s after its 20 s slot starts (at most ~50 s) and never after the session ends | Stage 2 expiry tests | Clock skew of more than a few seconds causes rejections |
| Replay protection and duplicates | Single-use check-in challenges; identical resubmission returns `duplicate: true` | Stage 2 tests, `scripts/e2e.py` | |
| Device key registration | Android Keystore P-256 key (`DeviceIdentity.kt`); web uses a non-extractable WebCrypto key in IndexedDB (`dashboard/src/device.ts`) | Stage 2 tests, browser E2E (signed web check-in) | A browser key is weaker than Keystore; clearing site data registers a new key |
| Signed device check-in | Canonical `FL2|checkin|…` payload signed by the device key ([QR protocol](QR_PROTOCOL.md)) | Stage 2 tests, E2E | |
| Server-side role and course authorization | Every route checks role and assigned/enrolled course (`stage2.assigned_session`, `enrolled_session`) | `tests/test_authorization.py`, `scripts/e2e.py` | |
| Teacher audit records | `attendance_events` with actor, previous/new status and reason; corrections need ≥10 characters | Stage 2 tests, E2E | Audit rows live in the same database as the data |
| Pending status for offline submissions | Android keeps unsent check-ins/review requests pending until reconciled | Android code path; device testing needed | The web app needs a connection |
| Signed session policies | `FP3.` ECDSA-signed focus policies with expiry and a 45-minute maximum (`stage3.py`) | `tests/test_stage3.py` | |
| Teacher consent to quit focus | Server accepts an `exited` focus event only after a teacher-approved quit request (`stage3.quit_approved`) | `test_quitting_focus_needs_the_teachers_consent`, browser E2E | Leaving the app is reported, not prevented |
| Monotonic Android session expiry | `FocusDeadline.kt` uses elapsed realtime and boot count | `FocusDeadlineTest.kt` | |
| Restricted course-resource hosts and redirects | Server allowlist `RESOURCE_ALLOWED_HOSTS`; Android follows no redirects outside it; web links only `https://` | Stage 3 tests, E2E (non-allowlisted host rejected) | Web links open in the phone's browser |
| App-private offline caching | Android caches only resources marked downloadable, in app-private storage | Android code path | |
| Encrypted face embeddings | AES-GCM with a random nonce, bound to the student id (`face.py`); no photos stored | `tests/test_face.py` | Off by default in the code; the Render demo enables `enrolled`. The match runs on the phone and the server receives a yes/no claim, so it is evidence, not proof |
| Face templates never leave the server | `GET /face/templates/me` returns only status; matching happens in `POST /face/verify`, which issues a signed 2-minute face pass that check-in requires | `tests/test_face.py`, browser face E2E | The live template is computed on the device, so a modified client could still fake a match |
| Android `FLAG_SECURE` | `MainActivity.onCreate` | Release compile | Blocks screenshots and recents previews of the app |
| Dashboard browser protections | CSP, `X-Frame-Options: DENY`, `Permissions-Policy` (camera only for this site), `Referrer-Policy`, `nosniff` | Live response headers | |
| Optional VPN and Bluetooth evidence | Build flags, off by default; release builds hard-disable both | `compileReleaseKotlin` | Needs physical-device validation |
| Consent withdrawal and retention | `privacy/consents`, `privacy/requests`, `python -m app.retention` / `/internal/retention` | Stage 6 tests | The mock-data demo resets on restart; a database deployment must schedule retention |
| Do Not Disturb during class | Android `AutomaticZenRule` with a policy that silences calls and messages (repeat callers still ring); only with the student's permission | Release compile | Needs physical-device testing; websites cannot do this |

Not claimed: legal compliance, app-store approval, complete lockdown, or proof that a student was physically present.
