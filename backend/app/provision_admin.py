"""Operator-only initial admin bootstrap after college verifies the exact OIDC subject."""
import argparse
from datetime import datetime, timezone

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import AdminAudit, User


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()
    if settings().app_env != "production" or not settings().oidc_configured:
        raise SystemExit("Production OIDC configuration is required")
    if not 1 <= len(args.subject) <= 255 or not 1 <= len(args.name) <= 100 or not 3 <= len(args.email) <= 254:
        raise SystemExit("Invalid account fields")
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)) is not None:
            raise SystemExit("Bootstrap allowed only on an empty user table; use the admin API afterward")
        row = User(oidc_subject=args.subject, email=args.email.strip().lower(), name=args.name.strip(),
                   role="admin", is_demo=False)
        db.add(row)
        db.flush()
        db.add(AdminAudit(actor_id=row.id, action="admin_bootstrap", target_type="user",
                          target_id=str(row.id), reason="Operator verified college OIDC subject",
                          recorded_at=datetime.now(timezone.utc)))
        db.commit()
    print("Initial college administrator provisioned")


if __name__ == "__main__":
    main()
