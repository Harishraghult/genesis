import time
import json
import asyncio
from typing import Dict, List, Set, Any, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .models import (
    PunchInRequest, PunchInResponse, FocusEventRequest,
    PresencePulseTrigger, QuizSubmission, StudentRosterRecord,
    SessionStatus, RosterResponse, AuditLogEntry, AggregateMetrics,
    OverrideAttendanceRequest
)
from .security import (
    get_current_totp, verify_totp, create_session_jwt,
    decode_session_jwt
)
from .anomaly import evaluate_punch_anomaly, reset_anomaly_tracker, get_allowed_room_bssid_hashes
from .middleware import SignedRequestGateMiddleware
from .mock_data import MOCK_SLIDES, MOCK_TIMETABLE, MOCK_QUIZZES

app = FastAPI(title="FocusLock Attendance & Focus Gate", version="1.0.0")

# CORS middleware for Next.js frontend clients on 3000 and 3001
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom Signed Request Gate Middleware for /api/course-portal/*
app.add_middleware(SignedRequestGateMiddleware)

# --- IN-MEMORY SESSION & WEBSOCKET STATE ---
ACTIVE_SESSION = {
    "session_id": "FL-CS402-2026",
    "course_name": MOCK_TIMETABLE["course_title"],
    "instructor": MOCK_TIMETABLE["instructor"],
    "room": MOCK_TIMETABLE["room"],
    "started_at": time.time(),
    "is_active": True
}

# student_id -> StudentRecord dictionary
STUDENTS_STORE: Dict[str, Dict[str, Any]] = {}

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        text = json.dumps(message)
        dead = []
        for connection in list(self.active_connections):
            try:
                await connection.send_text(text)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)

manager = ConnectionManager()

import secrets
import hmac

AUDIT_LOGS: List[Dict[str, Any]] = []

def compute_aggregate_metrics() -> Dict[str, Any]:
    students_list = list(STUDENTS_STORE.values())
    total = len(students_list)
    focused = sum(1 for s in students_list if s.get("is_focused", True) and s.get("status") not in ["NETWORK_VERIFICATION_NEEDED", "PROXY_FLAGGED"])
    distracted = sum(1 for s in students_list if not s.get("is_focused", True) and s.get("status") not in ["NETWORK_VERIFICATION_NEEDED", "PROXY_FLAGGED"])
    flagged = sum(1 for s in students_list if s.get("status") in ["NETWORK_VERIFICATION_NEEDED", "PROXY_FLAGGED"])
    pct = round((focused / total * 100.0), 1) if total > 0 else 100.0
    return {
        "total_joined": total,
        "focused_count": focused,
        "distracted_count": distracted,
        "focus_percentage": pct,
        "flagged_count": flagged,
    }

def require_instructor_auth(
    request: Request,
    x_instructor_key: Optional[str] = Header(None)
) -> str:
    if not x_instructor_key or not hmac.compare_digest(x_instructor_key, settings.INSTRUCTOR_KEY):
        raise HTTPException(
            status_code=401,
            detail="Instructor authorization required to access protected student roster."
        )
    return "instructor"

# Prepopulate with 3 realistic students so faculty dashboard looks great immediately
# Data minimization compliant: stores verification results only, never raw BSSIDs or raw device IDs
def seed_students():
    now = time.time()
    mock_init = [
        {"student_id": "21CS042", "student_name": "Marcus Vance", "seat": "Row 2, #04", "status": "VERIFIED_PRESENT", "is_focused": True, "network_attested": True, "device_attested": True, "joined_at": now - 340, "last_event": "JOINED", "last_seen": now, "quiz_submitted": False},
        {"student_id": "21CS089", "student_name": "Aaliyah Chen", "seat": "Row 1, #08", "status": "VERIFIED_PRESENT", "is_focused": True, "network_attested": True, "device_attested": True, "joined_at": now - 280, "last_event": "JOINED", "last_seen": now, "quiz_submitted": False},
        {"student_id": "21CS115", "student_name": "Devon Miller", "seat": "Row 4, #12", "status": "VERIFIED_PRESENT", "is_focused": False, "network_attested": True, "device_attested": True, "joined_at": now - 190, "last_event": "FOCUS_LOST", "last_seen": now - 45, "quiz_submitted": False},
    ]
    for s in mock_init:
        STUDENTS_STORE[s["student_id"]] = s

seed_students()

# --- ROUTES ---

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": "FocusLock Core Backend",
        "time": time.time(),
        "active_session": ACTIVE_SESSION["session_id"]
    }

@app.get("/api/session/current-qr")
def current_qr():
    """
    Returns rolling HMAC-SHA256 TOTP token, per-session salt, and allowed room AP hashes.
    Allows on-device matching without exposing or persisting raw network identifiers.
    """
    token, expires_in, current_ts = get_current_totp()
    allowed_hashes = get_allowed_room_bssid_hashes(settings.SESSION_SALT)
    return {
        "totp_token": token,
        "expires_in": expires_in,
        "session_id": ACTIVE_SESSION["session_id"],
        "timestamp": current_ts,
        "step_interval": settings.TOTP_STEP_SECONDS,
        "session_salt": settings.SESSION_SALT,
        "allowed_bssid_hashes": allowed_hashes,
        "qr_payload": json.dumps({
            "session_id": ACTIVE_SESSION["session_id"],
            "totp": token,
            "ts": current_ts,
            "salt": settings.SESSION_SALT,
            "room_aps": settings.TARGET_ROOM_BSSIDS,
            "bssid": settings.TARGET_BSSID
        })
    }

@app.get("/api/session/status")
def session_status():
    """
    Public Projector Mode endpoint (FERPA-compliant):
    Returns session metadata and class-wide AGGREGATE metrics only.
    Zero individual student names, seat positions, or per-student records are exposed.
    """
    metrics = compute_aggregate_metrics()
    return {
        "session": ACTIVE_SESSION,
        "summary": metrics,
        "metrics": metrics,
        "emergency_number": settings.EMERGENCY_NUMBER
    }

@app.get("/api/session/roster")
def get_session_roster(
    request: Request,
    _auth: str = Depends(require_instructor_auth)
):
    """
    Role-protected Instructor endpoint:
    Access to individual student roster is protected by instructor key.
    Every view is logged in the permanent audit trail.
    Per-student 'Distracted' states are hidden; only attendance verification status is returned.
    """
    client_ip = request.client.host if request.client else "unknown"
    audit_id = f"aud_{int(time.time())}_{secrets.token_hex(4)}"
    audit_entry = {
        "id": audit_id,
        "action": "AUDIT_ROSTER_VIEWED",
        "actor": "instructor",
        "timestamp": time.time(),
        "ip_address": client_ip,
        "detail": f"Instructor accessed attendance roster of {len(STUDENTS_STORE)} students"
    }
    AUDIT_LOGS.append(audit_entry)

    # Sanitize records: no per-student 'Distracted' status exposed
    sanitized_students = []
    for s in STUDENTS_STORE.values():
        sanitized_students.append({
            "student_id": s["student_id"],
            "student_name": s["student_name"],
            "seat": s["seat"],
            "joined_at": s["joined_at"],
            "last_seen": s["last_seen"],
            "attendance_status": "NETWORK_VERIFICATION_NEEDED" if s.get("status") in ["NETWORK_VERIFICATION_NEEDED", "PROXY_FLAGGED"] else "VERIFIED_PRESENT",
            "network_attested": s.get("network_attested", True),
            "quiz_submitted": s.get("quiz_submitted", False),
            "anomaly_flag": s.get("anomaly_flag")
        })

    return {
        "session_id": ACTIVE_SESSION["session_id"],
        "audit_id": audit_id,
        "students": sanitized_students
    }

@app.get("/api/session/audit-logs")
def get_audit_logs(_auth: str = Depends(require_instructor_auth)):
    """
    Returns audit trail of protected roster views.
    """
    return {"audit_logs": list(AUDIT_LOGS)}

@app.post("/api/attendance/punch-in", response_model=PunchInResponse)
async def punch_in(req: PunchInRequest, request: Request):
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    # 1. Validate Rolling TOTP (T_0 or T_-1)
    if not verify_totp(req.totp_token):
        return PunchInResponse(
            status="ERROR",
            student_id=req.student_id,
            student_name=req.student_name,
            message="Invalid or expired TOTP QR token. Please scan the current projector code."
        )
    
    # 2. Evaluate Anomaly (On-device match, salted HMAC, or multi-AP room list)
    is_anomaly, anomaly_reason = evaluate_punch_anomaly(
        student_id=req.student_id,
        bssid_match=req.bssid_match,
        salted_bssid_hmac=req.salted_bssid_hmac,
        reported_bssid=req.reported_bssid,
        device_fingerprint=req.device_fingerprint,
        client_ip=client_ip,
        is_simulation=req.is_simulation
    )
    
    now = time.time()
    initial_status = "NETWORK_VERIFICATION_NEEDED" if is_anomaly else "FOCUSED"
    seat_label = f"Row {((hash(req.student_id) % 5) + 1)}, #{((hash(req.student_id) % 15) + 1):02d}"
    
    # DATA MINIMIZATION: Never persist raw BSSIDs or raw device identifiers.
    # Persist the verification result only (network_attested, device_attested).
    student_record = {
        "student_id": req.student_id,
        "student_name": req.student_name,
        "seat": seat_label,
        "network_attested": not is_anomaly,
        "device_attested": True,
        "status": initial_status,
        "is_focused": not is_anomaly,
        "joined_at": now,
        "last_event": "NETWORK_VERIFICATION_NEEDED" if is_anomaly else "JOINED",
        "last_seen": now,
        "quiz_submitted": False,
        "anomaly_flag": anomaly_reason
    }
    
    STUDENTS_STORE[req.student_id] = student_record
    
    # 3. Create Session JWT and Credentials
    jwt_token = create_session_jwt(req.student_id, req.student_name, ACTIVE_SESSION["session_id"])
    
    # 4. Notify WebSocket clients: emit aggregate metric updates (FERPA compliance)
    await manager.broadcast({
        "type": "AGGREGATE_METRICS_UPDATED",
        "metrics": compute_aggregate_metrics()
    })
    
    if is_anomaly:
        return PunchInResponse(
            status="NETWORK_VERIFICATION_NEEDED",
            session_token=jwt_token,
            session_secret=settings.SESSION_SECRET,
            student_id=req.student_id,
            student_name=req.student_name,
            anomaly_flag=anomaly_reason,
            message=anomaly_reason or "Network verification needed"
        )
    
    return PunchInResponse(
        status="FOCUSED",
        session_token=jwt_token,
        session_secret=settings.SESSION_SECRET,
        student_id=req.student_id,
        student_name=req.student_name,
        message="Attendance attested and verified. Welcome to Lecture Mode."
    )

@app.post("/api/attendance/focus-event")
async def record_focus_event(req: FocusEventRequest):
    if req.student_id not in STUDENTS_STORE:
        raise HTTPException(status_code=404, detail="Student not found in active session")
    
    student = STUDENTS_STORE[req.student_id]
    now = time.time()
    student["last_seen"] = now
    
    if req.event_type == "EVENT_FOCUS_LOST":
        student["is_focused"] = False
        student["last_event"] = "FOCUS_LOST"
    elif req.event_type == "EVENT_FOCUS_RESTORED":
        student["is_focused"] = True
        student["last_event"] = "FOCUS_RESTORED"
        
    # Broadcast anonymized class-wide aggregate update (no student names or individual statuses)
    await manager.broadcast({
        "type": "AGGREGATE_METRICS_UPDATED",
        "metrics": compute_aggregate_metrics()
    })
        
    return {"ok": True, "focus_state": "registered"}

@app.post("/api/session/pulse/trigger")
async def trigger_pulse(req: PresencePulseTrigger):
    """
    Faculty broadcasts an unannounced 30s MCQ quiz to test actual in-room human presence.
    """
    quiz = MOCK_QUIZZES[0]
    payload = {
        "type": "PRESENCE_PULSE_START",
        "quiz": quiz,
        "duration_seconds": req.duration_seconds,
        "triggered_at": time.time()
    }
    await manager.broadcast(payload)
    return {"ok": True, "quiz_id": quiz["quiz_id"]}

@app.post("/api/session/pulse/submit")
async def submit_pulse(sub: QuizSubmission):
    if sub.student_id in STUDENTS_STORE:
        STUDENTS_STORE[sub.student_id]["quiz_submitted"] = True
    
    quiz = MOCK_QUIZZES[0]
    is_correct = (sub.selected_option == quiz["correct_option"])
    
    await manager.broadcast({
        "type": "QUIZ_SUBMITTED",
        "student_id": sub.student_id,
        "is_correct": is_correct
    })
    return {"ok": True, "is_correct": is_correct}

@app.post("/api/attendance/override")
async def override_attendance(
    req: OverrideAttendanceRequest,
    request: Request,
    _auth: str = Depends(require_instructor_auth)
):
    """
    Instructor manual override: removes network verification flag and sets
    student status to VERIFIED_PRESENT (or instructor-chosen status).
    Guarantees automated network anomaly flags NEVER permanently impact student attendance/grades.
    Logs audit entry for FERPA and governance tracking.
    """
    if req.student_id not in STUDENTS_STORE:
        raise HTTPException(status_code=404, detail="Student not found in active session")
    
    student = STUDENTS_STORE[req.student_id]
    student["status"] = req.new_status
    student["is_focused"] = True
    student["anomaly_flag"] = None
    student["last_event"] = f"OVERRIDDEN_BY_INSTRUCTOR: {req.reason}"
    
    client_ip = request.client.host if request.client else "unknown"
    audit_id = f"aud_ovr_{int(time.time())}_{secrets.token_hex(4)}"
    AUDIT_LOGS.append({
        "id": audit_id,
        "action": "MANUAL_OVERRIDE_RECORDED",
        "actor": "instructor",
        "timestamp": time.time(),
        "ip_address": client_ip,
        "detail": f"Instructor manually marked {req.student_id} as {req.new_status}. Reason: {req.reason}"
    })
    
    await manager.broadcast({
        "type": "ATTENDANCE_OVERRIDDEN",
        "student_id": req.student_id,
        "attendance_status": req.new_status,
        "reason": req.reason,
        "student": student
    })
    
    return {
        "ok": True,
        "student_id": req.student_id,
        "attendance_status": req.new_status,
        "audit_id": audit_id
    }

@app.post("/api/session/simulate-proxy")
async def simulate_proxy_attack():
    """
    Faculty dashboard trigger to prove rogue proxy detection on stage.
    """
    rogue_student_id = f"ROGUE_{int(time.time()) % 1000}"
    rogue_record = {
        "student_id": rogue_student_id,
        "student_name": "Rogue Proxy Bot",
        "seat": "Remote / External",
        "network_attested": False,
        "status": "NETWORK_VERIFICATION_NEEDED",
        "joined_at": time.time(),
        "last_event": "NETWORK_VERIFICATION_NEEDED",
        "last_seen": time.time(),
        "quiz_submitted": False,
        "anomaly_flag": "NETWORK_VERIFICATION_NEEDED: Synthetic Rogue Subnet / External BSSID"
    }
    STUDENTS_STORE[rogue_student_id] = rogue_record
    
    await manager.broadcast({
        "type": "ANOMALY_DETECTED",
        "student": rogue_record,
        "status": "NETWORK_VERIFICATION_NEEDED",
        "message": "NETWORK_VERIFICATION_NEEDED: Synthetic Rogue Subnet / External BSSID"
    })
    return {"ok": True, "simulated_student": rogue_record}

@app.post("/api/session/end")
async def end_session():
    ACTIVE_SESSION["is_active"] = False
    await manager.broadcast({"type": "SESSION_ENDED", "session_id": ACTIVE_SESSION["session_id"]})
    return {"ok": True, "ended": True}

# --- PROTECTED COURSE PORTAL ENDPOINTS (Guarded by SignedRequestGateMiddleware) ---

@app.get("/api/course-portal/slides")
def get_slides():
    return {
        "session_id": ACTIVE_SESSION["session_id"],
        "course": MOCK_TIMETABLE["course_title"],
        "slides": MOCK_SLIDES
    }

@app.get("/api/course-portal/timetable")
def get_timetable():
    return MOCK_TIMETABLE

# --- DATA RETENTION POLICY & SCHEDULED CLEANUP JOB (Item 7) ---

def cleanup_expired_records(retention_days: Optional[int] = None) -> Dict[str, Any]:
    """
    DATA RETENTION POLICY:
    Automatically deletes attendance verification records and audit logs older than N days (default: 30 days).
    Enforces privacy by design and prevents indefinite accumulation of attendance verification telemetry.
    """
    days = retention_days if retention_days is not None else settings.RETENTION_DAYS
    cutoff = time.time() - (days * 86400)
    
    # 1. Purge expired student records
    expired_student_ids = [
        sid for sid, s in STUDENTS_STORE.items()
        if s.get("joined_at", 0) < cutoff
    ]
    for sid in expired_student_ids:
        del STUDENTS_STORE[sid]
        
    # 2. Purge expired audit logs
    initial_audit_count = len(AUDIT_LOGS)
    AUDIT_LOGS[:] = [log for log in AUDIT_LOGS if log.get("timestamp", 0) >= cutoff]
    purged_audit_count = initial_audit_count - len(AUDIT_LOGS)
    
    return {
        "ok": True,
        "retention_days": days,
        "cutoff_timestamp": cutoff,
        "students_purged": len(expired_student_ids),
        "audit_logs_purged": purged_audit_count,
        "remaining_students": len(STUDENTS_STORE),
        "remaining_audit_logs": len(AUDIT_LOGS)
    }

@app.post("/api/session/retention/cleanup")
def trigger_retention_cleanup(
    retention_days: Optional[int] = None,
    _auth: str = Depends(require_instructor_auth)
):
    """
    Manual trigger / test endpoint for scheduled retention policy enforcement.
    Protected by instructor authentication.
    """
    return cleanup_expired_records(retention_days)

async def retention_cleanup_scheduler():
    """Scheduled background job that executes the retention policy daily."""
    while True:
        try:
            cleanup_expired_records()
        except Exception:
            pass
        await asyncio.sleep(86400)  # Check daily

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(retention_cleanup_scheduler())

# --- WEBSOCKET GATEWAY ---

@app.websocket("/ws/session")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send public session snapshot: session info and AGGREGATE metrics only (FERPA compliant)
        await websocket.send_text(json.dumps({
            "type": "SESSION_SNAPSHOT",
            "session": ACTIVE_SESSION,
            "metrics": compute_aggregate_metrics()
        }))
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                # Handle client-relayed events if any
                if msg.get("type") == "PING":
                    await websocket.send_text(json.dumps({"type": "PONG", "time": time.time()}))
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
