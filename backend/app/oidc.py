"""Verify college-issued RS256 access tokens. Roles are assigned only in our DB."""
import base64
import json
import time
from functools import lru_cache

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import HTTPException

from .config import settings


def decode64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@lru_cache(maxsize=4)
def jwks(url: str, bucket: int) -> dict:
    try:
        with httpx.Client(timeout=5, follow_redirects=False) as client:
            response = client.get(url)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data.get("keys"), list) or len(data["keys"]) > 100:
            raise ValueError("Invalid key set")
        return data
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(503, "Identity provider keys unavailable") from exc


def verify_access_token(token: str) -> str:
    cfg = settings()
    if not cfg.oidc_configured:
        raise HTTPException(503, "College authentication is not configured")
    try:
        if len(token) > 8192:
            raise ValueError("Token too long")
        header64, payload64, signature64 = token.split(".")
        header = json.loads(decode64(header64))
        claims = json.loads(decode64(payload64))
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise ValueError("Unexpected signing algorithm")
        keys = [key for key in jwks(cfg.oidc_jwks_url, int(time.time() // 300))["keys"]
                if key.get("kid") == header["kid"] and key.get("kty") == "RSA" and key.get("use", "sig") == "sig"]
        if len(keys) != 1:
            raise ValueError("Signing key not found")
        key = keys[0]
        public = rsa.RSAPublicNumbers(int.from_bytes(decode64(key["e"]), "big"),
                                      int.from_bytes(decode64(key["n"]), "big")).public_key()
        public.verify(decode64(signature64), f"{header64}.{payload64}".encode("ascii"), padding.PKCS1v15(), hashes.SHA256())
        now = time.time()
        audience = claims.get("aud")
        if (claims.get("iss") != cfg.oidc_issuer or
                (cfg.oidc_audience not in audience if isinstance(audience, list) else audience != cfg.oidc_audience) or
                not isinstance(claims.get("exp"), (int, float)) or claims["exp"] <= now or
                not isinstance(claims.get("iat"), (int, float)) or claims["iat"] > now + 60 or
                ("nbf" in claims and claims["nbf"] > now + 60) or
                not isinstance(claims.get("sub"), str) or not claims["sub"] or len(claims["sub"]) > 255):
            raise ValueError("Invalid access token claims")
        return claims["sub"]
    except (ValueError, KeyError, TypeError, UnicodeError, InvalidSignature) as exc:
        raise HTTPException(401, "Invalid college access token") from exc
