"""Allowlisted course files and voluntary focus; no server-side URL fetching."""
import hashlib
import json
import re
from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import current_user, teacher, utc
from .config import settings
from .db import get_db
from .models import AdminAudit, CourseResource, FocusEvent, User
from .qr_security import b64, unb64
from .stage2 import assigned_session, enrolled_session, now_utc, student_only

router = APIRouter()
ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ResourceInput(Strict):
    title: str = Field(min_length=1, max_length=150)
    url: str = Field(min_length=1, max_length=2048)
    kind: str = Field(pattern="^(pdf|text)$")
    downloadable: bool = False


class EventInput(Strict):
    id: UUID
    policy: str = Field(max_length=2048)
    action: str = Field(pattern="^(started|paused|resumed|exited|expired|backgrounded)$")


def allowed_hosts() -> set[str]:
    hosts = {h.strip().lower() for h in settings().resource_allowed_hosts.split(",") if h.strip()}
    if any(not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", h) for h in hosts):
        raise HTTPException(503, "Invalid resource host configuration")
    return hosts


def validate_resource_url(value: str) -> str:
    if any(ord(ch) < 33 or ord(ch) == 127 for ch in value) or "\\" in value:
        raise HTTPException(422, "Invalid resource URL")
    try:
        url = urlsplit(value)
        host = url.hostname
        if (url.scheme != "https" or not host or host != host.lower() or host not in allowed_hosts() or
                url.username or url.password or url.fragment or url.port not in (None, 443) or
                not url.path.startswith("/") or url.netloc.lower() not in (host, f"{host}:443")):
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Only HTTPS URLs on configured course hosts are allowed")
    return value


def resource_view(row):
    return {"id": row.id, "session_id": row.session_id, "title": row.title, "url": row.url,
            "kind": row.kind, "downloadable": row.downloadable}


@router.get("/sessions/{session_id}/resources")
def resources(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    (assigned_session if user.role == "teacher" else enrolled_session)(db, user, session_id)
    return [resource_view(row) for row in db.scalars(select(CourseResource).where(CourseResource.session_id == session_id).order_by(CourseResource.id))]


@router.post("/sessions/{session_id}/resources", status_code=201)
def add_resource(session_id: int, body: ResourceInput, user: User = Depends(teacher), db: Session = Depends(get_db)):
    session = assigned_session(db, user, session_id)
    if session.state == "ended":
        raise HTTPException(409, "Session has ended")
    row = CourseResource(session_id=session_id, title=body.title.strip(), url=validate_resource_url(body.url),
                         kind=body.kind, downloadable=body.downloadable, created_by=user.id, created_at=now_utc())
    db.add(row)
    db.flush()
    db.add(AdminAudit(actor_id=user.id, action="resource_attached", target_type="resource", target_id=str(row.id),
                      reason="Teacher attached an authorized course resource", recorded_at=now_utc()))
    db.commit()
    db.refresh(row)
    return resource_view(row)


@router.delete("/sessions/{session_id}/resources/{resource_id}", status_code=204)
def remove_resource(session_id: int, resource_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    assigned_session(db, user, session_id)
    row = db.get(CourseResource, resource_id)
    if row is None or row.session_id != session_id:
        raise HTTPException(404, "Resource not found")
    db.delete(row)
    db.add(AdminAudit(actor_id=user.id, action="resource_removed", target_type="resource", target_id=str(resource_id),
                      reason="Teacher removed a course resource", recorded_at=now_utc()))
    db.commit()
    return Response(status_code=204)


def transition(session_id: int, expected: str, target: str, user: User, db: Session):
    session = assigned_session(db, user, session_id, lock=True)
    if session.state == target:
        return {"state": target}
    if session.state != expected or utc(session.ends_at) <= now_utc():
        raise HTTPException(409, "Session transition unavailable")
    session.state = target
    db.add(AdminAudit(actor_id=user.id, action="session_state", target_type="session", target_id=str(session_id),
                      reason=f"{expected} to {target}", recorded_at=now_utc()))
    db.commit()
    return {"state": target}


@router.post("/sessions/{session_id}/activate")
def activate(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    return transition(session_id, "checkin_pending", "active", user, db)


@router.post("/sessions/{session_id}/pause")
def pause(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    return transition(session_id, "active", "paused", user, db)


@router.post("/sessions/{session_id}/resume")
def resume(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    return transition(session_id, "paused", "active", user, db)


def signing_key():
    secret = settings().policy_signing_key.encode()
    if len(secret) < 32:
        raise HTTPException(503, "Session policy signing key is not configured")
    return ec.derive_private_key(int.from_bytes(hashlib.sha256(secret).digest(), "big") % (ORDER - 1) + 1, ec.SECP256R1())


def sign_policy(payload: dict) -> tuple[str, str]:
    key = signing_key()
    encoded = b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = b64(key.sign(encoded.encode(), ec.ECDSA(hashes.SHA256())))
    public = b64(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    return f"FP3.{encoded}.{signature}", public


def verify_policy(token: str, student_id: int, session_id: int, now: datetime) -> dict:
    try:
        prefix, encoded, signature = token.split(".")
        if prefix != "FP3" or len(token) > 2048:
            raise ValueError()
        signing_key().public_key().verify(unb64(signature, 512), encoded.encode(), ec.ECDSA(hashes.SHA256()))
        payload = json.loads(unb64(encoded, 1200))
        if (set(payload) != {"v", "sid", "uid", "cid", "iat", "exp", "max", "nonce"} or payload["v"] != 3 or
                payload["sid"] != session_id or payload["uid"] != student_id or
                not isinstance(payload["nonce"], str) or not re.fullmatch(r"[0-9a-f-]{36}", payload["nonce"]) or
                any(type(payload[key]) is not int for key in ("sid", "uid", "cid", "iat", "exp", "max")) or
                payload["max"] < 1 or payload["max"] > 2700 or payload["exp"] <= payload["iat"] or
                payload["exp"] > payload["iat"] + payload["max"] or
                not payload["iat"] <= int(now.timestamp()) < payload["exp"]):
            raise ValueError()
        return payload
    except Exception:
        raise HTTPException(422, "Invalid or expired session policy")


@router.get("/sessions/{session_id}/focus-policy")
def focus_policy(session_id: int, nonce: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    session = enrolled_session(db, user, session_id)
    now = now_utc()
    if session.state != "active" or utc(session.ends_at) <= now:
        raise HTTPException(409, "Focus participation is unavailable")
    issued = int(now.timestamp())
    expiry = min(int(utc(session.ends_at).timestamp()), issued + 2700)
    if expiry <= issued:
        raise HTTPException(409, "Session has expired")
    policy, public = sign_policy({"v": 3, "sid": session.id, "uid": user.id, "cid": session.course_id, "nonce": str(nonce),
                                  "iat": issued, "exp": expiry, "max": 2700})
    return {"policy": policy, "public_key": public}


@router.post("/sessions/{session_id}/focus-events", status_code=201)
def record_event(session_id: int, body: EventInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    session = enrolled_session(db, user, session_id)
    existing = db.get(FocusEvent, str(body.id))
    if existing is not None:
        if existing.session_id == session_id and existing.student_id == user.id and existing.action == body.action:
            return {"recorded": True, "duplicate": True}
        raise HTTPException(409, "Event ID already used")
    payload = verify_policy(body.policy, user.id, session_id, now_utc())
    if payload["cid"] != session.course_id:
        raise HTTPException(422, "Policy course mismatch")
    if body.action == "backgrounded":
        if session.state != "active" or utc(session.ends_at) <= now_utc():
            raise HTTPException(409, "Session is not active")
        from .stage6 import rate_limit
        rate_limit(db, "focus-backgrounded", f"{user.id}:{session_id}", 6, 60)
    db.add(FocusEvent(id=str(body.id), session_id=session_id, student_id=user.id, action=body.action, recorded_at=now_utc()))
    db.commit()
    return {"recorded": True, "duplicate": False}


@router.get("/sessions/{session_id}/focus-events")
def list_events(session_id: int, user: User = Depends(teacher), db: Session = Depends(get_db)):
    assigned_session(db, user, session_id)
    return [{"id": e.id, "student_id": e.student_id, "action": e.action, "recorded_at": utc(e.recorded_at)} for e in
            db.scalars(select(FocusEvent).where(FocusEvent.session_id == session_id).order_by(FocusEvent.recorded_at))]
