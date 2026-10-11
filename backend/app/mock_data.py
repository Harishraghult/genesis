"""Opt-in MOCK_DATA demo mode: a throwaway SQLite database with the demo fixtures, rebuilt at startup.

For demos and hosting without a database server only. Data does not survive a restart, and separate
server instances (for example several Vercel function instances) do not share it.
"""
from sqlalchemy import text
from .config import settings
from .db import SCHEMA_REVISION, Base, SessionLocal, engine
from . import models  # noqa: F401  (registers every table on Base.metadata)
from .seed import seed


def init_mock_data():
    cfg = settings()
    if cfg.app_env == "production":
        raise RuntimeError("MOCK_DATA is a demo mode and cannot run with APP_ENV=production")
    if not cfg.dev_auth_enabled:
        raise RuntimeError("MOCK_DATA needs APP_ENV=development, ENABLE_DEV_AUTH=true and DEV_PASSWORD for the demo accounts")
    if engine.dialect.name != "sqlite":
        raise RuntimeError("MOCK_DATA only rebuilds its own SQLite file; unset DATABASE_URL")
    # Start fresh each time so seeded class times are current.
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
        connection.execute(text("INSERT INTO alembic_version (version_num) VALUES (:revision)"), {"revision": SCHEMA_REVISION})
    with SessionLocal() as db:
        seed(db)
