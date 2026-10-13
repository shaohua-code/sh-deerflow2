"""添加不含业务正文的产品审计事件表。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0002"
down_revision = "fd_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flowdesk_audit_events",
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("resource_type", sa.String(length=100), nullable=False),
        sa.Column("resource_id", sa.String(length=255), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.PrimaryKeyConstraint("event_id", name="pk_flowdesk_audit_events"),
        schema="product",
    )
    op.create_index(
        "ix_flowdesk_audit_events_actor_user_id",
        "flowdesk_audit_events",
        ["actor_user_id"],
        schema="product",
    )
    op.create_index(
        "ix_flowdesk_audit_events_occurred_at",
        "flowdesk_audit_events",
        ["occurred_at"],
        schema="product",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_flowdesk_audit_events_occurred_at",
        table_name="flowdesk_audit_events",
        schema="product",
    )
    op.drop_index(
        "ix_flowdesk_audit_events_actor_user_id",
        table_name="flowdesk_audit_events",
        schema="product",
    )
    op.drop_table("flowdesk_audit_events", schema="product")
