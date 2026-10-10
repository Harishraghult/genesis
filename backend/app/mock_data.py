MOCK_SLIDES = [
    {
        "slide_number": 1,
        "title": "Unit 4: Zero-Trust Classroom Security Architecture",
        "subtitle": "Defeating Digital Proxies & Preserving Real-Time Student Focus",
        "bullet_points": [
            "Why traditional QR codes fail: WhatsApp screenshot relays & proxy attendance.",
            "Session-Scoped Ephemeral Cryptography: 15-second rolling HMAC-SHA256 tokens.",
            "Local Subnet & BSSID Attestation: Verifying physical in-room presence.",
            "Kiosk Mode & Focus Containment: Detecting tab switches with zero surveillance."
        ],
        "notes": "Attendance fraud rates exceed 35% when static or slow-rotating QR codes are projected."
    },
    {
        "slide_number": 2,
        "title": "Cryptographic Signing Gate (X-FL-*)",
        "subtitle": "Tamper-Proof Course Content Delivery",
        "bullet_points": [
            "Every resource request must provide: X-FL-Session, X-FL-Ts, X-FL-Nonce, X-FL-Sig.",
            "Sig formula: HMAC-SHA256(session_secret, timestamp + nonce + path).",
            "30-second replay window rejection prevents packet sniffing & replay attacks.",
            "Unsigned or standard browser requests receive immediate 403 Forbidden."
        ],
        "code_snippet": "sig = HMAC_SHA256(secret, f'{ts}{nonce}{path}')\nheaders = {'X-FL-Sig': sig, 'X-FL-Ts': ts, 'X-FL-Nonce': nonce}"
    },
    {
        "slide_number": 3,
        "title": "Distraction Containment vs. Invasive Surveillance",
        "subtitle": "Privacy-Preserving In-Browser & OS Containment",
        "bullet_points": [
            "Web Client: Page Visibility API + Screen Wake Lock API detects hidden tabs.",
            "Android Companion: startLockTask() screen pinning + blackhole VpnService.",
            "Zero Data Snooping: Packets are dropped without inspection, logging, or forwarding.",
            "Immediate emergency override: 112 calls always take precedence."
        ],
        "notes": "Students retain ownership: VPN revocation is treated as an event, not a lock violation."
    }
]

MOCK_TIMETABLE = {
    "course_code": "CS-402",
    "course_title": "Advanced Distributed Systems & Cyber-Physical Security",
    "instructor": "Dr. Sarah Jenkins",
    "room": "Hall 302 (North Tower)",
    "target_bssid": "BSSID_ROOM_302",
    "slot": "10:00 AM - 11:30 AM"
}

MOCK_QUIZZES = [
    {
        "quiz_id": "pulse-1",
        "question": "What cryptographic mechanism prevents students from forwarding the projected QR code to peers outside class?",
        "options": [
            "Static base64 token",
            "15-second rolling HMAC-SHA256 TOTP with local BSSID attestation",
            "Simple GPS location query",
            "Manual student roll call"
        ],
        "correct_option": 1,
        "duration_seconds": 30
    }
]

# Official Course Enrolled Roster for CS-402
MOCK_ENROLLED_STUDENTS = [
    {"student_id": "21CS204", "student_name": "Harish Raghul", "seat": "Row 1, #01"},
    {"student_id": "21CS042", "student_name": "Marcus Vance", "seat": "Row 2, #04"},
    {"student_id": "21CS089", "student_name": "Aaliyah Chen", "seat": "Row 1, #08"},
    {"student_id": "21CS115", "student_name": "Devon Miller", "seat": "Row 4, #12"},
    {"student_id": "21CS074", "student_name": "Rohan Iyer", "seat": "Row 3, #06"},
    {"student_id": "21CS150", "student_name": "Priya Sharma", "seat": "Row 2, #10"},
    {"student_id": "21CS099", "student_name": "Alex Rivera", "seat": "Row 5, #02"},
    {"student_id": "21CS033", "student_name": "Zara Patel", "seat": "Row 3, #14"},
]

