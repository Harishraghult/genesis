"""Tests for the VPN restriction reporting, vpn_* events and presence accounting."""
import pytest

from conftest import KEY, join


def report(api, sid):
    r = api.get(f"/api/session/{sid}/report", headers=KEY)
    assert r.status_code == 200
    return r.json()


def me(api, st):
    return next(s for s in report(api, st.sid)["students"] if s["student_id"] == st.student)


def test_report_has_vpn_fields_unset_before_any_report(api):
    st = join(api)
    row = me(api, st)
    assert row["vpn_active"] is None and row["vpn_last_change"] is None
    # existing fields still present
    assert {"checked_in_at", "last_seen", "left_at", "events", "event_counts", "present_seconds"} <= row.keys()


def test_heartbeat_vpn_param_is_stored_with_timestamp(api, clock):
    st = join(api)
    assert st.call("GET", "/api/client/heartbeat?vpn=1").status_code == 200
    row = me(api, st)
    assert row["vpn_active"] is True and row["vpn_last_change"] == clock["t"]


def test_vpn_last_change_only_moves_on_change(api, clock):
    st = join(api)
    st.call("GET", "/api/client/heartbeat?vpn=1")
    t_on = clock["t"]
    clock["t"] += 10
    st.call("GET", "/api/client/heartbeat?vpn=1")
    assert me(api, st)["vpn_last_change"] == t_on
    clock["t"] += 10
    st.call("GET", "/api/client/heartbeat?vpn=0")
    row = me(api, st)
    assert row["vpn_active"] is False and row["vpn_last_change"] == t_on + 20


def test_heartbeat_without_vpn_param_keeps_state(api):
    st = join(api)
    st.call("GET", "/api/client/heartbeat?vpn=1")
    st.call("GET", "/api/client/heartbeat")
    assert me(api, st)["vpn_active"] is True


def test_heartbeat_rejects_bad_vpn_value(api):
    st = join(api)
    assert st.call("GET", "/api/client/heartbeat?vpn=yes").status_code == 422


def test_vpn_query_is_part_of_signature(api):
    st = join(api)
    # Signed for ?vpn=0 but sent as ?vpn=1: a tampered query must fail.
    r = st.call("GET", "/api/client/heartbeat?vpn=1", sign_pq="/api/client/heartbeat?vpn=0")
    assert r.status_code == 401


@pytest.mark.parametrize("etype,state", [
    ("vpn_started", True), ("vpn_stopped", False), ("vpn_revoked", False), ("vpn_declined", False),
])
def test_vpn_events_accepted_and_update_state(api, etype, state):
    st = join(api)
    r = st.call("POST", "/api/client/event", json_body={"type": etype, "detail": "test"})
    assert r.status_code == 200
    row = me(api, st)
    assert row["event_counts"][etype] == 1
    assert row["vpn_active"] is state


def test_revoked_after_started_flips_state(api, clock):
    st = join(api)
    st.call("POST", "/api/client/event", json_body={"type": "vpn_started"})
    clock["t"] += 42
    st.call("POST", "/api/client/event", json_body={"type": "vpn_revoked"})
    row = me(api, st)
    assert row["vpn_active"] is False and row["vpn_last_change"] == clock["t"]
    assert [e["type"] for e in row["events"]] == ["vpn_started", "vpn_revoked"]


def test_event_types_remain_free_strings(api):
    st = join(api)
    assert st.call("POST", "/api/client/event", json_body={"type": "some_new_thing"}).status_code == 200
    assert me(api, st)["vpn_active"] is None


def test_presence_sums_heartbeat_gaps(api, clock):
    st = join(api, heartbeat_s=10)
    for _ in range(6):
        clock["t"] += 10
        st.call("GET", "/api/client/heartbeat")
    assert me(api, st)["present_seconds"] == 60


def test_presence_caps_gaps_at_twice_interval(api, clock):
    st = join(api, heartbeat_s=10)
    clock["t"] += 10
    st.call("GET", "/api/client/heartbeat")
    clock["t"] += 300  # e.g. phone dropped off the classroom Wi-Fi for 5 minutes
    st.call("GET", "/api/client/heartbeat")
    assert me(api, st)["present_seconds"] == 10 + 20


def test_off_network_heartbeats_do_not_count(api, outside, clock):
    """On mobile data the phone is outside FL_CLASSROOM_NETS: rejected and not counted."""
    st = join(api, heartbeat_s=10)
    for _ in range(3):
        clock["t"] += 10
        assert st.call("GET", "/api/client/heartbeat", via=outside).status_code == 403
    assert me(api, st)["present_seconds"] == 0


def test_report_stores_no_ip_addresses(api):
    st = join(api)
    st.call("GET", "/api/client/heartbeat?vpn=1")
    assert "10.1.2.3" not in report(api, st.sid).__repr__()
