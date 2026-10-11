"""Record whether a QR check-in carried the on-device face-match claim."""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("attendance") as batch:
        batch.add_column(sa.Column("face_verified", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("attendance") as batch:
        batch.drop_column("face_verified")
