import hashlib
import secrets
from typing import Literal
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from .auth import current_user, teacher, utc
from .db import get_db
from .models import AdminAudit, Attendance, AttendanceEvent, ClassSession, CourseOffering, Device, DeviceChallenge, Enrollment, PendingAttendance, User
from .qr_security import checkin_payload, public_key, qr_ascii, qr_token, register_payload, verify_device_signature, verify_qr

router = APIRouter()


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Registration(Strict):
    challenge_id: str = Field(max_length=36)
    public_key: str = Field(max_length=1024)
    signature: str = Field(max_length=256)
    integrity_token: str | None = Field(default=None, max_length=8192)


class ChallengeRequest(Strict):
    device_id: str = Field(max_length=36)
    qr: str = Field(max_length=1024)
    focus_disclosure: Literal["accepted"]
    face_verified: bool = False


class CheckIn(ChallengeRequest):
    challenge_id: str = Field(max_length=36)
    signature: str = Field(max_length=256)
    integrity_token: str | None = Field(default=None, max_length=8192)


class PendingRequest(Strict):
    reason: str = Field(min_length=10, max_length=500)


def now_utc():
    return datetime.now(timezone.utc)


def student_only(user):
    if user.role != "student":
        raise HTTPException(403, "Student role required")


def assigned_session(db, user, session_id, *, lock=False):
    query = select(ClassSession).where(ClassSession.id == session_id)
    if lock:
        query = query.with_for_update()
    session = db.scalar(query)
    if session is None or db.get(CourseOffering, session.course_id).teacher_id != user.id:
        raise HTTPException(404, "Session not found")
    return session


def enrolled_session(db, user, session_id):
    session = db.get(ClassSession, session_id)
    if session is None or db.get(Enrollment, (session.course_id, user.id)) is None:
        raise HTTPException(404, "Session not found")
    return session


def active(session, now):
    if session.state not in ("checkin_pending", "active") or utc(session.started_at) > now or utc(session.ends_at) <= now:
        raise HTTPException(409, "Session is not active")


def device_for(db, user, device_id):
    device = db.get(Device, device_id)
    if device is None or device.student_id != user.id or device.revoked_at is not None:
        raise HTTPException(404, "Registered device not found")
    return device


def challenge_view(challenge):
    return {"challenge_id": challenge.id, "nonce": challenge.nonce, "expires_at": utc(challenge.expires_at)}


