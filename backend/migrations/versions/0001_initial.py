"""Initial schema. Frozen migration, independent of future application models."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "admins",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
    )
    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(), primary_key=True),
        sa.Column("admin_id", sa.String(), sa.ForeignKey("admins.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "floors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_table(
        "sectors",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("floor_id", sa.Integer(), sa.ForeignKey("floors.id"), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_table(
        "cameras",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "sector_id",
            sa.String(),
            sa.ForeignKey("sectors.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_table(
        "observations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "camera_id", sa.String(), sa.ForeignKey("cameras.id"), nullable=False
        ),
        sa.Column(
            "sector_id", sa.String(), sa.ForeignKey("sectors.id"), nullable=False
        ),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("count", sa.Integer()),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index("ix_observations_captured_at", "observations", ["captured_at"])
    op.create_index(
        "ix_obs_sector_source_time",
        "observations",
        ["sector_id", "source", "captured_at"],
    )
    op.create_table(
        "passages",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index("ix_passages_start_at", "passages", ["start_at"])
    for name in ["events", "special_dates"]:
        op.create_table(
            name,
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("data", sa.JSON(), nullable=False),
        )
    op.create_table(
        "annotations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("admin_id", sa.String(), sa.ForeignKey("admins.id"), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_table(
        "favorites",
        sa.Column(
            "admin_id", sa.String(), sa.ForeignKey("admins.id"), primary_key=True
        ),
        sa.Column(
            "sector_id", sa.String(), sa.ForeignKey("sectors.id"), primary_key=True
        ),
    )
    op.create_table(
        "profiles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )


def downgrade():
    for name in [
        "profiles",
        "favorites",
        "annotations",
        "special_dates",
        "events",
        "passages",
        "observations",
        "cameras",
        "sectors",
        "floors",
        "sessions",
        "admins",
    ]:
        op.drop_table(name)
