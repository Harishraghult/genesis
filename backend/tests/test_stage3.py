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


def checked_in(client, teacher, student=None):
    from test_stage2 import checkin_request, register
    student, key, device_id, _ = register(client, student)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    response = client.post("/check-ins", headers=student, json=checkin_request(client, student, key, device_id, qr))
    assert response.status_code == 200, response.text
    return student


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
    assert client.get(policy_url, headers=student).status_code == 409  # focus needs the QR check-in first
    checked_in(client, teacher, student)
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
        row = db.get(Attendance, (1, 3))
        assert row is not None and row.method == "qr" and row.status == "present"  # focus events never change attendance
        assert len(db.query(FocusEvent).all()) == 1
    assert client.get("/sessions/1", headers=student).json()["attendance"]["status"] == "present"
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
    checked_in(client, teacher, student)
    client.post("/sessions/1/activate", headers=teacher)
    token = client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student).json()["policy"]
    now = stage3.now_utc()
    for candidate, student_id in ((token, 4), (token[:-12] + ("A" if token[-12] != "A" else "B") + token[-11:], 3)):
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
    checked_in(client, teacher, student)
    client.post("/sessions/1/activate", headers=teacher)
    token = client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student).json()["policy"]
    flag = {"id": str(uuid4()), "policy": token, "action": "backgrounded"}
    assert client.post("/sessions/1/focus-events", headers=student, json=flag).status_code == 201
    assert client.post("/sessions/1/focus-events", headers=student, json=flag).json()["duplicate"] is True
    assert client.post("/sessions/1/focus-events", headers=teacher, json={**flag, "id": str(uuid4())}).status_code == 403
    assert client.get("/sessions/1/focus-events", headers=other_teacher).status_code == 404
    events = client.get("/sessions/1/focus-events", headers=teacher).json()
    assert len(events) == 1 and events[0]["id"] == flag["id"] and events[0]["action"] == "backgrounded"
    assert client.get("/sessions/1", headers=student).json()["attendance"]["method"] == "qr"
    client.post("/sessions/1/pause", headers=teacher)
    assert client.post("/sessions/1/focus-events", headers=student,
                       json={**flag, "id": str(uuid4())}).status_code == 409


def test_early_focus_exit_needs_current_qr_or_teacher_approval(client):
    teacher = login(client, "teacher@focuslock.test")
    other_teacher = login(client, "teacher2@focuslock.test")
    student = login(client)
    outsider = login(client, "student3@focuslock.test")
    assert client.post("/sessions/1/start", headers=teacher).status_code == 200
    assert client.post("/sessions/1/activate", headers=teacher).status_code == 200
    assert client.post("/sessions/2/start", headers=other_teacher).status_code == 200
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    other_qr = client.get("/sessions/2/qr", headers=other_teacher).json()["qr"]
    path = "/sessions/1/focus-exit/qr"
    assert client.post(path, headers=student, json={"qr": "FL2.bad.bad"}).status_code == 422
    assert client.post(path, headers=student, json={"qr": other_qr}).status_code in (404, 422)
    assert client.post(path, headers=outsider, json={"qr": qr}).status_code == 404
    assert client.post(path, headers=teacher, json={"qr": qr}).status_code == 403
    assert client.post(path, headers=student, json={"qr": qr}).json() == {"approved": True}

    assert client.get("/sessions/1/focus-exit-requests/mine", headers=student).status_code == 404
    created = client.post("/sessions/1/focus-exit-requests", headers=student)
    assert created.status_code == 201 and created.json()["status"] == "pending"
    again = client.post("/sessions/1/focus-exit-requests", headers=student)
    assert again.json()["id"] == created.json()["id"]
    assert client.post("/sessions/1/focus-exit-requests", headers=outsider).status_code == 404
    assert client.post("/sessions/1/focus-exit-requests", headers=teacher).status_code == 403
    assert len(client.get("/sessions/1/focus-exit-requests", headers=teacher).json()) == 1
    assert client.get("/sessions/1/focus-exit-requests", headers=other_teacher).status_code == 404
    assert client.get("/sessions/1/focus-exit-requests", headers=student).status_code == 403
    resolve = f"/sessions/1/focus-exit-requests/{created.json()['id']}"
    assert client.post(resolve, headers=student, json={"decision": "approve"}).status_code == 403
    assert client.post(resolve, headers=other_teacher, json={"decision": "approve"}).status_code == 404
    assert client.get("/sessions/1/focus-exit-requests/mine", headers=student).json()["status"] == "pending"
    assert client.post(resolve, headers=teacher, json={"decision": "approve"}).json()["status"] == "approved"
    assert client.post(resolve, headers=teacher, json={"decision": "deny"}).status_code == 409
    assert client.get("/sessions/1/focus-exit-requests/mine", headers=student).json()["status"] == "approved"
    assert client.get("/sessions/1/focus-exit-requests", headers=teacher).json() == []
    second = client.post("/sessions/1/focus-exit-requests", headers=student).json()
    assert second["id"] != created.json()["id"]
    assert client.post(f"/sessions/1/focus-exit-requests/{second['id']}", headers=teacher, json={"decision": "deny"}).json()["status"] == "denied"
    assert client.post("/sessions/1/end", headers=teacher).status_code == 200
    assert client.post("/sessions/1/focus-exit-requests", headers=student).status_code == 409


