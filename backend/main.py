"""FocusLock backend: a session-scoped secure classroom service.

The instructor starts a session and projects a rotating 6-digit TOTP. Students
check in from the classroom subnet with that code and an enrolled device key.
Each student then gets a per-session secret, and every later request
(/portal/*, /api/client/*) must be HMAC-signed with that secret.

Privacy: we store only what attendance needs. That is the student id,
timestamps, coarse client events (pause/resume/exit/vpn_*) and the last
reported VPN on/off state. We store no IP addresses, no destinations, no
app lists and no location.

State is in memory (hackathon scope). Restarting the server forgets everything.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import secrets
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- config

INSTRUCTOR_KEY = os.environ.get("FL_INSTRUCTOR_KEY", "dev-instructor-key")
CLASSROOM_NETS = [
    ipaddress.ip_network(n.strip(), strict=False)
    for n in os.environ.get("FL_CLASSROOM_NETS", "127.0.0.1/32,10.0.0.0/8,192.168.0.0/16").split(",")
    if n.strip()
]
TOTP_STEP = 15          # seconds per code
SIG_MAX_SKEW = 30       # signed requests older/newer than this are rejected
MAX_EVENTS = 200        # per student, keeps memory bounded
ID_PATTERN = r"^[A-Za-z0-9_.-]{1,40}$"

# Client events that also tell us the VPN state. Event types stay free strings;
# this map only adds a side effect for the known vpn_* ones.
VPN_EVENT_STATE = {
    "vpn_started": True,
    "vpn_stopped": False,
    "vpn_revoked": False,
    "vpn_declined": False,
}


def now() -> float:
    """Single time source so tests can monkeypatch it."""
    return time.time()


# --------------------------------------------------------------------------- crypto helpers

def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sign(secret_hex: str, method: str, path_with_query: str, ts: str | int, nonce: str, body: bytes) -> str:
    """Request signature. The Android client must reproduce this byte for byte
    (see test_vectors.json).

    Sig = HMAC-SHA256(secret, METHOD \\n path_with_query \\n ts \\n nonce \\n sha256_hex(body))
    """
    msg = "\n".join([method.upper(), path_with_query, str(ts), nonce, sha256_hex(body)])
    return hmac.new(bytes.fromhex(secret_hex), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def device_sig(device_key_hex: str, session_id: str, student_id: str, code: str, ts: str | int) -> str:
    """Check-in proof that the request comes from the enrolled device."""
    msg = "\n".join(["checkin", session_id, student_id, code, str(ts)])
    return hmac.new(bytes.fromhex(device_key_hex), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def totp(seed: bytes, t: float, step: int = TOTP_STEP) -> str:
    """RFC 6238-style 6-digit code (HMAC-SHA1, dynamic truncation)."""
    digest = hmac.new(seed, struct.pack(">Q", int(t // step)), hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[off:off + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{value:06d}"


def totp_ok(seed: bytes, code: str, t: float) -> bool:
    # Accept the current and the previous step, because students type while the code rotates.
    return any(hmac.compare_digest(totp(seed, t - d * TOTP_STEP), code) for d in (0, 1))


# --------------------------------------------------------------------------- state

@dataclass
class Client:
    student_id: str
    secret: str
    checked_in_at: float
    last_seen: float
    last_beat: float                 # anchor for presence accounting
    present_seconds: float = 0.0
    left_at: Optional[float] = None
    vpn_active: Optional[bool] = None  # None means never reported
    vpn_last_change: Optional[float] = None
    events: list = field(default_factory=list)


@dataclass
class Session:
    id: str
    seed: bytes
    started_at: float
    ends_at: float
    heartbeat_s: int
    allowed_hosts: list
    ended_at: Optional[float] = None
    clients: dict = field(default_factory=dict)
    nonces: dict = field(default_factory=dict)  # nonce -> expiry

    def active(self, t: float) -> bool:
        return self.ended_at is None and t < self.ends_at


SESSIONS: dict[str, Session] = {}
DEVICES: dict[str, str] = {}  # student_id -> device key (hex)
LOCK = threading.RLock()


def reset() -> None:
    """Clear all state (used by tests and demo)."""
    with LOCK:
        SESSIONS.clear()
        DEVICES.clear()


def set_vpn(c: Client, active: bool, t: float) -> None:
    if c.vpn_active != active:
        c.vpn_active = active
        c.vpn_last_change = t


def record_beat(s: Session, c: Client, t: float) -> None:
    """Presence = sum of gaps between heartbeats, each capped at 2x interval.

    The cap means time spent unreachable (e.g. the phone left the classroom
    Wi-Fi or switched to mobile data, where signed requests are rejected)
    does not count as presence.
    """
    gap = max(0.0, t - c.last_beat)
    c.present_seconds += min(gap, 2 * s.heartbeat_s)
    c.last_beat = t
    c.last_seen = t


# --------------------------------------------------------------------------- request guards

def client_in_classroom(request: Request) -> bool:
    host = request.client.host if request.client else ""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    return any(ip.version == n.version and ip in n for n in CLASSROOM_NETS)


def require_instructor(x_instructor_key: Optional[str] = Header(None)) -> None:
    if not x_instructor_key or not hmac.compare_digest(x_instructor_key, INSTRUCTOR_KEY):
        raise HTTPException(401, "instructor key required")


def get_session(sid: str) -> Session:
    s = SESSIONS.get(sid)
    if not s:
        raise HTTPException(404, "unknown session")
    return s


def path_with_query(request: Request) -> str:
    # Use the raw (still percent-encoded) path so it matches OkHttp's encodedPath.
    raw = request.scope.get("raw_path") or request.url.path.encode()
    pq = raw.decode("latin-1")
    q = request.scope.get("query_string", b"").decode("latin-1")
    return pq + ("?" + q if q else "")


async def gate(request: Request) -> tuple[Session, Client]:
    """Verify a signed client request. Returns (session, client) or raises."""
    h = request.headers
    sid, stu = h.get("x-fl-session"), h.get("x-fl-student")
    ts, nonce, sig = h.get("x-fl-ts"), h.get("x-fl-nonce"), h.get("x-fl-sig")
    if not all((sid, stu, ts, nonce, sig)):
        raise HTTPException(401, "missing signature headers")
    if not client_in_classroom(request):
        raise HTTPException(403, "outside classroom network")
    with LOCK:
        s = SESSIONS.get(sid)
        c = s.clients.get(stu) if s else None
    if not c:
        raise HTTPException(401, "unknown session or student")
    try:
        ts_i = int(ts)
    except ValueError:
        raise HTTPException(401, "bad timestamp")
    body = await request.body()
    expected = sign(c.secret, request.method, path_with_query(request), ts, nonce, body)
    if not hmac.compare_digest(expected, sig.lower()):
        raise HTTPException(401, "bad signature")
    t = now()
    if abs(t - ts_i) > SIG_MAX_SKEW:
        raise HTTPException(401, "stale request")
    with LOCK:
        for n in [n for n, exp in s.nonces.items() if exp < t]:
            del s.nonces[n]
        if nonce in s.nonces:
            raise HTTPException(401, "replayed nonce")
        s.nonces[nonce] = t + 2 * SIG_MAX_SKEW
        if not s.active(t) or c.left_at is not None:
            # 410 tells the app to unlock and stop the VPN.
            raise HTTPException(410, "session ended")
    return s, c


# --------------------------------------------------------------------------- models

class DeviceReq(BaseModel):
    student_id: str = Field(pattern=ID_PATTERN)


class StartReq(BaseModel):
    duration_min: int = Field(60, ge=1, le=600)
    heartbeat_s: int = Field(10, ge=5, le=120)
    allowed_hosts: list[str] = Field(default_factory=list, max_length=50)


class CheckinReq(BaseModel):
    session_id: str = Field(pattern=ID_PATTERN)
    student_id: str = Field(pattern=ID_PATTERN)
    code: str = Field(pattern=r"^\d{6}$")
    ts: int
    device_sig: str = Field(pattern=r"^[0-9a-fA-F]{64}$")


class EventReq(BaseModel):
    type: str = Field(pattern=r"^[a-z0-9_]{1,40}$")  # free string by design
    detail: Optional[str] = Field(None, max_length=200)


# --------------------------------------------------------------------------- app

app = FastAPI(title="FocusLock")


@app.get("/api/health")
def health():
    return {"ok": True, "server_time": now()}


@app.post("/api/devices", dependencies=[Depends(require_instructor)])
def enroll_device(req: DeviceReq):
    """Enrol (or re-enrol) a student's device. The key is shown once and typed/scanned into the app."""
    key = secrets.token_hex(32)
    with LOCK:
        DEVICES[req.student_id] = key
    return {"student_id": req.student_id, "device_key": key}


