"""每位用户最多保留一个正在排队或执行的数据任务。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0005"
down_revision = "fd_0004"
branch_labels = None
depends_on = None

_ACTIVE_STATUSES = "status IN ('queued', 'running', 'retry_wait')"


def upgrade() -> None:
    # 数据任务包含敏感导出与删除；单账号一个活动任务可限制并发和制品堆积。
    # 已有重复活动任务时迁移会失败并保留现场，要求运维先核对任务而不是自动取消。
    op.create_index(
        "uq_flowdesk_data_jobs_active_owner",
        "flowdesk_data_jobs",
        ["owner_user_id"],
        unique=True,
        schema="product",
        postgresql_where=sa.text(_ACTIVE_STATUSES),
        sqlite_where=sa.text(_ACTIVE_STATUSES),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_flowdesk_data_jobs_active_owner",
        table_name="flowdesk_data_jobs",
        schema="product",
    )
