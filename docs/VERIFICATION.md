# Stage 1 verification — 10 October 2026

## Executed successfully

- **25 backend tests** passed on Python 3.12. Tests cover missing credentials, student record isolation, teacher course isolation, forbidden student writes/roster reads, out-of-course enrollment writes, field/role forgery, invalid credentials, token tampering/expiry/revocation, database-derived roles, production/staging/disabled demo rejection, non-demo account rejection, future-session confirmation, seed idempotency, health behavior, and Alembic upgrade/check/downgrade/re-upgrade.
- A separately migrated and seeded local SQLite database passed the API smoke test: readiness, teacher and student sign-in, access restrictions, attendance confirmation, and student readback.
- `pip check` reported no broken requirements. Python transitive dependencies are captured as constraints in `requirements.lock`.
- Dashboard `npm run build` passed TypeScript checking and the Vite production build on Node 24.19.0. The checked-in Dockerfile/CI use Node 22 (22.12+ required).
- Dashboard dependency installation/audit after updating Vite reported **zero known vulnerabilities** at the time of the check. This is not a guarantee about future advisories.
- Browser smoke check using the actual local API and Vite proxy: teacher sign-in; assigned course, roster and session display; marking Taylor present; visible saved confirmation; and sign-out returning to the sign-in screen. [Captured dashboard](dashboard.png).
- Official Gradle 8.11.1 wrapper JAR checksum matched `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`. The distribution checksum is pinned in wrapper properties.

The backend tests produce one upstream deprecation warning about Starlette's `httpx` TestClient adapter. It does not affect the passing assertions; future test dependency maintenance should migrate that adapter when appropriate.

## Not executed here

- Docker Compose startup, nginx container routing, and PostgreSQL execution: Docker is not installed/available in this environment. SQLite success does not validate PostgreSQL-specific locking, container builds, or network behavior. CI includes a PostgreSQL migration/seed/smoke job, but that job has not run here.
- Android Gradle build, lint, emulator and physical-device checks: Java/JDK, Android SDK and an emulator are not installed/available here. Kotlin/Compose source and Gradle configuration are provided; no APK is claimed to have been built or tested. CI includes assembleDebug and lintDebug.
- Production authentication and any optional focus features: intentionally outside Stage 1. Protected production endpoints fail closed.

## User setup

Install/start Docker Desktop and run the root README's Compose commands. Install Android Studio with JDK 17 and SDK 35, open `android/`, and run the debug app on an API 26+ emulator. No external identity credentials, Bluetooth or VPN permission are needed. Use the sample accounts and local `.env` password. Run the documented PostgreSQL smoke and Android checks before treating those targets as verified.
