"""Add durable Central IAM model usage settlement outbox."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fd_0028_iam_model_usage_outbox"
down_revision: str | Sequence[str] | None = "fd_0027_repair_run_change_seq"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Persist usage facts for idempotent retry after transient failures/restarts."""
    op.create_table(
        "iam_model_usage_outbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.String(length=180), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("reserved_input_tokens", sa.Integer(), nullable=False),
        sa.Column("reserved_output_tokens", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("usage_is_estimated", sa.Boolean(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_owner", sa.Uuid(), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_class", sa.String(length=120), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("action IN ('settle', 'report')", name="ck_iam_model_usage_outbox_action"),
        sa.CheckConstraint("status IN ('pending', 'processing', 'delivered')", name="ck_iam_model_usage_outbox_status"),
        sa.CheckConstraint(
            "reserved_input_tokens >= 0 AND reserved_output_tokens >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND latency_ms >= 0 AND attempt_count >= 0",
            name="ck_iam_model_usage_outbox_nonnegative",
        ),
        sa.CheckConstraint("outcome IN ('succeeded', 'failed')", name="ck_iam_model_usage_outbox_outcome"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_id", name="uq_iam_model_usage_outbox_request"),
    )
    op.create_index("ix_iam_model_usage_outbox_due", "iam_model_usage_outbox", ["status", "next_attempt_at"])
    op.create_index("ix_iam_model_usage_outbox_lease", "iam_model_usage_outbox", ["status", "lease_until"])


def downgrade() -> None:
    """Remove only the outbox introduced by this revision."""
    op.drop_index("ix_iam_model_usage_outbox_lease", table_name="iam_model_usage_outbox")
    op.drop_index("ix_iam_model_usage_outbox_due", table_name="iam_model_usage_outbox")
    op.drop_table("iam_model_usage_outbox")
