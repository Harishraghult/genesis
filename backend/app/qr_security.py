"""Versioned, byte-exact QR and Android Keystore signature protocol."""
import base64
import binascii
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from fastapi import HTTPException
from cryptography.exceptions import InvalidSignature, UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from .config import settings


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def unb64(value: str, max_length: int = 2048) -> bytes:
    if len(value) > max_length or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise HTTPException(422, "Invalid encoded value")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, binascii.Error):
        raise HTTPException(422, "Invalid encoded value")


def qr_key() -> bytes:
    key = settings().qr_signing_key.encode("utf-8")
    if len(key) < 32:
        raise HTTPException(503, "QR signing key is not configured")
    return key


def qr_token(session_id: int, course_id: int, started_at: datetime, ends_at: datetime, now: datetime) -> tuple[str, int]:
    slot = int(now.timestamp()) // 20 * 20
    expiry = min(slot + 30, int(ends_at.timestamp()))
    payload = {"v": 2, "sid": session_id, "cid": course_id, "iat": slot, "exp": expiry, "start": int(started_at.timestamp())}
    encoded = b64(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    signature = b64(hmac.new(qr_key(), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"FL2.{encoded}.{signature}", expiry


def qr_ascii(token: str) -> bytes:
    if len(token) > 1024 or not re.fullmatch(r"FL2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token):
        raise HTTPException(422, "Invalid QR challenge")
    return token.encode("ascii")


def verify_qr(token: str, now: datetime) -> dict:
    qr_ascii(token)
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != "FL2":
        raise HTTPException(422, "Invalid QR challenge")
    encoded, signature = parts[1:]
    expected = b64(hmac.new(qr_key(), encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(422, "Invalid QR signature")
    try:
        payload = json.loads(unb64(encoded, 800))
        if set(payload) != {"v", "sid", "cid", "iat", "exp", "start"} or payload["v"] != 2:
            raise ValueError()
        if any(type(payload[name]) is not int for name in ("sid", "cid", "iat", "exp", "start")):
            raise ValueError()
        if payload["exp"] <= payload["iat"] or payload["exp"] > payload["iat"] + 30:
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise HTTPException(422, "Invalid QR challenge")
    if int(now.timestamp()) >= payload["exp"]:
        raise HTTPException(410, "QR challenge expired; scan the current code")
    if payload["iat"] > int(now.timestamp()) + 2:
        raise HTTPException(422, "Invalid QR challenge")
    return payload


def public_key(encoded: str):
    try:
        raw = unb64(encoded, 1024)
        key = serialization.load_der_public_key(raw)
        if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
            raise ValueError()
        if key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) != raw:
            raise ValueError()
        return key, hashlib.sha256(raw).hexdigest()
    except (ValueError, TypeError, UnsupportedAlgorithm):
        raise HTTPException(422, "P-256 public key required")


def verify_device_signature(key, payload: str, signature: str):
    try:
        key.verify(unb64(signature, 256), payload.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError):
        raise HTTPException(401, "Invalid device signature")


def register_payload(student_id: int, challenge_id: str, nonce: str) -> str:
    return f"FL2|register|{student_id}|{challenge_id}|{nonce}"


def checkin_payload(student_id: int, device_id: str, challenge_id: str, nonce: str, qr: str, face_verified: bool = False) -> str:
    base = f"FL2|checkin|{student_id}|{device_id}|{challenge_id}|{nonce}|{hashlib.sha256(qr.encode('ascii')).hexdigest()}|focus-disclosure-v1|accepted"
    return base + "|face-match-v1" if face_verified else base
