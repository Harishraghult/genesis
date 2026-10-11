import os
import tempfile
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import settings


class Base(DeclarativeBase):
    pass


def normalize_url(url: str) -> str:
    # Managed providers (Neon, Vercel Postgres) hand out postgres:// or postgresql:// URLs; use the psycopg 3 driver.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


# Alembic head; /health/ready and mock-data mode both check against it.
SCHEMA_REVISION = "0009"


def database_url() -> str:
    cfg = settings()
    if cfg.database_url:
        return normalize_url(cfg.database_url)
    if cfg.mock_data:
        # Throwaway demo database in the writable temp dir (/tmp on Vercel); rebuilt and reseeded on startup.
        return "sqlite:///" + os.path.join(tempfile.gettempdir(), "focuslock-mock.db").replace("\\", "/")
    return "sqlite:///./focuslock.db"


db_url = database_url()
connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
engine = create_engine(db_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as db:
        yield db