@app.post("/api/session/start", dependencies=[Depends(require_instructor)])
def start_session(req: StartReq):
    t = now()
    s = Session(
        id=secrets.token_hex(4),
        seed=secrets.token_bytes(20),
        started_at=t,
        ends_at=t + req.duration_min * 60,
        heartbeat_s=req.heartbeat_s,
        allowed_hosts=[h.strip().lower() for h in req.allowed_hosts if h.strip()],
    )
    with LOCK:
        SESSIONS[s.id] = s
    return {"session_id": s.id, "ends_at": s.ends_at, "heartbeat_s": s.heartbeat_s}


@app.get("/api/session/{sid}/code", dependencies=[Depends(require_instructor)])
def session_code(sid: str):
    s = get_session(sid)
    t = now()
    if not s.active(t):
        raise HTTPException(410, "session ended")
    return {"code": totp(s.seed, t), "step": TOTP_STEP, "valid_for": TOTP_STEP - int(t % TOTP_STEP)}


@app.post("/api/session/{sid}/end", dependencies=[Depends(require_instructor)])
def end_session(sid: str):
    s = get_session(sid)
    with LOCK:
        if s.ended_at is None:
            s.ended_at = now()
    return {"ended": True, "ended_at": s.ended_at}


@app.get("/api/session/{sid}/report", dependencies=[Depends(require_instructor)])
def session_report(sid: str):
    s = get_session(sid)
    t = now()
    with LOCK:
        students = []
        for c in s.clients.values():
            counts: dict[str, int] = {}
            for e in c.events:
                counts[e["type"]] = counts.get(e["type"], 0) + 1
            students.append({
                "student_id": c.student_id,
                "checked_in_at": c.checked_in_at,
                "last_seen": c.last_seen,
                "left_at": c.left_at,
                "present_seconds": int(c.present_seconds),
                "vpn_active": c.vpn_active,
                "vpn_last_change": c.vpn_last_change,
                "event_counts": counts,
                "events": list(c.events),
            })
    return {
        "session_id": s.id,
        "started_at": s.started_at,
        "ends_at": s.ends_at,
        "ended_at": s.ended_at,
        "active": s.active(t),
        "students": students,
    }


