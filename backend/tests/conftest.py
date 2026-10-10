"""Fixtures for app.main tests.

Legacy privacy tests punch in with synthetic student IDs, so by default we run
with an active session and enrollment enforcement off. Tests that exercise the
roster gate turn enforcement back on explicitly.
"""
import pytest

import app.main as appmain


@pytest.fixture(autouse=True)
def active_session_no_enrollment(monkeypatch):
    monkeypatch.setitem(appmain.ACTIVE_SESSION, "is_active", True)
    monkeypatch.setattr(appmain, "ENFORCE_ENROLLMENT", False)
    yield
