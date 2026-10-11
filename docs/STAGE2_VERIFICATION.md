# Stage 2 verification — 11 October 2026

Executed in this workspace:

- 36 Python tests passed. These include Stage 1 authorization, a Stage 1-to-Stage 2 migration that preserves an existing attendance row and adds a legacy audit event, QR rotation and expiry, replay, identical retry idempotence, second-challenge duplicate handling, QR tampering, invalid device signature, wrong course, unauthorized teacher, ended session, correction reason/audit, and pending review reconciliation.
- Alembic upgrade/check/downgrade/re-upgrade passed against SQLite. `pip check` reported no broken installed requirements.
- A separate freshly migrated and seeded SQLite database passed the Stage 2 smoke script: health, role scope, P-256 device registration, QR check-in, exact request retry, teacher correction and session end.
- TypeScript and Vite production build passed. npm audit reported zero known vulnerabilities at check time.
- In the local browser, teacher sign-in, assigned roster, session start and rendered rotating QR were observed against the local API. [Dashboard capture](stage2-dashboard.png).

Not executed here:

- Docker/PostgreSQL container build or PostgreSQL row-lock behavior. Docker is unavailable on this host. CI defines the PostgreSQL migration, seed and smoke run, but it has not been run in this workspace.
- Android Gradle compilation, lint, camera scanning, Keystore and emulator/device behavior. JDK, Android SDK and `adb` are unavailable on this host. Android source was reviewed, but no APK or device test is claimed. CI defines `assembleDebug` and `lintDebug`; run these in Android Studio or CI before relying on the client.

The Python suite emits one upstream Starlette TestClient deprecation warning. It does not change the passing results. Stage 2 remains a local demo with development accounts; production identity and HTTPS deployment are outside this stage.
