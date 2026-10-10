import time
import hmac
import hashlib
import pyotp
from typing import Optional, Tuple
from jose import jwt, JWTError
from .config import settings

# Initialize PyOTP TOTP instance with 15s interval and SHA256 (or standard SHA1 base32)
totp_instance = pyotp.TOTP(
    settings.TOTP_SECRET,
    interval=settings.TOTP_STEP_SECONDS,
    digits=6
)

def get_current_totp() -> Tuple[str, int, int]:
    """
    Returns (totp_token, seconds_remaining, current_timestamp)
    """
    now = int(time.time())
    token = totp_instance.now()
    step = settings.TOTP_STEP_SECONDS
    expires_in = step - (now % step)
    return token, expires_in, now

def verify_totp(token: str) -> bool:
    """
    Validates token against current T_0 or immediate prior T_-1 window.
    """
    now = int(time.time())
    # verify with valid_window=1 allows current and previous 15s window
    return totp_instance.verify(token, for_time=now, valid_window=1)

def create_session_jwt(student_id: str, student_name: str, session_id: str) -> str:
    payload = {
        "sub": student_id,
        "name": student_name,
        "session_id": session_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600 * 4  # 4 hours session validity
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def decode_session_jwt(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None

def compute_request_signature(secret: str, ts: str, nonce: str, path: str) -> str:
    """
    HMAC_SHA256(session_secret, timestamp + nonce + path)
    """
    msg = f"{ts}{nonce}{path}"
    # If secret is hex, convert or use as utf-8 bytes
    key_bytes = bytes.fromhex(secret) if len(secret) == 64 and all(c in "0123456789abcdefABCDEF" for c in secret) else secret.encode("utf-8")
    return hmac.new(key_bytes, msg.encode("utf-8"), hashlib.sha256).hexdigest()

def verify_request_signature(secret: str, ts: str, nonce: str, path: str, sig: str) -> bool:
    expected = compute_request_signature(secret, ts, nonce, path)
    return hmac.compare_digest(expected.lower(), sig.lower())
