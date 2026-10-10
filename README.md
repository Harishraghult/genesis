# FocusLock

A session-scoped, secure classroom companion and attendance verification client designed for college lecture environments.

FocusLock couples an instructor-controlled FastAPI backend with an Android companion app to provide verified attendance, access to restricted lecture materials, and temporary, consent-based focus enforcement.

---

## Architecture Overview

```
focuslock/
  backend/
    main.py             FastAPI application (sessions, TOTP codes, check-in, signed gate)
    conftest.py         Pytest fixtures and test harnesses
    test_gate.py        23 gate security tests (TOTP, HMAC, replay, subnet verification)
    test_vpn.py         VPN reporting, vpn_* events, presence accounting tests
    make_vectors.py     Signer test vector generator
    test_vectors.json   Canonical HMAC-SHA256 test vectors
    test_vectors.py     Pytest verifying Python reproduces test vectors
    sim_client.py       CLI simulation client for testing live endpoints
    demo.py             End-to-end interactive classroom session walkthrough
    requirements.txt    Backend Python dependencies
  android/
    app/src/main/
      java/edu/focuslock/
        MainActivity.kt       Single-Activity UI (Check-in, VPN consent, locked WebView)
        FocusVpnService.kt    Blackhole VpnService (IPv4 + IPv6 default routes, self-excluded)
        Net.kt                OkHttp API client, SigningInterceptor, ClassroomNetwork (Wi-Fi pin)
        Signer.kt             Pure JVM-compatible HMAC-SHA256 and SHA-256 routines
      res/                    Layouts, themes, strings, network security configs
      AndroidManifest.xml     Permissions, BIND_VPN_SERVICE, systemExempted FGS type
    app/src/test/
      java/edu/focuslock/
        SignerTest.kt         JUnit test asserting Signer.kt matches test_vectors.json
    TESTING.md                Manual test plan on real Android devices
  README.md
  LIMITATIONS.md
```

---

## Key Features

1. **Rotating 6-Digit TOTP & Device Attestation**:
   - Instructors project a rotating code refreshed every 15 seconds.
   - Student apps check in using the TOTP code and an enrolled device key (`HMAC-SHA256` device signature).
   - Server enforces that check-ins originate exclusively from the classroom subnet (`FL_CLASSROOM_NETS`).

2. **Per-Session Cryptographic Signing**:
   - Every request to `/portal/*` and `/api/client/*` is signed:
     ```
     Sig = HMAC-SHA256(secret, METHOD + "\n" + path_with_query + "\n" + ts + "\n" + nonce + "\n" + sha256_hex(body))
     ```
   - Headers: `X-FL-Session`, `X-FL-Student`, `X-FL-Ts`, `X-FL-Nonce`, `X-FL-Sig`.
   - The server enforces replay protection, timestamp freshness (within 30 seconds), path/query integrity, body checksums, and client IP subnet rules.

3. **Session-Scoped Local VPN Restriction**:
   - **Temporary & Consent-Based**: Prior to enabling the VPN, a plain-language consent screen informs the student about what is blocked (other apps' internet) and what is not seen.
   - **Blackhole Routing**: Registers `0.0.0.0/0` (IPv4) and `::/0` (IPv6) default routes. Packets from other apps (Instagram, YouTube, WhatsApp) are routed into a local tun interface and immediately discarded.
   - **FocusLock Excluded**: FocusLock is excluded via `addDisallowedApplication(packageName)`, letting it communicate with the class portal and server normally.
   - **No Traffic Inspection**: Packet contents, destinations, and DNS lookups are never inspected, stored, logged, or forwarded anywhere.
   - **Revoke Detection**: If the student turns off the VPN in system settings, `onRevoke()` detects it and reports `vpn_revoked` to the server.

4. **Mobile Data Mitigation**:
   - Both cellular data leakage (apps bypassing Wi-Fi) and captive Wi-Fi fallback issues (where Android routes requests away from Wi-Fi because it has no internet) are handled:
     - All device traffic is caught by the VPN's default routes.
     - FocusLock's own process is bound to the classroom Wi-Fi via `ConnectivityManager.bindProcessToNetwork`, ensuring attendance and portal traffic reach the local server even if mobile data is toggled on.

5. **Lifecycle & Emergency Guarantees**:
   - Session teardown and VPN deactivation occur immediately when:
     - Server returns HTTP 410 (session ended).
     - Student taps **Exit** (`/api/client/leave` called first, then VPN stops).
     - Student taps **Emergency 112** (**VPN stops first locally**, dialer opens immediately).
     - App process is destroyed or crashes (`onDestroy`).
     - Session duration expires (`ends_at` client safety timer).

---

## Privacy Note

FocusLock is built on zero-trust principles without surveillance:
- **No Packet Inspection**: The local VPN drops packets from other applications without reading headers, payloads, DNS queries, or destinations.
- **Minimal Telemetry**: Server logging is strictly confined to:
  - Attendance timestamps (checked in, last seen, leave time).
  - Calculated presence seconds (based on heartbeat interval gaps).
  - Coarse client lifecycle events (`vpn_started`, `vpn_stopped`, `vpn_revoked`, `vpn_declined`, `unpinned`, `pause`, `resume`).
- **No Personal Data Collection**: No browsing history, no list of installed apps, no GPS location, and no persistent device IP addresses are saved.

---

## Quick Start (Backend)

1. **Install Dependencies**:
   ```bash
   cd focuslock/backend
   pip install -r requirements.txt
   ```

2. **Run Tests**:
   ```bash
   python -m pytest -q
   # Runs test_gate.py (23 tests), test_vpn.py (12 tests), test_vectors.py (3 tests)
   # Total: 45 passed
   ```

3. **Generate Signer Test Vectors**:
   ```bash
   python make_vectors.py
   ```

4. **Run the Interactive Demo**:
   ```bash
   python demo.py
   ```

5. **Start the Live Server**:
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

---

## Android Client Setup

1. Open `focuslock/android` in Android Studio (JBR / JDK 17+ recommended).
2. Sync the project with Gradle.
3. Run JUnit tests: `SignerTest` validates compatibility with `backend/test_vectors.json`.
4. Build APK: `./gradlew assembleDebug`.
5. Refer to [`android/TESTING.md`](android/TESTING.md) for the manual test plan on physical hardware.