@app.post("/api/checkin")
def checkin(req: CheckinReq, request: Request):
    if not client_in_classroom(request):
        raise HTTPException(403, "outside classroom network")
    s = get_session(req.session_id)
    t = now()
    if not s.active(t):
        raise HTTPException(410, "session ended")
    if abs(t - req.ts) > SIG_MAX_SKEW:
        raise HTTPException(401, "stale check-in")
    if not totp_ok(s.seed, req.code, t):
        raise HTTPException(401, "wrong or expired code")
    with LOCK:
        key = DEVICES.get(req.student_id)
    if not key:
        raise HTTPException(403, "device not enrolled")
    good = device_sig(key, req.session_id, req.student_id, req.code, req.ts)
    if not hmac.compare_digest(good, req.device_sig.lower()):
        raise HTTPException(401, "bad device signature")
    secret = secrets.token_hex(32)
    with LOCK:
        prev = s.clients.get(req.student_id)
        if prev:  # re-check-in (app restart): new secret, keep history
            prev.secret, prev.left_at, prev.last_seen = secret, None, t
            prev.last_beat = t
        else:
            s.clients[req.student_id] = Client(req.student_id, secret, t, t, t)
    return {
        "secret": secret,
        "policy": {
            "allowed_hosts": s.allowed_hosts,
            "ends_at": s.ends_at,
            "heartbeat_s": s.heartbeat_s,
            "server_time": t,
        },
    }


@app.get("/api/client/heartbeat")
def heartbeat(
    sc: tuple = Depends(gate),
    vpn: Optional[str] = Query(None, pattern=r"^[01]$", description="1 if the restriction VPN is up"),
):
    s, c = sc
    with LOCK:
        t = now()
        record_beat(s, c, t)
        if vpn is not None:
            set_vpn(c, vpn == "1", t)
    return {"ok": True, "ends_at": s.ends_at, "server_time": t, "heartbeat_s": s.heartbeat_s}


@app.post("/api/client/event")
def client_event(req: EventReq, sc: tuple = Depends(gate)):
    s, c = sc
    with LOCK:
        t = now()
        c.last_seen = t
        if len(c.events) < MAX_EVENTS:
            c.events.append({"type": req.type, "at": t, "detail": req.detail})
        if req.type in VPN_EVENT_STATE:
            set_vpn(c, VPN_EVENT_STATE[req.type], t)
    return {"ok": True}


@app.post("/api/client/leave")
def client_leave(sc: tuple = Depends(gate)):
    s, c = sc
    with LOCK:
        t = now()
        c.left_at = t
        c.last_seen = t
        c.events.append({"type": "leave", "at": t, "detail": None})
    return {"ok": True}


# --------------------------------------------------------------------------- portal (signed)

_PAGES = {
    "": ("Today's class", "<p>Welcome. Use the links below for today's material.</p>"
         "<ul><li><a href='/portal/notes'>Lecture notes</a></li>"
         "<li><a href='/portal/slides'>Slides</a></li></ul>"),
    "notes": ("Lecture notes", "<p>Unit 3: Hash functions and HMAC. An HMAC binds a message to a shared "
              "secret, so a tampered request fails verification.</p><a href='/portal/'>Back</a>"),
    "slides": ("Slides", "<ol><li>Why sign requests</li><li>Replay windows and nonces</li>"
               "<li>Session-scoped secrets</li></ol><a href='/portal/'>Back</a>"),
}


def _page(title: str, body: str) -> str:
    return (f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' "
            f"content='width=device-width,initial-scale=1'><title>{title}</title><style>"
            "body{font-family:system-ui,sans-serif;margin:0;background:#0f1222;color:#e8e9f3}"
            "main{max-width:680px;margin:auto;padding:24px}h1{color:#9fb4ff}a{color:#7ee0c3}"
            f"</style></head><body><main><h1>{title}</h1>{body}</main></body></html>")


@app.get("/portal/", response_class=HTMLResponse)
@app.get("/portal/{page}", response_class=HTMLResponse)
def portal(page: str = "", sc: tuple = Depends(gate)):
    if page not in _PAGES:
        raise HTTPException(404, "no such page")
    return _page(*_PAGES[page])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
