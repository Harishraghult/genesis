"""Optional BLE proximity evidence. Never changes attendance."""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import current_user, digest, teacher, utc
from .config import settings
from .db import get_db
from .models import Attendance, BleCredential, BleReceiver, BleSighting, ClassSession, OptionalConsent, User
from .qr_security import b64
from .stage2 import assigned_session, enrolled_session, now_utc, student_only

router = APIRouter()
receiver_bearer = HTTPBearer(auto_error=False)
SLOT_SECONDS = 15


class SightingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: int
    token: UUID
    seen_at: datetime


def ble_key() -> bytes:
    key = settings().ble_token_key.encode()
    if len(key) < 32:
        raise HTTPException(503, "BLE token key is not configured")
    return key


def credential_secret(row: BleCredential) -> bytes:
    canonical = f"FL-BLE3\n{row.id}\n{row.session_id}\n{row.student_id}".encode("ascii")
    return hmac.new(ble_key(), canonical, hashlib.sha256).digest()


def rotating_token(secret: bytes, slot: int) -> UUID:
    value = bytes.fromhex("f10c0c10") + hmac.new(secret, str(slot).encode("ascii"), hashlib.sha256).digest()[:12]
    return UUID(bytes=value)


@router.post("/sessions/{session_id}/ble-credential")
def issue_credential(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    consent = db.get(OptionalConsent, (user.id, "bluetooth"))
    if consent is None or consent.withdrawn_at is not None:
        raise HTTPException(403, "Bluetooth consent required")
    ble_key()
    session = enrolled_session(db, user, session_id)
    now = now_utc()
    attendance = db.get(Attendance, (session_id, user.id))
    if session.state != "active" or utc(session.ends_at) <= now or attendance is None or attendance.status != "present":
        raise HTTPException(409, "Active session and confirmed check-in required")
    row = db.scalar(select(BleCredential).where(BleCredential.session_id == session_id,
        BleCredential.student_id == user.id, BleCredential.expires_at > now + timedelta(seconds=60)).order_by(BleCredential.expires_at.desc()))
    if row is None:
        expiry = min(now + timedelta(minutes=5), utc(session.ends_at))
        if expiry <= now + timedelta(seconds=15):
            raise HTTPException(409, "Session is about to end")
        row = BleCredential(id=str(uuid4()), session_id=session_id, student_id=user.id, issued_at=now, expires_at=expiry)
        db.add(row)
        db.commit()
    return {"credential_id": row.id, "secret": b64(credential_secret(row)), "issued_at": utc(row.issued_at),
            "expires_at": utc(row.expires_at), "server_time": now, "slot_seconds": SLOT_SECONDS}


def receiver_auth(receiver_id: str, credentials: HTTPAuthorizationCredentials | None, db: Session) -> BleReceiver:
    if credentials is None:
        raise HTTPException(401, "Receiver authentication required")
    receiver = db.get(BleReceiver, receiver_id)
    if receiver is None or not receiver.active or not hmac.compare_digest(receiver.token_digest, digest(credentials.credentials)):
        raise HTTPException(401, "Invalid receiver credentials")
    return receiver


@router.post("/receivers/{receiver_id}/sightings", status_code=201)
def submit_sighting(receiver_id: str, body: SightingInput,
                    credentials: HTTPAuthorizationCredentials | None = Depends(receiver_bearer),
                    db: Session = Depends(get_db)):
    receiver = receiver_auth(receiver_id, credentials, db)
    from .stage6 import rate_limit
    rate_limit(db, "receiver-sighting", receiver_id, 120)
    session = db.get(ClassSession, body.session_id)
    now = now_utc()
    seen = utc(body.seen_at)
    if (session is None or session.course_id != receiver.course_id or session.room_code != receiver.room_code or
            session.state != "active" or utc(session.ends_at) <= now):
        raise HTTPException(404, "Receiver is not assigned to this active room/session")
    if abs((now - seen).total_seconds()) > 30:
        raise HTTPException(410, "Sighting timestamp is stale")
    slot = int(seen.timestamp()) // SLOT_SECONDS
    match = None
    matched_slot = None
    rows = db.scalars(select(BleCredential).where(BleCredential.session_id == session.id,
        BleCredential.issued_at <= now, BleCredential.expires_at > now))
    for row in rows:
        secret = credential_secret(row)
        for candidate in (slot - 1, slot, slot + 1):
            if hmac.compare_digest(rotating_token(secret, candidate).bytes, body.token.bytes):
                match, matched_slot = row, candidate
                break
        if match is not None:
            break
    if match is None:
        raise HTTPException(422, "Unknown or expired BLE token")
    db.add(BleSighting(receiver_id=receiver.id, credential_id=match.id, slot=matched_slot, recorded_at=now))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Duplicate sighting")
    return {"recorded": True, "evidence": "approximate_device_proximity"}


@router.post("/receivers/{receiver_id}/heartbeat")
def receiver_heartbeat(receiver_id: str,
                       credentials: HTTPAuthorizationCredentials | None = Depends(receiver_bearer),
                       db: Session = Depends(get_db)):
    receiver = receiver_auth(receiver_id, credentials, db)
    from .stage6 import rate_limit
    rate_limit(db, "receiver-heartbeat", receiver_id, 12)
    receiver.last_heartbeat_at = now_utc()
    db.commit()
    return {"accepted": True}


@router.get("/sessions/{session_id}/receiver-status")
def receiver_status(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = (assigned_session if user.role == "teacher" else enrolled_session)(db, user, session_id)
    rows = list(db.scalars(select(BleReceiver).where(BleReceiver.course_id == session.course_id,
        BleReceiver.room_code == session.room_code, BleReceiver.active.is_(True))))
    online = any(row.last_heartbeat_at is not None and
        (now_utc() - utc(row.last_heartbeat_at)).total_seconds() <= 45 for row in rows)
    return {"state": "available" if online else "reduced_evidence", "receiver_count": len(rows)}


@router.get("/sessions/{session_id}/presence")
def presence(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    assigned_session(db, user, session_id)
    return [{"student_id": credential.student_id, "recorded_at": utc(sighting.recorded_at)}
            for sighting, credential in db.execute(select(BleSighting, BleCredential).join(BleCredential,
                BleCredential.id == BleSighting.credential_id).where(BleCredential.session_id == session_id))]
