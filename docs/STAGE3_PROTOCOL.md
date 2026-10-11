# Stage 3 resource and focus protocol

## Course resources

An assigned teacher attaches metadata to one session: `title`, `url`, `kind` (`pdf` or `text`) and `downloadable`. The backend accepts only HTTPS URLs whose exact lowercase hostname appears in `RESOURCE_ALLOWED_HOSTS`; it rejects credentials, fragments, nonstandard ports, control characters and backslashes. Students can list resources only for enrolled sessions. Teachers can list, add or remove them only for assigned sessions. There is no backend fetch, redirect follower or proxy endpoint.

Android uses its independent `RESOURCE_ALLOWED_HOSTS` build value. Its native fetcher disables automatic redirects and checks the original URL and each of at most three redirect targets with the same HTTPS/host/port rules. The final response must be HTTP 200 with `application/pdf` or `text/plain` matching metadata. It reads at most 10 MiB, including when `Content-Length` is absent. It does not send API credentials to course hosts. The native viewer uses `PdfRenderer` or UTF-8 text, with no WebView, arbitrary external browsing, JavaScript or bridge. Viewing a resource writes a temporary file in app-private cache and deletes it on exit. Only tapping **Save private offline copy** writes a persistent app-private file; **Delete offline copy** removes it. An offline copy cannot be remotely revoked while the device is disconnected; institutions must consider this before marking a resource downloadable. The placeholder example hosts do not provide actual content.

## Session states and attendance

The server transitions `ready → checkin_pending → active ↔ paused → ended`. A teacher can also end directly from check-in pending. End is terminal. QR check-in is accepted only during `checkin_pending` or `active` while the scheduled time remains valid. A student may request a focus policy only during `active`. Teacher attendance confirmation and correction use their separate Stage 2 endpoints; local Pause, Exit, timeout or declining focus never change attendance. A valid QR still does not prove physical presence.

## Signed voluntary policy

Android creates a fresh random UUID nonce and records `SystemClock.elapsedRealtime()` immediately before asking `GET /sessions/{id}/focus-policy?nonce=<uuid>`. The backend requires authenticated enrollment and active state. The signed payload is a compact UTF-8 JSON object with keys sorted lexicographically and no spaces:

```json
{"cid":1,"exp":1791700000,"iat":1791697300,"max":2700,"nonce":"00000000-0000-4000-8000-000000000000","sid":1,"uid":3,"v":3}
```

The numbers above illustrate field order only. `iat` and `exp` are integer Unix seconds from the server; `exp` is no later than the scheduled session end or 45 minutes after issue, and `max` is 2700 seconds. `cid`, `sid` and `uid` bind course, session and student. The response is `FP3.<base64url(payload without padding)>.<base64url(DER ECDSA-P256-SHA256 signature without padding)>` plus the DER SubjectPublicKeyInfo public key as base64url. The signature covers the ASCII bytes of the encoded payload segment. The private signing key is derived server-side from `POLICY_SIGNING_KEY` and never shipped to the app. Android verifies the signature, nonce, student/session IDs and duration; API transport must be trusted (HTTPS outside the local demo).

Android sets the local deadline to `requestStartElapsedRealtime + min(exp-iat, max) * 1000`. Starting the timer before the request means network delay cannot extend the window. It saves the deadline, boot count, student/session IDs and policy in app-private preferences. Activity recreation reuses the same deadline. A changed or unavailable boot count ends the interval after restart. A wall-clock change has no effect. Pausing does not stop or extend the interval. The policy is time bounded but cannot be remotely revoked while the phone is offline; a teacher pause/end is shown on the session detail after a successful refresh, and the local interval still expires at its signed deadline. This is a voluntary aid, not device lockdown.

The backend stores only authenticated, explicit `started`, `paused`, `resumed`, `exited` or `expired` focus events with student/session and server receipt time. Event UUIDs make identical retries idempotent. Android applies Pause/Exit locally before attempting event delivery; an outage may leave the server without that event. It does not queue app usage, enumerate other apps or send a heartbeat. An interruption or missing event is **unknown status**, never evidence of misconduct. Focus events are displayed separately from attendance on the teacher dashboard.
