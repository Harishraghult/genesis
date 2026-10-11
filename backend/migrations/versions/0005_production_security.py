"""Production identity, consent, requests, audit and rate limits."""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("user_role", type_="check")
        batch.create_check_constraint("user_role", "role IN ('student', 'teacher', 'admin')")
        batch.add_column(sa.Column("oidc_subject", sa.String(255), nullable=True))
        batch.create_unique_constraint("uq_users_oidc_subject", ["oidc_subject"])
    op.create_table("optional_consents",
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("feature", sa.String(16), primary_key=True),
        sa.Column("disclosure_version", sa.String(32), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("feature IN ('vpn', 'bluetooth')", name="optional_consent_feature"))
    op.create_table("data_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.String(500), nullable=True),
        sa.CheckConstraint("kind IN ('correction', 'deletion')", name="data_request_kind"),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined')", name="data_request_status"))
    op.create_index("ix_data_requests_student_id", "data_requests", ["student_id"])
    op.create_table("admin_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_admin_audit_actor_id", "admin_audit", ["actor_id"])
    op.create_table("rate_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key_digest", sa.String(64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_rate_attempts_key_digest", "rate_attempts", ["key_digest"])
    op.create_index("ix_rate_attempts_occurred_at", "rate_attempts", ["occurred_at"])
    op.create_table("integrity_receipts",
        sa.Column("token_digest", sa.String(64), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("integrity_receipts")
    op.drop_table("rate_attempts")
    op.drop_table("admin_audit")
    op.drop_table("data_requests")
    op.drop_table("optional_consents")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_oidc_subject", type_="unique")
        batch.drop_column("oidc_subject")
        batch.drop_constraint("user_role", type_="check")
        batch.create_check_constraint("user_role", "role IN ('student', 'teacher')")
