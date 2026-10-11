# Stage 4 optional local VPN

The debug build alone can include `FocusVpnService` when `ENABLE_LOCAL_VPN=true`. A separate, plain-language screen precedes Android's VPN consent. The user can decline and continue with focus and attendance. An existing VPN is displaced while this one is active; the disclosure states that conflict. The service excludes FocusLock's own app, installs IPv4/IPv6 default routes to a local TUN interface, and discards opaque bytes read from it. It does not parse, retain, forward, or transmit packet contents, destinations, or browsing history. Android's always-on VPN support is disabled in the debug manifest.

The service has a foreground notification with an accessible **Stop Focus VPN** action. It checks the locally signed focus deadline and boot count itself each second and when draining packets. Pause, Exit, expiry, revocation, a stale process state, or a device restart closes the TUN; Android does not restart it automatically. Local Pause and Exit work without internet. The service does not block offline apps, other profiles, or tethered devices. No screen pinning is enabled; phone calls and SMS access matter. Carrier behavior, Wi-Fi calling, RCS and MMS cannot be promised universally. Attendance never depends on this VPN.

The release build forces `ENABLE_LOCAL_VPN=false` and does not declare the service. Distribution stays disabled until the *actual* VPN purpose, disclosure and implementation pass Google Play review. This repository contains no such approval. See [Google Play VPN policy](https://support.google.com/googleplay/android-developer/answer/12564964) and [Android VpnService](https://developer.android.com/reference/android/net/VpnService).

## Physical-device checklist

Use a test phone and test accounts; do not place real emergency calls.

1. Confirm normal QR attendance and teacher confirmation with VPN declined, then enable VPN and verify the separate disclosure appears before Android's consent dialog.
2. With a controlled test app, check IPv4 and IPv6 traffic over Wi-Fi and mobile data is discarded. Confirm FocusLock's authorized API and college resource host remain reachable. Repeat while switching Wi-Fi ↔ mobile data and after airplane-mode recovery.
3. Activate another VPN first. Verify FocusLock explains the conflict and provides a no-VPN path. Test Android revocation/another VPN taking over and ensure FocusLock releases its interface and notification.
4. Use notification **Stop Focus VPN**, in-app **Stop local VPN now**, **Pause now**, **Exit focus now**, session expiry, app process kill and device restart. Confirm immediate local exit and no stale VPN on recovery, including under battery restrictions.
5. With safe test numbers and carrier support, verify incoming/outgoing ordinary calls, SMS, Wi-Fi calling, RCS and MMS both while active and after stopping. Record carrier/device-specific failures. Do not test emergency calling by placing real emergency calls.
6. Verify no packet content, destinations or traffic history appear in app storage, API records, receiver records or operational logs. Confirm other profiles, offline apps and tethered devices are not represented as blocked.

Emulator/unit builds cannot establish universal carrier or VPN behavior. The checklist requires physical-device validation on each supported Android/carrier combination.
