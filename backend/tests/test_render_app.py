import importlib

from fastapi.testclient import TestClient


def test_single_service_serves_dashboard_api_and_headers(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<title>dashboard</title>")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path.parent / "secret.txt").write_text("outside")
    monkeypatch.setenv("DASHBOARD_DIST", str(tmp_path))
    import render_app
    render_app = importlib.reload(render_app)
    client = TestClient(render_app.app)

    home = client.get("/")
    assert "dashboard" in home.text and home.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in home.headers["content-security-policy"]
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert "dashboard" in client.get("/sessions/42").text  # client-side route falls back to the app
    assert "outside" not in client.get("/../secret.txt").text
    assert client.get("/api/health/live").json() == {"status": "ok"}
    assert client.get("/api/nope").status_code == 404
