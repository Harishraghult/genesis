import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

PROBE = """
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)
assert client.get("/health/ready").json() == {"status": "ready"}
token = client.post("/auth/dev-login", json={"email": "teacher@focuslock.test", "password": "mock-pass"}).json()["access_token"]
courses = client.get("/courses", headers={"Authorization": "Bearer " + token}).json()
assert [c["code"] for c in courses] == ["CS101"], courses
print("mock-ok")
"""


def run(tmp_path, **env):
    base = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "FACE_CHECK_MODE")}
    base.update({"TMP": str(tmp_path), "TEMP": str(tmp_path), "TMPDIR": str(tmp_path), "APP_ENV": "development",
                 "ENABLE_DEV_AUTH": "true", "DEV_PASSWORD": "mock-pass", "MOCK_DATA": "true"})
    base.update(env)
    return subprocess.run([sys.executable, "-c", PROBE], cwd=BACKEND, env=base, capture_output=True, text=True, timeout=120)


def test_mock_data_mode_seeds_a_throwaway_database(tmp_path):
    result = run(tmp_path)
    assert "mock-ok" in result.stdout, result.stderr
    assert (tmp_path / "focuslock-mock.db").exists()
    # A restart rebuilds the demo data instead of failing on the existing file.
    assert "mock-ok" in run(tmp_path).stdout


def test_mock_data_mode_is_refused_in_production(tmp_path):
    result = run(tmp_path, APP_ENV="production")
    assert result.returncode != 0
    assert "cannot run with APP_ENV=production" in result.stderr
