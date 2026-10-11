"""Teacher approval to continue after leaving the app during focus."""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("focus_exit_requests") as batch:
        batch.add_column(sa.Column("kind", sa.String(8), nullable=False, server_default="exit"))
        batch.create_check_constraint("focus_exit_kind", "kind IN ('exit', 'resume')")


def downgrade():
    with op.batch_alter_table("focus_exit_requests") as batch:
        batch.drop_constraint("focus_exit_kind", type_="check")
        batch.drop_column("kind")
