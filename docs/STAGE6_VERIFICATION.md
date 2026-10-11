# Current verification — 11 October 2026

- Backend: 51 tests passed with Python 3.12, including authorization, signed QR expiry/replay, receiver simulations, consent withdrawal, production OIDC JWT signature/claims and database role mapping, Play Integrity request binding/replay with a simulated Google response, admin authorization, device replacement, privacy requests, retention and Alembic round-trip through `0005`.
- Dashboard: TypeScript and Vite production build passed.
- Android: `:app:compileDebugKotlin` passed with optional VPN and BLE enabled, and `:app:compileReleaseKotlin` passed with both features excluded. Full APK/lint/unit-test tasks should be rerun in Android Studio or CI; Windows SDK/Gradle sandbox restrictions have blocked some full tasks in this workspace in earlier stages.
- Vercel `/api` mount returned HTTP 200 for a local FastAPI health request. The user signed in to a Vercel Hobby account, and its project and Storage screens were inspected. The account offers marketplace PostgreSQL providers, but none was connected; the user confirmed that neither a managed database nor college OIDC details are ready. No live deployment was created. Docker Compose startup, live OIDC exchange, Google Play Integrity decoding, actual BLE receiver/phone advertising, and physical VPN/carrier behavior were not available to validate here.
- The Python suite emits one upstream Starlette TestClient deprecation warning. Python/npm vulnerability audits are configured in CI but not yet run against live advisories here.

Physical-device validation is specified in [Stage 4 checklist](STAGE4_VPN.md); BLE hardware validation remains required per [Stage 5 protocol](STAGE5_BLE.md). No real emergency calls should be placed for testing.
