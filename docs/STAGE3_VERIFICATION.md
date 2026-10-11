# Stage 3 verification — 11 October 2026

Completed in this workspace:

- `python -m pytest -q`: **39 passed**. Coverage includes Stage 1/2 authorization and QR behavior, `0001 → 0003 → base → 0003` migration round-trip with preserved attendance, exact course host validation, unauthorized teacher/student resource access, session lifecycle, signed policy verification/expiry, focus event idempotence, and focus/attendance independence.
- `npm run build`: **passed** with TypeScript checking and Vite production bundle.
- `gradlew.bat :app:compileDebugKotlin`: **passed** using Android Studio's installed Java 21, SDK 35 and Build-Tools 36. One existing CameraX opt-in warning remains.
- The monotonic deadline cases were also compiled and run directly with Android Studio's Kotlin compiler: **passed** for outage/activity recreation, boot count change, wall-clock independence, expiry and invalid duration.
- The Gradle APK and JUnit path did **not** finish here. `validateSigningDebug` could not lock the sandboxed debug keystore file; a subsequent run reached Kotlin compilation but Java compilation failed with Windows `AccessDeniedException` reading SDK/cache jars. The source JUnit tests are configured in CI but were not executed in this workspace. Run `:app:assembleDebug :app:lintDebug :app:testDebugUnitTest` on a normal development machine or CI.
- Docker/PostgreSQL smoke was **not run here** because Docker is not installed. CI is configured to run PostgreSQL migration/seed/smoke and Android assemble, lint and unit tests.

Real-device or emulator checks still needed: scan a teacher QR; open an actual institution-authorized PDF and text resource; follow an allowed-host redirect and reject a redirect to another host or HTTP; save a downloadable file and open it during an outage; verify a view-only temporary file is removed on exit; start focus, disconnect network, and confirm Pause/Exit respond immediately; rotate/recreate the Activity and force-stop/relaunch the app while offline; reboot and verify the saved interval ends; change the wall clock forward/backward and verify no extension; wait for the signed deadline; reconnect and confirm attendance stayed unchanged and missing focus events are treated as unknown. PDF rendering on the target OS should also be checked with institution-approved files.

Limitations: demo authentication is development-only, local HTTP is suitable only for an emulator/reverse port, configured example hosts contain no real course files, and offline copies cannot be revoked until the device reconnects or the student deletes them. This stage makes no claim of complete lockdown, guaranteed physical presence or zero privacy risk.
