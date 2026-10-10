import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from .security import verify_request_signature
from .config import settings

class SignedRequestGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only enforce on /api/course-portal/* endpoints
        if request.url.path.startswith("/api/course-portal"):
            session_id = request.headers.get("X-FL-Session")
            ts = request.headers.get("X-FL-Ts")
            nonce = request.headers.get("X-FL-Nonce")
            sig = request.headers.get("X-FL-Sig")
            
            if not all([session_id, ts, nonce, sig]):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Forbidden: Missing required FocusLock security headers (X-FL-Session, X-FL-Ts, X-FL-Nonce, X-FL-Sig)"}
                )
            
            # Check timestamp freshness (within 30 seconds)
            try:
                ts_int = int(ts)
                now = int(time.time())
                if abs(now - ts_int) > settings.SIG_MAX_SKEW_SECONDS:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Forbidden: Stale signature timestamp (exceeded 30s skew window)"}
                    )
            except ValueError:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Forbidden: Malformed timestamp header"}
                )
            
            # Reconstruct exact path + query for verification
            path = request.url.path
            if request.url.query:
                path = f"{path}?{request.url.query}"
            
            # Verify signature using shared session secret
            if not verify_request_signature(settings.SESSION_SECRET, ts, nonce, path, sig):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Forbidden: Cryptographic signature verification failed"}
                )
        
        return await call_next(request)
