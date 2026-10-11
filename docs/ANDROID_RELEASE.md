# Android app release (student app)

Only the installed Android app can turn on Do Not Disturb and silence calls during class (with the student's permission). The student web app links to the latest GitHub release: `https://github.com/Harishraghult/genesis/releases/latest`.

## Build the phone APK (Windows PowerShell)

Set `JAVA_HOME` and the Android SDK as in [Windows setup](WINDOWS_SETUP.md), then from `android\`:

```powershell
.\gradlew.bat :app:assembleDebug -PAPI_BASE_URL=https://focuslock-30o1.onrender.com/api -PABI_FILTERS=arm64-v8a
```

`-PABI_FILTERS=arm64-v8a` keeps only the code for 64-bit ARM phones (almost every current Android phone), which roughly halves the APK. Omit it for a universal APK (needed for x86 emulators). The APK is at `appuild\outputspk\debugpp-debug.apk`.

## Publish it

1. On GitHub open **Releases → Draft a new release**, create a tag such as `v0.2.0`, and drag the APK into the assets box (rename it to `FocusLock-student-v0.2.0.apk`).
2. Publish. The "Download for Android" button on `/student` now opens this release.
3. On the phone, download the APK and allow "Install unknown apps" for the browser when Android asks.

This is a debug-signed demo build for testing. A Play Store release needs a release keystore, a policy review of the focus and DND features, and an HTTPS production API.

## Student permissions

After the first QR check-in in an active class, the app asks to silence calls. **Allow** opens Android's Do Not Disturb access screen; turn on FocusLock and return. On Android 13+ the app also asks for notification permission so quiet mode shows a visible Stop action. FocusLock's own DND rule silences calls, messages and conversations while alarms and media still play; repeat callers (the same person twice within 15 minutes) still ring for emergencies. It turns off when the class ends or when the teacher approves quitting.
