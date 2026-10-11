"""Optional BLE evidence, with no stored raw broadcast tokens."""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("room_code", sa.String(40), nullable=False, server_default="UNASSIGNED"))
    op.create_table("ble_receivers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("course_offerings.id"), nullable=False),
        sa.Column("room_code", sa.String(40), nullable=False),
        sa.Column("token_digest", sa.String(64), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_ble_receivers_course_id", "ble_receivers", ["course_id"])
    op.create_table("ble_credentials",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_ble_credentials_session_id", "ble_credentials", ["session_id"])
    op.create_index("ix_ble_credentials_student_id", "ble_credentials", ["student_id"])
    op.create_table("ble_sightings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("receiver_id", sa.String(36), sa.ForeignKey("ble_receivers.id"), nullable=False),
        sa.Column("credential_id", sa.String(36), sa.ForeignKey("ble_credentials.id"), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("receiver_id", "credential_id", "slot", name="ble_sighting_unique"))
    op.create_index("ix_ble_sightings_credential_id", "ble_sightings", ["credential_id"])


def downgrade():
    op.drop_table("ble_sightings")
    op.drop_table("ble_credentials")
    op.drop_table("ble_receivers")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("room_code")
