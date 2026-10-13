"""为产品文件中心保存 owner-scoped 元数据快照。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0007"
down_revision = "fd_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flowdesk_file_catalog_state",
        sa.Column("owner_user_id", sa.String(length=255), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_token", sa.String(length=36), nullable=True),
        sa.Column("refresh_lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_failed", sa.Boolean(), nullable=False),
        sa.Column("truncated", sa.Boolean(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("coverage_notes", sa.JSON(), nullable=False),
        sa.CheckConstraint(
            "failed_count >= 0",
            name="ck_flowdesk_file_catalog_state_failed_count",
        ),
        sa.PrimaryKeyConstraint("owner_user_id", name="pk_flowdesk_file_catalog_state"),
        schema="product",
    )
    op.create_table(
        "flowdesk_file_catalog_entries",
        sa.Column("owner_user_id", sa.String(length=255), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("entry_hash", sa.String(length=64), nullable=False),
        sa.Column("file_id", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("artifact_url", sa.Text(), nullable=False),
        sa.Column("modified_at", sa.Float(), nullable=True),
        sa.Column("storage_name", sa.Text(), nullable=True),
        sa.Column("thread_id", sa.Text(), nullable=True),
        sa.Column("thread_name", sa.Text(), nullable=True),
        sa.Column("project_id", sa.Text(), nullable=True),
        sa.Column("project_name", sa.Text(), nullable=True),
        sa.Column("document_id", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "source IN ('thread_upload', 'thread_output', 'thread_workspace', 'project_document')",
            name="ck_flowdesk_file_catalog_entries_source",
        ),
        sa.CheckConstraint(
            "size_bytes >= 0",
            name="ck_flowdesk_file_catalog_entries_size",
        ),
        sa.PrimaryKeyConstraint(
            "owner_user_id",
            "snapshot_id",
            "entry_hash",
            name="pk_flowdesk_file_catalog_entries",
        ),
        schema="product",
    )
    op.create_index(
        "ix_flowdesk_file_catalog_entries_owner_snapshot",
        "flowdesk_file_catalog_entries",
        ["owner_user_id", "snapshot_id"],
        schema="product",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_flowdesk_file_catalog_entries_owner_snapshot",
        table_name="flowdesk_file_catalog_entries",
        schema="product",
    )
    op.drop_table("flowdesk_file_catalog_entries", schema="product")
    op.drop_table("flowdesk_file_catalog_state", schema="product")
