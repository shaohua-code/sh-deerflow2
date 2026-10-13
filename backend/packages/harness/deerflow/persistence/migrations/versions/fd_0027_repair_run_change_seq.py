"""补回历史上已记录版本、但未实际创建的运行变更序号结构。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fd_0027_repair_run_change_seq"
down_revision: str | Sequence[str] | None = "0026_iam_oidc_token_vault"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """在当前产品迁移 head 后幂等补齐上游 run-change schema。"""
    from deerflow.persistence.migrations._helpers import safe_add_column

    # 官方修复迁移使用的 0025 编号已被本项目的用户状态迁移占用，
    # 因此这里用 Flow Desk 前缀增加后继 revision，不重编号已部署迁移。
    safe_add_column(
        "runs",
        sa.Column("change_seq", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
    )

    inspector = sa.inspect(op.get_bind())
    if "run_change_clock" not in set(inspector.get_table_names()):
        op.create_table(
            "run_change_clock",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("value", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        )

    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("runs")}
    if "ix_runs_change_seq" not in indexes:
        op.create_index("ix_runs_change_seq", "runs", ["change_seq", "run_id"])
    if "ix_runs_user_change_seq" not in indexes:
        op.create_index("ix_runs_user_change_seq", "runs", ["user_id", "change_seq", "run_id"])


def downgrade() -> None:
    """保留上游 0023 拥有的结构，避免回退时丢失变更序号。"""
    # 与官方修复迁移相同，结构归 0023_run_change_seq 所有；
    # 只有回退到该祖先 revision 时，才允许删除表、列和索引。
    return None
