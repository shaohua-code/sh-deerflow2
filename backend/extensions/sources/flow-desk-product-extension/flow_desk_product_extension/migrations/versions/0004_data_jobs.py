"""创建自有、可租约恢复的数据操作任务表。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0004"
down_revision = "fd_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flowdesk_data_jobs",
        sa.Column("job_id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("scope", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_owner", sa.String(length=128), nullable=True),
        sa.Column("lease_token", sa.String(length=36), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('export', 'deletion')", name="ck_flowdesk_data_jobs_kind"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'retry_wait', 'completed', 'partial', "
            "'failed', 'cancelled')",
            name="ck_flowdesk_data_jobs_status",
        ),
        sa.CheckConstraint(
            "attempt >= 0 AND max_attempts >= 1", name="ck_flowdesk_data_jobs_attempts"
        ),
        sa.PrimaryKeyConstraint("job_id", name="pk_flowdesk_data_jobs"),
        sa.UniqueConstraint(
            "owner_user_id",
            "idempotency_key",
            name="uq_flowdesk_data_jobs_owner_idempotency",
        ),
        schema="product",
    )
    op.create_index(
        "ix_flowdesk_data_jobs_dispatch",
        "flowdesk_data_jobs",
        ["status", "available_at", "created_at"],
        schema="product",
    )
    op.create_index(
        "ix_flowdesk_data_jobs_owner_created",
        "flowdesk_data_jobs",
        ["owner_user_id", "created_at"],
        schema="product",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_flowdesk_data_jobs_owner_created",
        table_name="flowdesk_data_jobs",
        schema="product",
    )
    op.drop_index(
        "ix_flowdesk_data_jobs_dispatch",
        table_name="flowdesk_data_jobs",
        schema="product",
    )
    op.drop_table("flowdesk_data_jobs", schema="product")
