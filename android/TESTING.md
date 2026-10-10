# FocusLock Android Testing & Manual Verification Guide

This document details the manual test plan and setup requirements for validating FocusLock and its session-scoped VPN traffic restriction on a real Android device.

---

## 1. Prerequisites & Environment Setup

1. **Android Device**:
   - Running Android 8.0 (API 26) through Android 14+ (API 34).
   - A SIM card with an active cellular mobile data plan.
   - Connected to the classroom Wi-Fi access point where the backend server is running.
2. **Backend Server**:
   - Laptop or server running `focuslock/backend/main.py`.
   - Accessible over the local Wi-Fi subnet (e.g. `http://192.168.1.50:8000`).
   - `FL_CLASSROOM_NETS` configured to include the local subnet.
3. **Android Studio**:
   - Open `focuslock/android` in Android Studio.
   - Allow Gradle sync to complete with JDK 17+.
   - Run unit test `SignerTest` to verify signature generation against `test_vectors.json`.
   - Build and install the debug APK on the device: `./gradlew installDebug`.

---

## 2. Solving the Mobile Data Issue

There are two primary problems concerning mobile data in classroom lockdown setups:

1. **Bypass Problem (Other apps using mobile data)**:
   - When a student has cellular data enabled, apps like Instagram, Telegram, or WhatsApp often send background notifications or stream media over the mobile connection, completely bypassing local Wi-Fi controls.
   - **How FocusLock fixes this**: `FocusVpnService` registers full default catch-all routes: `0.0.0.0/0` (IPv4) and `::/0` (IPv6). The VPN operates at the virtual network interface level, capturing device-wide traffic regardless of whether physical transmission happens over Wi-Fi or LTE/5G. Unapproved app packets enter the `tun` interface and are discarded without processing.

2. **Server Connectivity Problem (Classroom Wi-Fi has no internet uplink)**:
   - Institutional or portable classroom Wi-Fi routers frequently lack an external internet connection. Android's OS network monitor detects "Connected, no internet" and automatically shifts the device default network to Mobile Data.
   - If that happens, FocusLock requests leave over the cellular carrier's IP, triggering an `HTTP 403 (outside classroom network)` error from the backend.
   - **How FocusLock fixes this**: `ClassroomNetwork.kt` uses `ConnectivityManager.requestNetwork(NetworkCapabilities.TRANSPORT_WIFI)` and invokes `bindProcessToNetwork(network)`. This pins all FocusLock traffic (OkHttp client and WebView) exclusively to the Wi-Fi physical link, allowing it to communicate with the local server while mobile data remains active.

---

## 3. Manual Test Matrix

| # | Test Case | Steps to Execute | Expected Result | Pass/Fail |
|---|---|---|---|---|
| **1** | **Open Instagram on Wi-Fi during session** | Check in, accept VPN prompt. Keep Wi-Fi active. Switch out of FocusLock (or split screen) and open Instagram / browser. | Instagram feeds fail to load; browser shows "No internet connection". All packet traffic dropped. | [ ] |
| **2** | **Switch to mobile data during session** | While session is active with VPN on, turn off Wi-Fi so the phone transitions to 4G/5G mobile data. Try loading any web page in Chrome. | Traffic remains blocked; the VPN tunnel persists across transport changes; other apps cannot load data. | [ ] |
| **3** | **Open FocusLock Portal** | With VPN active, tap links in the FocusLock portal (e.g. `/portal/notes`). | Portal pages load cleanly. Requests are signed with HMAC headers and succeed (HTTP 200). | [ ] |
| **4** | **Open unapproved website in client** | Click an external link or attempt to load `https://example.com` inside the client WebView. | Navigation denied. A Toast alert informs the user that the site is not allowed. Event `nav_denied` logged to server. | [ ] |
| **5** | **Instructor ends session** | Instructor triggers `POST /api/session/{sid}/end`. Wait for the next heartbeat (≤10 s). | Server returns HTTP 410. App automatically exits locked mode, tears down VPN, and standard phone internet is immediately restored. | [ ] |
| **6** | **Student turns VPN off in settings** | Go to Android Settings → Network & Internet → VPN → FocusLock and disconnect/disable. Return to FocusLock. | Detected immediately (`onRevoke`). App reports `vpn_revoked` to server. Heartbeat reports `vpn=0`. Status bar displays "Restriction turned off (reported)". | [ ] |
| **7** | **IPv6 & Private DNS enabled** | Ensure Private DNS is set to automatic or custom provider (e.g. `dns.google`) and carrier provides IPv6. Test external apps. | No traffic leaks. IPv6 route `::/0` and virtual DNS endpoints capture DNS lookups and drop them cleanly. | [ ] |
| **8** | **Backend unreachable** | Disconnect backend server or stop the Python process while session is running. | Lock holds; client retries quietly with backoff note ("Class server unreachable. Retrying"). Hard safety timer terminates VPN precisely when `ends_at` is reached. | [ ] |
| **9** | **Tap Emergency 112** | Tap the red "Emergency 112" button in the locked toolbar. | VPN is stopped **first** locally (no blocking network calls); screen unpins; phone dialer opens with 112 pre-dialed. Server receives `emergency_exit` event in background. | [ ] |
| **10** | **Student declines VPN consent** | Check in. When the plain-language consent screen appears, tap "No thanks (portal only)". | App enters portal-only mode without starting `FocusVpnService`. Event `vpn_declined` logged. Class portal is accessible; other apps behave normally. | [ ] |

---

## 4. Verification Checklist for Android Studio

When opening this project in Android Studio on a machine with the Android SDK installed:

1. **Gradle Sync**: Verify Gradle 8.7 loads dependencies without errors (`okhttp:4.12.0`, JUnit 4).
2. **Local Tests**:
   - Run `SignerTest`: verifies that Kotlin HMAC-SHA256 and SHA-256 routines generate byte-identical output to `backend/test_vectors.json`.
3. **Build Target**:
   - Target SDK: 34 (Android 14)
   - Min SDK: 26 (Android 8.0)
4. **Permissions Verification**:
   - Verify `BIND_VPN_SERVICE` is granted to `FocusVpnService`.
   - Verify `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_SYSTEM_EXEMPTED` allow background tunnel maintenance on Android 14.
