"""创建按用户隔离的产品设置表。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flowdesk_user_settings",
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("setting_key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "user_id",
            "setting_key",
            name="pk_flowdesk_user_settings",
        ),
        schema="product",
    )


def downgrade() -> None:
    op.drop_table("flowdesk_user_settings", schema="product")
