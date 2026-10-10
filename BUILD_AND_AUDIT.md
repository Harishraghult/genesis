# FocusLock Client Transparency, Reproducible Builds & Independent Audit Guide

## 1. Open Source Client Commitment & Governance

FocusLock BYOD client software is designed to be fully open-source, auditable, and transparent to address student body concerns, student councils, and university privacy boards.

- **Client License:** Apache 2.0 / MIT Dual License.
- **Repository Scope:** All Android native code (`edu.focuslock.*`), Student PWA source code, and cryptographic protocols are published in open repositories.
- **Student Verification:** Any student or security researcher can clone, inspect the zero-logging blackhole drain thread, verify package exclusions, and build the client locally.

---

## 2. Reproducible Build Specification (Android Client)

To guarantee that the distributed APK is identical bit-for-bit to the open-source code and contains zero hidden telemetry or tracking, FocusLock mandates a reproducible build process.

### Deterministic Build Environment
- **Base Image:** `eclipse-temurin:17-jdk-jammy`
- **Android Command Line Tools:** `11076708` (API 34, Build-tools 34.0.0)
- **Gradle Version:** `8.2.0` (pinned via gradle-wrapper SHA-256)
- **Kotlin Compiler:** `1.9.22` with deterministic flags:
  ```properties
  kotlin.incremental=false
  org.gradle.caching=false
  ```

### Build Commands (Deterministic Container)
```bash
# 1. Pull verified container
docker run --rm -v $(pwd):/workspace -w /workspace eclipse-temurin:17-jdk-jammy bash -c "
  apt-get update && apt-get install -y unzip zip && \
  export SOURCE_DATE_EPOCH=1760000000 && \
  ./gradlew clean assembleRelease --no-daemon --offline \
    -Dorg.gradle.project.reproducible=true
"

# 2. Verify Output Hash
sha256sum android/app/build/outputs/apk/release/app-release-unsigned.apk
```

### Reproducibility Safeguards
1. **Source Date Epoch:** Timestamps embedded into zip file headers are normalized to `SOURCE_DATE_EPOCH`.
2. **Deterministic File Ordering:** Gradle zip archive tasks sort file entries alphabetically before packing.
3. **Debug Attribute Stripping:** Synthetic compiler line tables and debug metadata are normalized via `-Xno-source-debug-extension`.

---

## 3. Independent Security & Privacy Audit Scope

FocusLock undergoes annual third-party independent audits. The audit checklist covers four core trust domains:

### Audit Domain 1: Zero-Logging Blackhole Tunnel
- **Code Path:** `FocusVpnService.startDrain()`
- **Audit Verification:** The drain loop reads from the Linux `tun` file descriptor into a fixed `ByteArray(32767)` and takes no further action:
  ```kotlin
  while (draining) {
      if (input.read(buf) < 0) break
      // Intentionally discarded. Zero logging, zero packet parsing, zero forwarding.
  }
  ```
- **Auditor Test:** Attach an eBPF trace to the process. Confirm that no system calls (`socket`, `sendto`, `write`) touch external network descriptors or file systems while the drain thread is running.

### Audit Domain 2: Data Minimization
- **Audit Verification:** Verify that raw BSSIDs, hardware MACs, and device serial numbers are never persisted to databases, application memory stores, or log files.
- **Evidence:** The client matches the room Access Point locally or transmits a per-session salted HMAC. The backend stores only `network_attested: true/false`.

### Audit Domain 3: Baseband Emergency Dialer Guarantee
- **Audit Verification:** Verify that pressing the emergency exit button immediately tears down the VPN interface synchronously prior to dispatching any network telemetry or launching the regional dialer.
- **Evidence:** Cellular voice calls (112, 911, 999) route across baseband firmware and are completely independent of OS network routing.

### Audit Domain 4: Medical & Assistive Technology Exclusions
- **Audit Verification:** Verify that `FocusVpnService` registers package exclusions using `addDisallowedApplication`:
  - Continuous Glucose Monitors: Dexcom G6/G7, FreeStyle Libre 2/3.
  - Insulin Delivery Systems: Medtronic MiniMed, Insulet OmniPod, Tandem t:connect.
  - Accessibility: TalkBack, Samsung Voice Assistant.
- **Auditor Test:** Confirm traffic from excluded applications passes unimpeded to public carrier networks during active classroom restriction.
