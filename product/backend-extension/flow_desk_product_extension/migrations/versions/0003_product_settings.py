"""添加带版本保护的部署级产品展示配置。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0003"
down_revision = "fd_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flowdesk_product_settings",
        sa.Column("setting_key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("setting_key", name="pk_flowdesk_product_settings"),
        schema="product",
    )


def downgrade() -> None:
    op.drop_table("flowdesk_product_settings", schema="product")
