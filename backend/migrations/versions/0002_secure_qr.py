"""Session lifecycle, device proof, pending requests and attendance audit."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("state", sa.String(16), nullable=False, server_default="scheduled"))
        batch.add_column(sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_check_constraint("session_state", "state IN ('scheduled', 'active', 'ended')")
    with op.batch_alter_table("attendance") as batch:
        batch.alter_column("confirmed_by", existing_type=sa.Integer(), nullable=True)
        batch.drop_constraint("attendance_method", type_="check")
        batch.create_check_constraint("attendance_method", "method IN ('teacher_confirmed', 'qr')")
    op.create_table("devices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False, unique=True),
        sa.Column("registered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_devices_student_id", "devices", ["student_id"])
    op.create_table("device_challenges",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("nonce", sa.String(64), nullable=False),
        sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("qr_digest", sa.String(64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("request_digest", sa.String(64), nullable=True))
    op.create_index("ix_device_challenges_student_id", "device_challenges", ["student_id"])
    op.create_table("attendance_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("previous_status", sa.String(16), nullable=True),
        sa.Column("new_status", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_attendance_events_session_id", "attendance_events", ["session_id"])
    op.create_table("pending_attendance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("session_id", "student_id", name="pending_session_student_unique"))
    op.create_index("ix_pending_attendance_session_id", "pending_attendance", ["session_id"])
    op.execute("INSERT INTO attendance_events (session_id, student_id, actor_id, action, previous_status, new_status, reason, recorded_at) SELECT session_id, student_id, confirmed_by, 'legacy_import', NULL, status, 'Imported from Stage 1 without original change history', updated_at FROM attendance")


def downgrade():
    # Explicitly remove QR records before restoring the Stage 1 method constraint.
    op.execute("DELETE FROM attendance WHERE method = 'qr'")
    for table in ["pending_attendance", "attendance_events", "device_challenges", "devices"]:
        op.drop_table(table)
    with op.batch_alter_table("attendance") as batch:
        batch.drop_constraint("attendance_method", type_="check")
        batch.create_check_constraint("attendance_method", "method = 'teacher_confirmed'")
        batch.alter_column("confirmed_by", existing_type=sa.Integer(), nullable=False)
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint("session_state", type_="check")
        batch.drop_column("ended_at")
        batch.drop_column("started_at")
        batch.drop_column("state")
