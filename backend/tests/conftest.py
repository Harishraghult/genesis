import os
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["APP_ENV"] = "development"
os.environ["ENABLE_DEV_AUTH"] = "true"
os.environ["DEV_PASSWORD"] = "test-password"
os.environ["QR_SIGNING_KEY"] = "test-signing-key-with-at-least-32-bytes-of-entropy-placeholder"
os.environ["POLICY_SIGNING_KEY"] = "test-policy-signing-key-with-at-least-32-bytes-of-entropy"
os.environ["RESOURCE_ALLOWED_HOSTS"] = "college.example.edu,docs.college.example.edu"
os.environ["BLE_TOKEN_KEY"] = "test-ble-secret-with-at-least-32-bytes-of-entropy"
os.environ["DEV_RECEIVER_TOKEN"] = "test-receiver-only-token"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.seed import seed


@pytest.fixture
def client():
    settings.cache_clear()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        seed(db)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as test_client:
        test_client.db_factory = factory
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()
    settings.cache_clear()


def login(client, email="student@focuslock.test"):
    response = client.post("/auth/dev-login", json={"email": email, "password": "test-password"})
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["access_token"]}
