"""Encrypted face templates for on-device identity matching."""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("face_templates",
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("ciphertext", sa.String(1024), nullable=False),
        sa.Column("model", sa.String(32), nullable=False),
        sa.Column("enrolled_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consent_recorded_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("face_templates")