def test_leaving_the_app_needs_teacher_approval_to_continue(client):
    teacher = login(client, "teacher@focuslock.test")
    other_teacher = login(client, "teacher2@focuslock.test")
    student = login(client)
    outsider = login(client, "student3@focuslock.test")
    assert client.post("/sessions/1/start", headers=teacher).status_code == 200
    assert client.post("/sessions/1/activate", headers=teacher).status_code == 200
    assert client.get("/sessions/1/focus-resume-requests/mine", headers=student).status_code == 404
    created = client.post("/sessions/1/focus-resume-requests", headers=student)
    assert created.status_code == 201 and created.json()["kind"] == "resume" and created.json()["status"] == "pending"
    assert client.post("/sessions/1/focus-resume-requests", headers=student).json()["id"] == created.json()["id"]
    assert client.post("/sessions/1/focus-resume-requests", headers=outsider).status_code == 404
    assert client.post("/sessions/1/focus-resume-requests", headers=teacher).status_code == 403
    # An exit request is a separate kind and does not satisfy the resume request.
    exit_request = client.post("/sessions/1/focus-exit-requests", headers=student).json()
    assert exit_request["kind"] == "exit" and exit_request["id"] != created.json()["id"]
    pending = client.get("/sessions/1/focus-exit-requests", headers=teacher).json()
    assert {row["kind"] for row in pending} == {"exit", "resume"}
    assert client.get("/sessions/1/focus-exit-requests", headers=other_teacher).status_code == 404
    path = f"/sessions/1/focus-resume-requests/{created.json()['id']}"
    assert client.post(f"/sessions/1/focus-exit-requests/{created.json()['id']}", headers=student, json={"decision": "approve"}).status_code == 403
    assert client.get("/sessions/1/focus-resume-requests/mine", headers=student).json()["status"] == "pending"
    assert client.post(f"/sessions/1/focus-exit-requests/{created.json()['id']}", headers=teacher, json={"decision": "deny"}).json()["status"] == "denied"
    assert client.get("/sessions/1/focus-resume-requests/mine", headers=student).json()["status"] == "denied"
    again = client.post("/sessions/1/focus-resume-requests", headers=student).json()
    assert again["status"] == "pending" and again["id"] != created.json()["id"]
    assert client.post(f"/sessions/1/focus-exit-requests/{again['id']}", headers=teacher, json={"decision": "approve"}).json()["status"] == "approved"
    assert client.get("/sessions/1/focus-exit-requests/mine", headers=student).json()["status"] == "pending"
    assert client.post("/sessions/1/end", headers=teacher).status_code == 200
    assert client.post("/sessions/1/focus-resume-requests", headers=student).status_code == 409


def test_student_can_rescan_and_rejoin_focus_after_quitting(client):
    from test_stage2 import checkin_request, register
    teacher = login(client, "teacher@focuslock.test")
    assert client.post("/sessions/1/start", headers=teacher).status_code == 200
    assert client.post("/sessions/1/activate", headers=teacher).status_code == 200
    student, key, device_id, _ = register(client)
    qr = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    assert client.post("/check-ins", headers=student, json=checkin_request(client, student, key, device_id, qr)).json()["duplicate"] is False
    first = client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student)
    assert first.status_code == 200
    # The student quits focus (teacher approval), then scans the QR again to rejoin.
    request = client.post("/sessions/1/focus-exit-requests", headers=student).json()
    assert client.post(f"/sessions/1/focus-exit-requests/{request['id']}", headers=teacher, json={"decision": "approve"}).status_code == 200
    qr_again = client.get("/sessions/1/qr", headers=teacher).json()["qr"]
    again = client.post("/check-ins", headers=student, json=checkin_request(client, student, key, device_id, qr_again))
    assert again.status_code == 200 and again.json()["duplicate"] is True and again.json()["method"] == "qr"
    second = client.get(f"/sessions/1/focus-policy?nonce={uuid4()}", headers=student)
    assert second.status_code == 200 and second.json()["policy"] != first.json()["policy"]
    assert client.get("/sessions/1", headers=student).json()["attendance"]["status"] == "present"
