from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class PunchInRequest(BaseModel):
    student_id: str = Field(..., pattern=r"^[A-Za-z0-9_.-]{1,40}$")
    student_name: str = Field(..., min_length=1, max_length=100)
    totp_token: str = Field(..., pattern=r"^\d{6}$")
    bssid_match: Optional[bool] = None  # On-device pass/fail attestation against room AP list
    salted_bssid_hmac: Optional[str] = None  # Privacy-preserving per-session HMAC
    reported_bssid: Optional[str] = None  # Backwards compatibility only, never persisted
    device_fingerprint: Optional[str] = None  # Optional client fingerprint, never used as fraud signal
    is_simulation: bool = False

class PunchInResponse(BaseModel):
    status: str  # "FOCUSED", "NETWORK_VERIFICATION_NEEDED", "ERROR"
    session_token: Optional[str] = None
    session_secret: Optional[str] = None
    student_id: str
    student_name: str
    network_attested: bool = True  # Result only, never persistent identifier
    anomaly_flag: Optional[str] = None
    message: str

class FocusEventRequest(BaseModel):
    student_id: str
    event_type: str  # "EVENT_FOCUS_LOST", "EVENT_FOCUS_RESTORED", "UNPINNED"
    detail: Optional[str] = None

class PresencePulseTrigger(BaseModel):
    quiz_id: Optional[str] = "quiz-1"
    duration_seconds: int = 30

class QuizSubmission(BaseModel):
    student_id: str
    quiz_id: str
    selected_option: int

class AggregateMetrics(BaseModel):
    total_joined: int
    focused_count: int
    distracted_count: int
    focus_percentage: float
    flagged_count: int

class SessionStatus(BaseModel):
    session_id: str
    course_name: str
    instructor_name: str
    room: str
    started_at: float
    is_active: bool
    metrics: AggregateMetrics
    emergency_number: str = "112"

class StudentRosterRecord(BaseModel):
    student_id: str
    student_name: str
    seat: str
    joined_at: float
    last_seen: float
    attendance_status: str  # e.g. "VERIFIED_PRESENT", "NETWORK_VERIFICATION_NEEDED"
    network_attested: bool = True  # Result only, never persistent identifier
    quiz_submitted: bool = False
    anomaly_flag: Optional[str] = None

class OverrideAttendanceRequest(BaseModel):
    student_id: str
    reason: str = "Instructor visual verification"
    new_status: str = "VERIFIED_PRESENT"

class AuditLogEntry(BaseModel):
    id: str
    action: str
    actor: str
    timestamp: float
    ip_address: str
    detail: Optional[str] = None

class RosterResponse(BaseModel):
    session_id: str
    students: List[StudentRosterRecord]
    audit_id: str

