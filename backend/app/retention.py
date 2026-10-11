"""Run periodically as `python -m app.retention`; attendance/audit use college policy."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import (BleCredential, BleSighting, DevToken, DeviceChallenge, FocusEvent,
                     IntegrityReceipt, RateAttempt)


def purge(db: Session, now: datetime | None = None) -> dict[str, int]:
    cfg = settings()
    if min(cfg.retention_event_days, cfg.retention_sighting_days, cfg.retention_credential_days) < 1:
        raise ValueError("Retention periods must be at least one day")
    now = now or datetime.now(timezone.utc)
    counts = {}
    statements = {
        "focus_events": delete(FocusEvent).where(FocusEvent.recorded_at < now - timedelta(days=cfg.retention_event_days)),
        "ble_sightings": delete(BleSighting).where(BleSighting.recorded_at < now - timedelta(days=cfg.retention_sighting_days)),
        "ble_credentials": delete(BleCredential).where(BleCredential.expires_at < now - timedelta(days=cfg.retention_credential_days),
            ~BleCredential.id.in_(select(BleSighting.credential_id))),
        "device_challenges": delete(DeviceChallenge).where(DeviceChallenge.expires_at < now - timedelta(days=1)),
        "integrity_receipts": delete(IntegrityReceipt).where(IntegrityReceipt.verified_at < now - timedelta(days=1)),
        "rate_attempts": delete(RateAttempt).where(RateAttempt.occurred_at < now - timedelta(days=1)),
        "dev_tokens": delete(DevToken).where(DevToken.expires_at < now),
    }
    for name, statement in statements.items():
        counts[name] = db.execute(statement).rowcount
    db.commit()
    return counts


if __name__ == "__main__":
    with SessionLocal() as session:
        print(purge(session))
