"""Stage 1 schema. Explicit operations keep this migration independent of future models."""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("is_demo", sa.Boolean(), nullable=False),
        sa.CheckConstraint("role IN ('student', 'teacher')", name="user_role"))
    op.create_table("course_offerings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("title", sa.String(150), nullable=False),
        sa.Column("term", sa.String(40), nullable=False),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False))
    op.create_index("ix_course_offerings_teacher_id", "course_offerings", ["teacher_id"])
    op.create_table("enrollments",
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("course_offerings.id"), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True))
    op.create_table("sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("course_offerings.id"), nullable=False),
        sa.Column("title", sa.String(150), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("id", "course_id", name="session_course_unique"),
        sa.CheckConstraint("ends_at > starts_at", name="session_time_order"))
    op.create_index("ix_sessions_course_id", "sessions", ["course_id"])
    op.create_table("attendance",
        sa.Column("session_id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("method", sa.String(32), nullable=False),
        sa.Column("confirmed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id", "course_id"], ["sessions.id", "sessions.course_id"]),
        sa.ForeignKeyConstraint(["course_id", "student_id"], ["enrollments.course_id", "enrollments.student_id"]),
        sa.CheckConstraint("status IN ('present', 'absent', 'excused')", name="attendance_status"),
        sa.CheckConstraint("method = 'teacher_confirmed'", name="attendance_method"))
    op.create_table("dev_tokens",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    for table in ["dev_tokens", "attendance", "sessions", "enrollments", "course_offerings", "users"]:
        op.drop_table(table)
