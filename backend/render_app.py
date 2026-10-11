"""Single-service hosting (Render): the built dashboard at / and the API at the same-origin /api path."""
import mimetypes
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.main import app as focuslock_api

# The face check loads a JavaScript module (.mjs) and WebAssembly; with nosniff they need exact types.
for _type, _ext in (("text/javascript", ".mjs"), ("application/wasm", ".wasm"), ("application/manifest+json", ".webmanifest")):
    mimetypes.add_type(_type, _ext)

STATIC = Path(os.environ.get("DASHBOARD_DIST", Path(__file__).parent / "static")).resolve()

# Mirrors dashboard/nginx.conf, plus HSTS because Render terminates HTTPS. camera=(self) lets the student page scan QR codes.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), bluetooth=(), usb=(), payment=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data:; "
                               "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


app.mount("/api", focuslock_api)
app.mount("/assets", StaticFiles(directory=STATIC / "assets", check_dir=False), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def dashboard(path: str):
    candidate = (STATIC / path).resolve()
    if path and candidate.is_file() and candidate.is_relative_to(STATIC):
        return FileResponse(candidate)
    return FileResponse(STATIC / "index.html")
