# Current verification — 11 October 2026

## Executed here (Windows, Python 3.14.6, Node 24.18.0)

- Backend: **67 tests passed**, including authorization and role boundaries, signed QR expiry/replay/duplicates, wrong course, ended sessions, receiver simulations, consent withdrawal, OIDC JWT verification, Play Integrity request binding/replay with a simulated Google response, device replacement, privacy requests, retention, Alembic round-trip, face-template encryption, and a guard that biometric checks default to `off`.
- PostgreSQL 17.10 (local embedded server, not Docker): fresh `alembic upgrade head`, `alembic check`, seed twice (idempotent), and `python -m scripts.smoke` passed. The API was also run under uvicorn against PostgreSQL. Over HTTP, session creation returned 201 for a valid time and 422 with a message for a past start, and the full ready → check-in → active → paused → active → ended lifecycle and the ended-session resource rejection behaved as specified.
- SQLite file database: migrate, seed and smoke passed (the Docker-free path in [Windows setup](WINDOWS_SETUP.md)).
- Dashboard: TypeScript check and Vite production build passed.
- Secret scan: gitleaks 8.24.3 found no leaks in the tracked files (development placeholders in `.env*.example`, tests and CI are allowlisted in `.gitleaks.toml`).
- SQLAlchemy is pinned at 2.0.54 and psycopg at 3.3.6, so the backend installs on Python 3.12 (Docker/CI) and 3.14.

The "Request failed (500)" seen when creating a session came from older demo databases. Their seeded fixed IDs collided with the PostgreSQL ID sequence, and the seed now advances that sequence. The dashboard now explains 5xx and unreachable-API errors instead of showing a bare status code.

## Not executed here

- **Android**: no JDK or Android SDK on this machine, so `assembleDebug`, lint, unit tests and the `FLAG_SECURE` change were not compiled here. CI runs them; rerun locally with the commands in [Windows setup](WINDOWS_SETUP.md).
- **Docker Compose**: Docker is not installed here. The new dashboard health check and nginx security headers are untested in containers.
- **External integrations**: live college OIDC exchange, Google Play Integrity decoding, and a managed PostgreSQL/Vercel deployment. No credentials were available, and none is claimed as working.
- **Physical-device behaviour**: QR scanning with CameraX, quiet mode/DND, background reminders, VPN focus (IPv6, network switching, calls, SMS, Wi-Fi calling, RCS/MMS, battery restrictions, existing VPNs) per the [Stage 4 checklist](STAGE4_VPN.md), and BLE advertising/receivers per the [Stage 5 protocol](STAGE5_BLE.md). No real emergency calls should be placed for testing.
- Python/npm vulnerability audits run in CI only.

The Python suite emits one upstream Starlette TestClient deprecation warning.
