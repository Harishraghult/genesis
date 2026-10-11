"""Teacher-approved early exit from voluntary focus."""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("focus_exit_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'approved', 'denied')", name="focus_exit_status"))
    op.create_index("ix_focus_exit_requests_session_id", "focus_exit_requests", ["session_id"])
    op.create_index("ix_focus_exit_requests_student_id", "focus_exit_requests", ["student_id"])


def downgrade():
    op.drop_table("focus_exit_requests")
