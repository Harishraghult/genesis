"""Privacy controls and restricted administration."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update, text
from sqlalchemy.orm import Session

from .auth import admin, current_user, digest, teacher, utc
from .db import get_db
from .models import (AdminAudit, BleCredential, BleReceiver, ClassSession, CourseOffering, DataRequest, Device,
                     DeviceChallenge, Enrollment, OptionalConsent, RateAttempt, User)
from .qr_security import public_key, verify_device_signature
from .stage2 import device_for, now_utc, student_only

router = APIRouter()


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConsentInput(Strict):
    disclosure_version: str = Field(min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9._-]+$")


class RequestInput(Strict):
    kind: Literal["correction", "deletion"]
    session_id: int | None = None
    reason: str = Field(min_length=10, max_length=500)


class DecisionInput(Strict):
    status: Literal["accepted", "declined"]
    resolution: str = Field(min_length=10, max_length=500)


class ReceiverInput(Strict):
    course_id: int
    room_code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    reason: str = Field(min_length=10, max_length=500)


class ProvisionInput(Strict):
    oidc_subject: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=100)
    role: Literal["student", "teacher", "admin"]
    reason: str = Field(min_length=10, max_length=500)


class ReasonInput(Strict):
    reason: str = Field(min_length=10, max_length=500)


class ReplacementInput(Strict):
    challenge_id: str = Field(max_length=36)
    public_key: str = Field(max_length=1024)
    old_signature: str = Field(max_length=256)
    new_signature: str = Field(max_length=256)


class OidcExchange(Strict):
    client: Literal["dashboard", "android"]
    code: str = Field(min_length=8, max_length=4096)
    verifier: str = Field(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9._~-]+$")


def rate_limit(db: Session, scope: str, identity: str, max_attempts: int, seconds: int = 60):
    """Shared DB-backed fixed window, keyed only by a digest. Caller commits the attempt."""
    now = now_utc()
    bucket = int(now.timestamp()) // seconds
    key = hashlib.sha256(f"{scope}:{identity}:{bucket}".encode()).hexdigest()
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"),
                   {"lock_key": int.from_bytes(bytes.fromhex(key[:16]), "big", signed=True)})
    count = db.scalar(select(func.count()).select_from(RateAttempt).where(RateAttempt.key_digest == key))
    if count >= max_attempts:
        raise HTTPException(429, "Too many requests; try again later")
    db.add(RateAttempt(key_digest=key, occurred_at=now))


@router.post("/auth/oidc/exchange")
def oidc_exchange(body: OidcExchange, request: Request, db: Session = Depends(get_db)):
    import httpx
    from .config import settings
    from .oidc import verify_access_token
    cfg = settings()
    if cfg.dev_auth_enabled or not cfg.oidc_configured or not cfg.oidc_token_endpoint.startswith("https://"):
        raise HTTPException(503, "College sign-in is unavailable")
    client_id = cfg.oidc_dashboard_client_id if body.client == "dashboard" else cfg.oidc_android_client_id
    redirect = cfg.oidc_dashboard_redirect_uri if body.client == "dashboard" else cfg.oidc_android_redirect_uri
    if not client_id or (body.client == "dashboard" and not redirect.startswith("https://")) or (body.client == "android" and redirect != "focuslock://oidc/callback"):
        raise HTTPException(503, "College client is not configured")
    rate_limit(db, "oidc-exchange", request.client.host if request.client else "unknown", 20, 300)
    db.commit()
    try:
        with httpx.Client(timeout=8, follow_redirects=False) as client:
            result = client.post(cfg.oidc_token_endpoint, data={"grant_type": "authorization_code", "code": body.code,
                "redirect_uri": redirect, "client_id": client_id, "code_verifier": body.verifier})
            result.raise_for_status()
            token = result.json()["access_token"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(401, "College sign-in could not be completed") from exc
    subject = verify_access_token(token)
    user = db.scalar(select(User).where(User.oidc_subject == subject, User.is_demo.is_(False)))
    if user is None:
        raise HTTPException(403, "College account has not been provisioned")
    if body.client == "dashboard" and user.role != "teacher":
        raise HTTPException(403, "Teacher role required")
    if body.client == "android" and user.role != "student":
        raise HTTPException(403, "Student role required")
    return {"access_token": token, "token_type": "bearer",
            "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}


@router.get("/privacy/consents")
def consents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    return [{"feature": c.feature, "disclosure_version": c.disclosure_version,
             "granted_at": utc(c.granted_at), "withdrawn_at": utc(c.withdrawn_at) if c.withdrawn_at else None}
            for c in db.scalars(select(OptionalConsent).where(OptionalConsent.student_id == user.id))]


@router.put("/privacy/consents/{feature}")
def grant_consent(feature: Literal["vpn", "bluetooth"], body: ConsentInput,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    rate_limit(db, "consent", str(user.id), 20)
    row = db.get(OptionalConsent, (user.id, feature))
    if row is None:
        row = OptionalConsent(student_id=user.id, feature=feature)
        db.add(row)
    row.disclosure_version = body.disclosure_version
    row.granted_at = now_utc()
    row.withdrawn_at = None
    db.commit()
    return {"feature": feature, "granted": True}


@router.delete("/privacy/consents/{feature}")
def withdraw_consent(feature: Literal["vpn", "bluetooth"], user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    now = now_utc()
    row = db.get(OptionalConsent, (user.id, feature))
    if row is not None and row.withdrawn_at is None:
        row.withdrawn_at = now
    if feature == "bluetooth":
        db.execute(update(BleCredential).where(BleCredential.student_id == user.id,
            BleCredential.expires_at > now).values(expires_at=now))
    db.commit()
    return {"feature": feature, "granted": False}


@router.post("/privacy/requests", status_code=201)
def create_data_request(body: RequestInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    rate_limit(db, "data-request", str(user.id), 5, 3600)
    if body.session_id is not None:
        session = db.get(ClassSession, body.session_id)
        if session is None or db.get(Enrollment, (session.course_id, user.id)) is None:
            raise HTTPException(404, "Session not found")
    row = DataRequest(student_id=user.id, session_id=body.session_id, kind=body.kind,
                      reason=body.reason.strip(), status="pending", created_at=now_utc())
    db.add(row)
    db.commit()
    return {"id": row.id, "status": row.status}


@router.get("/privacy/requests")
def own_requests(user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    return [{"id": r.id, "session_id": r.session_id, "kind": r.kind, "reason": r.reason,
             "status": r.status, "resolution": r.resolution}
            for r in db.scalars(select(DataRequest).where(DataRequest.student_id == user.id).order_by(DataRequest.id.desc()))]


@router.get("/teacher/privacy/requests")
def teacher_requests(user: User = Depends(teacher), db: Session = Depends(get_db)):
    query = select(DataRequest).join(ClassSession,
        DataRequest.session_id == ClassSession.id).join(CourseOffering).where(
        CourseOffering.teacher_id == user.id, DataRequest.status == "pending")
    return [{"id": r.id, "student_id": r.student_id, "session_id": r.session_id, "kind": r.kind, "reason": r.reason}
            for r in db.scalars(query)]


@router.put("/teacher/privacy/requests/{request_id}")
def review_request(request_id: int, body: DecisionInput, user: User = Depends(teacher), db: Session = Depends(get_db)):
    row = db.get(DataRequest, request_id)
    session = db.get(ClassSession, row.session_id) if row and row.session_id else None
    if session is None or db.get(CourseOffering, session.course_id).teacher_id != user.id:
        raise HTTPException(404, "Request not found")
    if row.status != "pending":
        raise HTTPException(409, "Request already reviewed")
    row.status, row.resolution, row.reviewed_by, row.reviewed_at = body.status, body.resolution.strip(), user.id, now_utc()
    db.add(AdminAudit(actor_id=user.id, action="privacy_request_review", target_type="data_request",
                      target_id=str(row.id), reason=body.resolution.strip(), recorded_at=row.reviewed_at))
    db.commit()
    return {"id": row.id, "status": row.status}


@router.post("/admin/receivers", status_code=201)
def add_receiver(body: ReceiverInput, user: User = Depends(admin), db: Session = Depends(get_db)):
    if db.get(CourseOffering, body.course_id) is None:
        raise HTTPException(404, "Course not found")
    token = secrets.token_urlsafe(32)
    row = BleReceiver(id=str(uuid4()), course_id=body.course_id, room_code=body.room_code,
                      token_digest=digest(token), active=True)
    db.add(row)
    db.add(AdminAudit(actor_id=user.id, action="receiver_created", target_type="receiver", target_id=row.id,
                      reason=body.reason.strip(), recorded_at=now_utc()))
    db.commit()
    return {"receiver_id": row.id, "token": token}  # Shown once; digest only is persisted.


@router.post("/admin/receivers/{receiver_id}/revoke")
def revoke_receiver(receiver_id: str, body: DecisionInput, user: User = Depends(admin), db: Session = Depends(get_db)):
    row = db.get(BleReceiver, receiver_id)
    if row is None:
        raise HTTPException(404, "Receiver not found")
    row.active = False
    db.add(AdminAudit(actor_id=user.id, action="receiver_revoked", target_type="receiver", target_id=row.id,
                      reason=body.resolution.strip(), recorded_at=now_utc()))
    db.commit()
    return {"revoked": True}


@router.get("/admin/audit")
def admin_audit(user: User = Depends(admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(AdminAudit).order_by(AdminAudit.id.desc()).limit(100))
    return [{"id": r.id, "actor_id": r.actor_id, "action": r.action, "target_type": r.target_type,
             "target_id": r.target_id, "reason": r.reason, "recorded_at": utc(r.recorded_at)} for r in rows]


@router.post("/admin/users", status_code=201)
def provision_user(body: ProvisionInput, user: User = Depends(admin), db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(User.oidc_subject == body.oidc_subject)) is not None or db.scalar(select(User.id).where(User.email == body.email.lower())) is not None:
        raise HTTPException(409, "User already provisioned")
    row = User(oidc_subject=body.oidc_subject, email=body.email.strip().lower(), name=body.name.strip(),
               role=body.role, is_demo=False)
    db.add(row)
    db.flush()
    db.add(AdminAudit(actor_id=user.id, action="user_provisioned", target_type="user", target_id=str(row.id),
                      reason=body.reason.strip(), recorded_at=now_utc()))
    db.commit()
    return {"id": row.id, "role": row.role}


@router.post("/admin/devices/{device_id}/revoke")
def admin_revoke_device(device_id: str, body: ReasonInput, user: User = Depends(admin), db: Session = Depends(get_db)):
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(404, "Device not found")
    if device.revoked_at is None:
        device.revoked_at = now_utc()
        db.add(AdminAudit(actor_id=user.id, action="device_revoked", target_type="device", target_id=device.id,
                          reason=body.reason.strip(), recorded_at=device.revoked_at))
        db.commit()
    return {"revoked": True}


@router.post("/devices/{device_id}/replacement-challenge")
def replacement_challenge(device_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    device_for(db, user, device_id)
    rate_limit(db, "replace", str(user.id), 5, 3600)
    row = DeviceChallenge(id=str(uuid4()), student_id=user.id, purpose="replace", device_id=device_id,
                          nonce=secrets.token_urlsafe(24), expires_at=now_utc() + timedelta(minutes=5))
    db.add(row)
    db.commit()
    return {"challenge_id": row.id, "nonce": row.nonce, "expires_at": utc(row.expires_at)}


@router.post("/devices/replace")
def replace_device(body: ReplacementInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    student_only(user)
    challenge = db.get(DeviceChallenge, body.challenge_id)
    now = now_utc()
    if challenge is None or challenge.student_id != user.id or challenge.purpose != "replace" or challenge.used_at or utc(challenge.expires_at) <= now:
        raise HTTPException(409, "Replacement challenge expired or used")
    old = device_for(db, user, challenge.device_id)
    new_key, fingerprint = public_key(body.public_key)
    if db.scalar(select(Device.id).where(Device.fingerprint == fingerprint)) is not None:
        raise HTTPException(409, "New key is already registered")
    canonical = f"FL-REPLACE1\n{user.id}\n{old.id}\n{challenge.id}\n{challenge.nonce}\n{fingerprint}"
    old_key, _ = public_key(old.public_key)
    verify_device_signature(old_key, canonical, body.old_signature)
    verify_device_signature(new_key, canonical, body.new_signature)
    claimed = db.execute(update(DeviceChallenge).where(DeviceChallenge.id == challenge.id,
        DeviceChallenge.used_at.is_(None), DeviceChallenge.expires_at > now).values(used_at=now).execution_options(synchronize_session=False)).rowcount
    if claimed != 1:
        raise HTTPException(409, "Replacement challenge already used")
    old.revoked_at = now
    new = Device(id=str(uuid4()), student_id=user.id, public_key=body.public_key,
                 fingerprint=fingerprint, registered_at=now)
    db.add(new)
    db.add(AdminAudit(actor_id=user.id, action="device_replaced", target_type="device",
                      target_id=old.id, reason="Old and new device signatures verified", recorded_at=now))
    db.commit()
    return {"device_id": new.id, "replaced_device_id": old.id}
