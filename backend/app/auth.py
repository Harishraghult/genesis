import hashlib
from datetime import datetime, timezone
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from sqlalchemy import select
from .config import settings
from .db import get_db
from .models import DevToken, User

bearer = HTTPBearer(auto_error=False)


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if credentials is None:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    if not settings().dev_auth_enabled:
        from .oidc import verify_access_token
        subject = verify_access_token(credentials.credentials)
        user = db.scalar(select(User).where(User.oidc_subject == subject, User.is_demo.is_(False)))
        if user is None:
            raise HTTPException(403, "College account has not been provisioned")
        return user
    token = db.get(DevToken, digest(credentials.credentials))
    if token is None or utc(token.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(401, "Invalid or expired session")
    user = db.get(User, token.user_id)
    if user is None or not user.is_demo:
        raise HTTPException(401, "Invalid account")
    return user


def teacher(user: User = Depends(current_user)) -> User:
    if user.role != "teacher":
        raise HTTPException(403, "Teacher role required")
    return user


def admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Administrator role required")
    return user
