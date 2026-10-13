"""为用户的数据任务创建请求记录固定一小时窗口限流状态。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0006"
down_revision = "fd_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flowdesk_data_job_rate_limits",
        sa.Column("owner_user_id", sa.String(length=255), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.CheckConstraint("request_count >= 0", name="ck_flowdesk_data_job_rate_count"),
        sa.PrimaryKeyConstraint("owner_user_id", name="pk_flowdesk_data_job_rate_limits"),
        schema="product",
    )


def downgrade() -> None:
    op.drop_table("flowdesk_data_job_rate_limits", schema="product")
