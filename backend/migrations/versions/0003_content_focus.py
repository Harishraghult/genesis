"""Course resources and voluntary focus lifecycle."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint("session_state", type_="check")
        batch.create_check_constraint("session_state", "state IN ('scheduled', 'ready', 'checkin_pending', 'active', 'paused', 'ended')")
    op.execute("UPDATE sessions SET state = 'ready' WHERE state = 'scheduled'")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint("session_state", type_="check")
        batch.create_check_constraint("session_state", "state IN ('ready', 'checkin_pending', 'active', 'paused', 'ended')")
        batch.alter_column("state", existing_type=sa.String(16), server_default="ready")
    op.create_table("course_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("title", sa.String(150), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("downloadable", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_course_resources_session_id", "course_resources", ["session_id"])
    op.create_table("focus_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_focus_events_session_id", "focus_events", ["session_id"])
    op.create_index("ix_focus_events_student_id", "focus_events", ["student_id"])


def downgrade():
    op.drop_table("focus_events")
    op.drop_table("course_resources")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint("session_state", type_="check")
        batch.create_check_constraint("session_state", "state IN ('scheduled', 'ready', 'checkin_pending', 'active', 'paused', 'ended')")
    op.execute("UPDATE sessions SET state = 'scheduled' WHERE state = 'ready'")
    op.execute("UPDATE sessions SET state = 'active' WHERE state IN ('checkin_pending', 'paused')")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint("session_state", type_="check")
        batch.create_check_constraint("session_state", "state IN ('scheduled', 'active', 'ended')")
        batch.alter_column("state", existing_type=sa.String(16), server_default="scheduled")
