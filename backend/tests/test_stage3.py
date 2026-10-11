from datetime import timedelta
from uuid import uuid4

from app import stage3
from app.qr_security import unb64
from app.models import Attendance, FocusEvent
from conftest import login
import json


def test_resources_are_assigned_and_allowlisted(client):
    teacher = login(client, "teacher@focuslock.test")
    other_teacher = login(client, "teacher2@focuslock.test")
    student = login(client)
    outsider = login(client, "student3@focuslock.test")
    path = "/sessions/1/resources"
    body = {"title": "College notes", "url": "https://docs.college.example.edu/cs101/notes.pdf", "kind": "pdf", "downloadable": True}
    assert client.post(path, headers=student, json=body).status_code == 403
    assert client.post(path, headers=other_teacher, json=body).status_code == 404
    assert client.get(path, headers=outsider).status_code == 404
    for url in ("http://docs.college.example.edu/notes.pdf", "https://evil.example.edu/notes.pdf",
                "https://docs.college.example.edu.evil.test/notes.pdf", "https://user@docs.college.example.edu/notes.pdf",
                "https://docs.college.example.edu:8443/notes.pdf", "https://docs.college.example.edu/notes.pdf#fragment",
                "https://127.0.0.1/notes.pdf", "file:///etc/passwd"):
        assert client.post(path, headers=teacher, json={**body, "url": url}).status_code == 422
    created = client.post(path, headers=teacher, json=body)
    assert created.status_code == 201, created.text
    assert client.get(path, headers=student).json()[0]["title"] == "College notes"
    assert client.delete(f"{path}/{created.json()['id']}", headers=other_teacher).status_code == 404
    assert client.delete(f"{path}/{created.json()['id']}", headers=teacher).status_code == 204


def test_focus_lifecycle_policy_and_attendance_are_separate(client, monkeypatch):
    teacher = login(client, "teacher@focuslock.test")
    student = login(client)
    outsider = login(client, "student3@focuslock.test")
    other_teacher = login(client, "teacher2@focuslock.test")
    nonce = uuid4()
    policy_url = f"/sessions/1/focus-policy?nonce={nonce}"
    assert client.post("/sessions/1/activate", headers=other_teacher).status_code == 404
    assert client.get(policy_url, headers=student).status_code == 409
    assert client.post("/sessions/1/start", headers=teacher).json()["state"] == "checkin_pending"
    assert client.get("/sessions/1/qr", headers=teacher).status_code == 200
    assert client.get(policy_url, headers=student).status_code == 409
    assert client.post("/sessions/1/activate", headers=teacher).json()["state"] == "active"
    assert client.get(policy_url, headers=outsider).status_code == 404
    response = client.get(policy_url, headers=student)
    assert response.status_code == 200
    token = response.json()["policy"]
    assert json.loads(unb64(token.split(".")[1]))["nonce"] == str(nonce)
    now = stage3.now_utc()
    assert stage3.verify_policy(token, 3, 1, now)["max"] == 2700
    event = {"id": str(uuid4()), "policy": token, "action": "started"}
    assert client.post("/sessions/1/focus-events", headers=student, json=event).json()["duplicate"] is False
    assert client.post("/sessions/1/focus-events", headers=student, json=event).json()["duplicate"] is True
    assert client.post("/sessions/1/focus-events", headers=outsider, json=event).status_code == 404
    assert client.get("/sessions/1/focus-events", headers=other_teacher).status_code == 404
    assert len(client.get("/sessions/1/focus-events", headers=teacher).json()) == 1
    assert client.post("/sessions/1/pause", headers=teacher).json()["state"] == "paused"
    assert client.get("/sessions/1/qr", headers=teacher).status_code == 409
    assert client.get(policy_url, headers=student).status_code == 409
    assert client.post("/sessions/1/resume", headers=teacher).json()["state"] == "active"
    assert client.post("/sessions/1/end", headers=teacher).json()["state"] == "ended"
    assert client.get(policy_url, headers=student).status_code == 409
    with client.db_factory() as db:
        assert db.get(Attendance, (1, 3)) is None
        assert len(db.query(FocusEvent).all()) == 1
    assert client.get("/sessions/1", headers=student).json()["attendance"] is None
    assert client.post("/sessions/1/activate", headers=teacher).status_code == 409
    assert client.post("/sessions/1/pause", headers=teacher).status_code == 409
    try:
        stage3.verify_policy(token, 3, 1, now + timedelta(hours=2))
        assert False, "expired policy was accepted"
    except Exception as error:
        assert error.status_code == 422


def test_policy_signature_and_wrong_student_fail(client):
    teacher = login(client, "teacher@focuslock.test")
    student = login(client)
    client.post("/sessions/1/start", headers=teacher)
    client.post("/sessions/1/activate", headers=teacher)
    token = client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student).json()["policy"]
    now = stage3.now_utc()
    for candidate, student_id in ((token, 4), (token[:-1] + ("A" if token[-1] != "A" else "B"), 3)):
        try:
            stage3.verify_policy(candidate, student_id, 1, now)
            assert False, "invalid policy was accepted"
        except Exception as error:
            assert error.status_code == 422


def test_background_flag_is_neutral_idempotent_and_teacher_scoped(client):
    teacher = login(client, "teacher@focuslock.test")
    other_teacher = login(client, "teacher2@focuslock.test")
    student = login(client)
    client.post("/sessions/1/start", headers=teacher)
    client.post("/sessions/1/activate", headers=teacher)
    token = client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student).json()["policy"]
    flag = {"id": str(uuid4()), "policy": token, "action": "backgrounded"}
    assert client.post("/sessions/1/focus-events", headers=student, json=flag).status_code == 201
    assert client.post("/sessions/1/focus-events", headers=student, json=flag).json()["duplicate"] is True
    assert client.post("/sessions/1/focus-events", headers=teacher, json={**flag, "id": str(uuid4())}).status_code == 403
    assert client.get("/sessions/1/focus-events", headers=other_teacher).status_code == 404
    events = client.get("/sessions/1/focus-events", headers=teacher).json()
    assert len(events) == 1 and events[0]["id"] == flag["id"] and events[0]["action"] == "backgrounded"
    assert client.get("/sessions/1", headers=student).json()["attendance"] is None
    client.post("/sessions/1/pause", headers=teacher)
    assert client.post("/sessions/1/focus-events", headers=student,
                       json={**flag, "id": str(uuid4())}).status_code == 409
