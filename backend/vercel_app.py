"""Mount the existing API at the Vercel project's same-origin /api path."""
from fastapi import FastAPI
from app.main import app as focuslock_api

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", focuslock_api)
