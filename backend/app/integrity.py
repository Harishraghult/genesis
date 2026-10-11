"""Request-bound Play Integrity verification; no local verdict is trusted."""
import base64
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .config import settings
from .models import IntegrityReceipt


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def request_hash(action: str, canonical: str) -> str:
    return b64(hashlib.sha256(f"FL-INTEGRITY1\n{action}\n{canonical}".encode("utf-8")).digest())


def decode_google_token(token: str) -> dict:
    cfg = settings()
    if not (cfg.play_integrity_service_account_file or cfg.play_integrity_service_account_json) or not cfg.play_integrity_package:
        raise HTTPException(503, "Play Integrity credentials are not configured")
    try:
        account = json.loads(cfg.play_integrity_service_account_json or
            Path(cfg.play_integrity_service_account_file).read_text(encoding="utf-8"))
        if account.get("type") != "service_account" or not account.get("client_email"):
            raise ValueError("Invalid service account")
        now = int(time.time())
        header = b64(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
        claims = b64(json.dumps({"iss": account["client_email"], "scope": "https://www.googleapis.com/auth/playintegrity",
            "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 300}, separators=(",", ":")).encode())
        unsigned = f"{header}.{claims}".encode("ascii")
        key = serialization.load_pem_private_key(account["private_key"].encode(), password=None)
        assertion = f"{unsigned.decode()}.{b64(key.sign(unsigned, padding.PKCS1v15(), hashes.SHA256()))}"
        with httpx.Client(timeout=8, follow_redirects=False) as client:
            oauth = client.post("https://oauth2.googleapis.com/token", data={"grant_type":
                "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
            oauth.raise_for_status()
            access = oauth.json()["access_token"]
            response = client.post(f"https://playintegrity.googleapis.com/v1/{cfg.play_integrity_package}:decodeIntegrityToken",
                headers={"Authorization": f"Bearer {access}"}, json={"integrity_token": token})
            response.raise_for_status()
            return response.json()["tokenPayloadExternal"]
    except (OSError, ValueError, KeyError, httpx.HTTPError) as exc:
        raise HTTPException(503, "Play Integrity verification unavailable") from exc


def verify_integrity(db: Session, action: str, canonical: str, token: str | None):
    cfg = settings()
    if cfg.play_integrity_mode not in ("off", "optional", "required"):
        raise HTTPException(503, "Invalid Play Integrity configuration")
    if cfg.play_integrity_mode == "off":
        return "disabled"
    if not token:
        if cfg.play_integrity_mode == "required":
            raise HTTPException(403, "Integrity unavailable; request teacher-confirmed attendance")
        return "unsupported"
    if len(token) > 8192:
        raise HTTPException(422, "Integrity token is too long")
    token_digest = hashlib.sha256(token.encode()).hexdigest()
    if db.get(IntegrityReceipt, token_digest) is not None:
        raise HTTPException(409, "Integrity token already used")
    payload = decode_google_token(token)
    details = payload.get("requestDetails", {})
    recognition = payload.get("appIntegrity", {}).get("appRecognitionVerdict")
    device_verdict = payload.get("deviceIntegrity", {}).get("deviceRecognitionVerdict", [])
    expected = request_hash(action, canonical)
    try:
        issued_ms = int(details["timestampMillis"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(403, "Invalid Integrity timestamp") from exc
    age = time.time() * 1000 - issued_ms
    if (details.get("requestPackageName") != cfg.play_integrity_package or
            details.get("requestHash") != expected or not 0 <= age <= 120_000 or
            recognition != "PLAY_RECOGNIZED" or "MEETS_DEVICE_INTEGRITY" not in device_verdict):
        raise HTTPException(403, "Integrity verdict or request binding failed")
    db.add(IntegrityReceipt(token_digest=token_digest, request_hash=hashlib.sha256(expected.encode()).hexdigest(),
                            verified_at=datetime.now(timezone.utc)))
    return "verified"
