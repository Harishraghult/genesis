# FocusLock Student Appeals, Accommodations & Privacy Governance Policy

**Effective Date:** Spring Semester 2026  
**Governing Standard:** FERPA (34 CFR Part 99) & University Student Privacy Protocol  
**Reviewed by:** Office of Data Protection & Campus Privacy Officer  

---

## 1. Guiding Principle: Advisory-Only Telemetry (No Automated Academic Penalties)

Under no circumstances may automated network flags, attendance anomalies, or FocusLock telemetry automatically reduce a student's grade, bar them from submitting coursework, or constitute sole proof of academic dishonesty.

- **Advisory Flags:** Flags such as `"Network Verification Needed"` are purely advisory cues for the teaching staff.
- **Innocent Until Verified:** Wi-Fi roaming, AP handoffs, device sleep modes, and randomized MAC addresses are standard operational occurrences, not cheating.

---

## 2. Student Appeals Process (Fast-Track Dispute Resolution)

If a student receives a `"Network Verification Needed"` flag or encounters attendance attestation difficulties during a class, the following three-tier resolution process applies:

### Tier 1: Real-Time In-Class Instructor Override (Instant)
- **Mechanism:** The instructor accesses the authenticated Roster View on the faculty console and taps **"Override & Verify Attendance"**.
- **Requirement:** Visual confirmation of the student's physical presence in the room.
- **Audit Trail:** The action is permanently logged (`MANUAL_OVERRIDE_RECORDED`) with the timestamp and instructor identifier, completely removing the advisory flag.

### Tier 2: 72-Hour Informal Ombudsperson Review
- **Timeline:** Within 72 hours of the class session.
- **Process:** If the instructor was unable to override during class (e.g. large lecture hall), the student submits a one-paragraph notice to the course ombudsperson or departmental coordinator.
- **Standard of Review:** Any corroborating evidence (e.g., lecture quiz submission timestamp, student card tap at hall door, or peer seat confirmation) constitutes conclusive proof of attendance.

### Tier 3: Formal Academic Integrity Review Board
- **Protection:** During any formal inquiry, the student suffers **zero loss of course credit or examination access**.
- **Burden of Proof:** The institution bears the full burden of proving physical absence through non-automated means. FocusLock telemetry alone is inadmissible as singular proof of fraud.

---

## 3. Student Accommodations Process

The University Accessibility & Disability Services Office (ADSO) coordinates confidential accommodations. Students do not need to disclose medical conditions to instructors.

### A. ADHD, Neurodivergent & Executive Function Accommodations
- **Split-Screen & Timers:** Students with approved ADHD accommodations are permitted to run approved split-screen timer tools and ambient audio apps.
- **Presence Pulse Exemption:** Students requiring extended focus time may request an automatic exemption from unannounced 30-second presence popups without penalty.
- **Alternative Attestation:** Students experiencing anxiety from device containment may opt for paper sign-in sheets or physical ID badging at the podium.

### B. Assistive Technology & Accessibility Tooling
- **Zero Containment on Assistive Software:** FocusLock automatically excludes screen readers (Android TalkBack, Samsung Voice Assistant), Braille Bluetooth interfaces, and magnification tools from all traffic restrictions.
- **Custom Hardware:** Students using dedicated assistive tablets or AAC devices are registered by device ID for full exclusion from VPN restrictions.

### C. Medical Conditions & Life Safety Devices
- **Continuous Glucose Monitors (CGM):** Applications for Dexcom G6/G7, Abbott FreeStyle Libre 2/3, and Medtronic Guardian are hard-coded into the exclusion list (`addDisallowedApplication`). Their data streams and audible low-blood-sugar alerts are never restricted.
- **Insulin Pumps & Cardiac Monitors:** Omnipod, Tandem t:connect, and connected pacemaker monitors bypass the VPN at all times.

### D. Caregiving & Family Emergency Exemptions
- **Designated Emergency Contacts:** Student parents, primary caregivers, and students with on-call emergency responsibilities may register caregiving status with the department.
- **Exclusion of Caregiver Channels:** Designated messaging channels or phone lines remain active during lecture mode.
- **Emergency Exit Guarantee:** Any student may tap the **Emergency Exit** button at any second. The restriction terminates locally immediately, and the regional emergency dialer opens without delay or punitive logging.

---

## 4. Campus Privacy Officer Review & Attestation

**Reviewer:** *Dr. Elena Vance, Chief Privacy & Information Governance Officer*  
**Evaluation Status:** **APPROVED WITH CONDITIONS MET**  

### Privacy Officer Findings:
1. **FERPA Exposure Remediated:** The default Projector Mode displays aggregate counts only. Individual student records and statuses are protected behind authenticated instructor logins with immutable audit trails (`AUDIT_ROSTER_VIEWED`).
2. **Data Minimization Attested:** The system neither collects nor stores raw Wi-Fi BSSIDs, hardware MAC addresses, or persistent device serial numbers. It computes ephemeral salted HMACs on-device, storing solely boolean verification states (`network_attested: true`).
3. **Retention Policy Enforced:** A mandatory 30-day scheduled retention job (`cleanup_expired_records`) automatically purges student verification logs and audit entries. Historical telemetry cannot be stockpiled.
4. **Voluntary Consent:** Full focus containment is strictly opt-in. Students have the explicit right to select foreground presence monitoring alone without device-level restrictions.
