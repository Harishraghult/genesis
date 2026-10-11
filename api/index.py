import sys
import os

# Ensure backend directory is in python search path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi import FastAPI
from app.main import app as focuslock_api

# Entrypoint for Vercel Serverless Function
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# Mount at /api for requests routed with the /api prefix
app.mount("/api", focuslock_api)

# Mount at root for cases where the rewrite route strips /api
app.mount("/", focuslock_api)
