# FocusLock Security & Operational Limitations

FocusLock is engineered as a **temporary, consent-based, session-scoped restriction client**, not an unbreakable digital prison.

When deploying FocusLock in academic or testing environments, stakeholders must understand the fundamental boundaries between user-space enforcement on personal (BYOD) devices and managed institution infrastructure.

---

## 1. What FocusLock Enforces vs. What it Cannot Guarantee

| Threat / Scenario | Handled by FocusLock? | How it is Handled or Why it is Limited |
|---|:---:|---|
| Distracting apps accessing internet on Wi-Fi | **Yes** | Local blackhole VPN drops all IPv4/IPv6 traffic for disallowed applications. |
| Distracting apps accessing internet on Mobile Data (Old Limitation #4) | **Reduced / Controlled** | The VPN tunnel registers default routes `0.0.0.0/0` and `::/0` regardless of whether cellular or Wi-Fi is active. Background apps attempting cellular egress are caught and discarded. |
| Student turning off the VPN | **Detected, Not Prevented** | The Android OS permits users to disconnect VPNs in *Settings → Network & Internet → VPN*. When this happens, FocusLock intercepts `onRevoke()` and immediately logs `vpn_revoked` to the instructor report. |
| Internet-based calling (WhatsApp / Meet / Telegram) | **Blocked by Design** | VoIP calls run over IP data, so they are blackholed along with other app traffic while the VPN is active. |
| Cellular Emergency Calls (112) & Regular Phone Calls | **Always Permitted** | Cellular voice (GSM / CDMA / VoLTE carrier signaling) operates at baseband level and bypasses the tun interface. Tapping "Emergency 112" stops the VPN immediately and launches the phone dialer. |
| Second Device (Cheating / Secondary Phone) | **Out of Scope** | A student carrying a second smartphone, smartwatch, or companion laptop cannot be prevented by an app on their primary device. Physical invigilation is required. |
| Rooted / Custom ROM Android Devices | **Not Guaranteed** | A student with a rooted phone can kill background services, manipulate routing tables via iptables, or modify system binaries. |
| Full Screen Pinning Bypass | **Monitored via Telemetry** | Screen pinning (`startLockTask()`) without Device Owner privileges allows users to unpin by holding Back + Overview. FocusLock detects this and logs `unpinned`. |

---

## 2. The Mobile Data Challenge (Limitation #4 Analysis & Mitigation)

In earlier iterations without VPN support, students on classroom Wi-Fi could simply toggle cellular mobile data on to browse social media and messaging platforms outside the scope of the local network.

### How FocusLock Solves the Mobile Data Gap:
1. **Virtual Interface Precedence**:
   - `FocusVpnService` binds to the system as a global virtual interface with routes covering the entire address space (`0.0.0.0/0` and `::/0`).
   - Android's routing table directs all non-excluded app traffic into the virtual tunnel regardless of physical network switching (Wi-Fi ↔ LTE/5G).
2. **Wi-Fi Affinity for Lecture Traffic**:
   - In environments where the classroom Wi-Fi has no public internet access, Android frequently falls back to cellular data as the default internet connection.
   - FocusLock employs `ClassroomNetwork` (`ConnectivityManager.bindProcessToNetwork`) to anchor its own HTTP and WebView requests directly to the classroom Wi-Fi, preventing 403 subnet errors while keeping other apps under the blackhole VPN.

### Remaining Edge Case:
- If a student completely revokes the VPN via system settings while mobile data is active, other apps regain access. This revocation is transmitted to the instructor via the subsequent heartbeat as `vpn=0` and logged in the attendance report.

---

## 3. Institution-Managed Enforcement (The Enterprise Path)

To achieve **complete, unbreakable lockdown** where students cannot exit the app or disable the VPN:
- The device must be provisioned as a **Company-Owned / Institutional Device (Device Owner mode)** via Android Enterprise (MDM / EMM).
- In Device Owner mode:
  1. `startLockTask()` runs in **whitelisted Lock Task Mode**, removing the navigation bar and preventing unpinning entirely.
  2. The VPN service can be designated as **Always-On VPN with lockdown** (`DISALLOW_CONFIG_VPN`), stripping the ability for the student to disable or revoke the tunnel in system settings.
  3. Status bar expansion, power menu options, and USB debugging can be locked via Device Policy Manager (`DevicePolicyManager.setStatusBarDisabled`, etc.).

FocusLock chooses a **consent-based, privacy-first model for student-owned devices (BYOD)**, prioritizing transparency, clear consent, and guaranteed emergency exit paths over intrusive root-level controls.

---

## 4. Privacy Guarantee

FocusLock's VPN is purely a **traffic sink**, not a packet inspection engine:
- Packets directed into the `tun` interface are discarded into memory and garbage-collected.
- FocusLock does **not**:
  - Inspect TCP/UDP payload headers.
  - Intercept, log, or query DNS requests.
  - Send external traffic data to the instructor or third parties.
  - Read device files, SMS, contacts, or location.
- Attendance metrics transmitted to the instructor are strictly confined to:
  - Check-in timestamp and total verified presence time (seconds).
  - Periodic heartbeat telemetry (heartbeat timestamps, VPN on/off boolean).
  - Explicit user actions (`vpn_started`, `vpn_stopped`, `vpn_revoked`, `vpn_declined`, `unpinned`, `pause`, `resume`, `leave`).