@router.post("/sessions/{session_id}/start")
def start(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    session = assigned_session(db, user, session_id, lock=True)
    now = now_utc()
    if session.state == "checkin_pending":
        return {"state": "checkin_pending", "started_at": utc(session.started_at)}
    if session.state != "ready" or utc(session.starts_at) > now or utc(session.ends_at) <= now:
        raise HTTPException(409, "Session cannot be started at this time")
    session.state, session.started_at = "checkin_pending", now
    db.add(AdminAudit(actor_id=user.id, action="session_started", target_type="session", target_id=str(session_id),
                      reason="Teacher opened check-in", recorded_at=now))
    db.commit()
    return {"state": "checkin_pending", "started_at": now}


@router.post("/sessions/{session_id}/end")
def end(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    session = assigned_session(db, user, session_id, lock=True)
    if session.state == "ended":
        return {"state": "ended", "ended_at": utc(session.ended_at)}
    if session.state not in ("checkin_pending", "active", "paused"):
        raise HTTPException(409, "Session has not started")
    session.state, session.ended_at = "ended", now_utc()
    db.add(AdminAudit(actor_id=user.id, action="session_ended", target_type="session", target_id=str(session_id),
                      reason="Teacher ended session", recorded_at=session.ended_at))
    db.commit()
    return {"state": "ended", "ended_at": utc(session.ended_at)}


@router.get("/sessions/{session_id}/qr")
def qr(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    session = assigned_session(db, user, session_id)
    now = now_utc()
    active(session, now)
    token, expiry = qr_token(session.id, session.course_id, utc(session.started_at), utc(session.ends_at), now)
    return {"qr": token, "expires_at": datetime.fromtimestamp(expiry, timezone.utc), "rotation_seconds": 20}


@router.post("/devices/challenge")
def registration_challenge(user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    from .stage6 import rate_limit
    rate_limit(db, "device-challenge", str(user.id), 10)
    now = now_utc()
    challenge = DeviceChallenge(id=str(uuid4()), student_id=user.id, purpose="register", nonce=secrets.token_urlsafe(24), expires_at=now + timedelta(minutes=5))
    db.add(challenge)
    db.commit()
    from .integrity import request_hash
    return {**challenge_view(challenge), "integrity_request_hash": request_hash("register", register_payload(user.id, challenge.id, challenge.nonce))}


@router.post("/devices/register")
def register(body: Registration, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    challenge = db.get(DeviceChallenge, body.challenge_id)
    now = now_utc()
    if challenge is None or challenge.student_id != user.id or challenge.purpose != "register" or challenge.used_at is not None or utc(challenge.expires_at) <= now:
        raise HTTPException(409, "Registration challenge expired or used")
    key, fingerprint = public_key(body.public_key)
    verify_device_signature(key, register_payload(user.id, challenge.id, challenge.nonce), body.signature)
    if not user.is_demo and db.scalar(select(Device.id).where(Device.student_id == user.id, Device.revoked_at.is_(None))) is not None:
        raise HTTPException(409, "Use signed device replacement or contact an administrator")
    from .integrity import verify_integrity
    verify_integrity(db, "register", register_payload(user.id, challenge.id, challenge.nonce), body.integrity_token)
    claimed = db.execute(update(DeviceChallenge).where(DeviceChallenge.id == challenge.id, DeviceChallenge.used_at.is_(None), DeviceChallenge.expires_at > now).values(used_at=now).execution_options(synchronize_session=False)).rowcount
    if claimed != 1:
        raise HTTPException(409, "Registration challenge already used")
    existing = db.scalar(select(Device).where(Device.fingerprint == fingerprint))
    if existing is not None:
        if existing.student_id != user.id or existing.revoked_at is not None:
            raise HTTPException(409, "Key is already registered")
        db.commit()
        return {"device_id": existing.id, "registered": True}
    device = Device(id=str(uuid4()), student_id=user.id, public_key=body.public_key, fingerprint=fingerprint, registered_at=now)
    db.add(device)
    db.commit()
    return {"device_id": device.id, "registered": True}


@router.get("/devices")
def devices(user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    return [{"device_id": d.id, "registered_at": utc(d.registered_at)} for d in db.scalars(select(Device).where(Device.student_id == user.id, Device.revoked_at.is_(None)))]


@router.post("/devices/{device_id}/revoke")
def revoke(device_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    device = device_for(db, user, device_id)
    device.revoked_at = now_utc()
    db.commit()
    return {"revoked": True}


@router.post("/check-ins/challenge")
def checkin_challenge(body: ChallengeRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    from .stage6 import rate_limit
    rate_limit(db, "checkin-challenge", str(user.id), 20)
    device_for(db, user, body.device_id)
    from .face import require_face
    require_face(db, user, body.face_verified)
    now = now_utc()
    payload = verify_qr(body.qr, now)
    session = enrolled_session(db, user, payload["sid"])
    active(session, now)
    if payload["cid"] != session.course_id or payload["start"] != int(utc(session.started_at).timestamp()):
        raise HTTPException(422, "QR challenge does not match this session")
    challenge = DeviceChallenge(id=str(uuid4()), student_id=user.id, purpose="checkin", nonce=secrets.token_urlsafe(24), device_id=body.device_id, session_id=session.id, qr_digest=hashlib.sha256(body.qr.encode("ascii")).hexdigest(), expires_at=min(datetime.fromtimestamp(payload["exp"], timezone.utc), now + timedelta(seconds=15)))
    db.add(challenge)
    db.commit()
    from .integrity import request_hash
    return {**challenge_view(challenge), "integrity_request_hash": request_hash("checkin",
        checkin_payload(user.id, body.device_id, challenge.id, challenge.nonce, body.qr, body.face_verified))}


@router.post("/check-ins")
def checkin(body: CheckIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    device = device_for(db, user, body.device_id)
    qr_bytes = qr_ascii(body.qr)
    challenge = db.get(DeviceChallenge, body.challenge_id)
    if challenge is None or challenge.purpose != "checkin" or challenge.student_id != user.id or challenge.device_id != device.id or challenge.qr_digest != hashlib.sha256(qr_bytes).hexdigest():
        raise HTTPException(409, "Check-in challenge does not match")
    from .face import require_face
    require_face(db, user, body.face_verified)
    canonical = checkin_payload(user.id, device.id, challenge.id, challenge.nonce, body.qr, body.face_verified)
    key, _ = public_key(device.public_key)
    verify_device_signature(key, canonical, body.signature)
    request_digest = hashlib.sha256((canonical + "|" + body.signature).encode("utf-8")).hexdigest()
    if challenge.used_at is not None:
        row = db.get(Attendance, (challenge.session_id, user.id))
        if challenge.request_digest == request_digest and row is not None:
            return {"status": row.status, "method": row.method, "duplicate": True, "session_id": row.session_id}
        raise HTTPException(409, "Check-in challenge already used")
    now = now_utc()
    payload = verify_qr(body.qr, now)
    if utc(challenge.expires_at) <= now or payload["sid"] != challenge.session_id:
        raise HTTPException(410, "Check-in challenge expired")
    # Ending the session and check-in both lock this row; an ended session cannot accept a new check-in.
    session = db.scalar(select(ClassSession).where(ClassSession.id == challenge.session_id).with_for_update())
    enrolled_session(db, user, session.id)
    active(session, now)
    if payload["cid"] != session.course_id or payload["start"] != int(utc(session.started_at).timestamp()):
        raise HTTPException(422, "QR challenge does not match this session")
    from .integrity import verify_integrity
    verify_integrity(db, "checkin", canonical, body.integrity_token)
    claimed = db.execute(update(DeviceChallenge).where(DeviceChallenge.id == challenge.id, DeviceChallenge.used_at.is_(None), DeviceChallenge.expires_at > now).values(used_at=now, request_digest=request_digest).execution_options(synchronize_session=False)).rowcount
    if claimed != 1:
        db.rollback()
        current = db.get(DeviceChallenge, challenge.id)
        row = db.get(Attendance, (current.session_id, user.id)) if current else None
        if current is not None and current.request_digest == request_digest and row is not None:
            return {"status": row.status, "method": row.method, "duplicate": True, "session_id": row.session_id}
        raise HTTPException(409, "Check-in challenge already used")
    row = db.get(Attendance, (session.id, user.id))
    if row is not None:
        if body.face_verified and row.method == "qr":
            row.face_verified = True  # a rejoin scan that passed the face check
        db.commit()
        return {"status": row.status, "method": row.method, "duplicate": True, "session_id": session.id}
    db.add(Attendance(session_id=session.id, student_id=user.id, course_id=session.course_id, status="present", method="qr", face_verified=body.face_verified, confirmed_by=None, updated_at=now))
    db.add(AttendanceEvent(session_id=session.id, student_id=user.id, actor_id=user.id, action="qr_checkin", previous_status=None, new_status="present", reason="Focus disclosure v1 accepted before QR submission" + ("; on-device face match claimed" if body.face_verified else ""), recorded_at=now))
    pending = db.scalar(select(PendingAttendance).where(PendingAttendance.session_id == session.id, PendingAttendance.student_id == user.id, PendingAttendance.resolved_at.is_(None)))
    if pending:
        pending.resolved_at = now
        pending.resolved_by = user.id
    db.commit()
    return {"status": "present", "method": "qr", "duplicate": False, "session_id": session.id}


@router.post("/sessions/{session_id}/pending")
def pending(session_id: int, body: PendingRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    session = enrolled_session(db, user, session_id)
    if utc(session.starts_at) > now_utc():
        raise HTTPException(409, "Session has not started")
    reason = body.reason.strip()
    if len(reason) < 10:
        raise HTTPException(422, "A reason of at least 10 characters is required")
    if db.get(Attendance, (session_id, user.id)):
        raise HTTPException(409, "Attendance already recorded")
    existing = db.scalar(select(PendingAttendance).where(PendingAttendance.session_id == session.id, PendingAttendance.student_id == user.id))
    if existing is None:
        existing = PendingAttendance(session_id=session.id, student_id=user.id, reason=reason, created_at=now_utc())
        db.add(existing)
    elif existing.resolved_at is not None:
        raise HTTPException(409, "Request has already been reviewed")
    db.commit()
    return {"session_id": session.id, "state": "pending_teacher_review"}


@router.get("/sessions/{session_id}/pending")
def pending_list(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    assigned_session(db, user, session_id)
    return [{"student_id": p.student_id, "reason": p.reason, "created_at": utc(p.created_at)} for p in db.scalars(select(PendingAttendance).where(PendingAttendance.session_id == session_id, PendingAttendance.resolved_at.is_(None)))]


@router.get("/sessions/{session_id}/audit")
def audit(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    assigned_session(db, user, session_id)
    return [{"id": e.id, "student_id": e.student_id, "actor_id": e.actor_id, "action": e.action, "previous_status": e.previous_status, "new_status": e.new_status, "reason": e.reason, "recorded_at": utc(e.recorded_at)} for e in db.scalars(select(AttendanceEvent).where(AttendanceEvent.session_id == session_id).order_by(AttendanceEvent.id))]
