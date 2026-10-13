"""ORM model for durable, secret-free Central IAM model usage events."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, Integer, String, UniqueConstraint, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from deerflow.persistence.base import Base


class IamModelUsageOutboxRow(Base):
    """One immutable usage payload waiting for idempotent delivery to IAM."""

    __tablename__ = "iam_model_usage_outbox"
    __table_args__ = (
        UniqueConstraint("request_id", name="uq_iam_model_usage_outbox_request"),
        CheckConstraint("action IN ('settle', 'report')", name="ck_iam_model_usage_outbox_action"),
        CheckConstraint("status IN ('pending', 'processing', 'delivered')", name="ck_iam_model_usage_outbox_status"),
        CheckConstraint(
            "reserved_input_tokens >= 0 AND reserved_output_tokens >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND latency_ms >= 0 AND attempt_count >= 0",
            name="ck_iam_model_usage_outbox_nonnegative",
        ),
        CheckConstraint("outcome IN ('succeeded', 'failed')", name="ck_iam_model_usage_outbox_outcome"),
        Index("ix_iam_model_usage_outbox_due", "status", "next_attempt_at"),
        Index("ix_iam_model_usage_outbox_lease", "status", "lease_until"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    request_id: Mapped[str] = mapped_column(String(180), nullable=False)
    # Persist only IAM IDs and usage facts. Prompts and credentials never enter this table.
    tenant_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    model_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    application_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    reserved_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    reserved_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    usage_is_estimated: Mapped[bool] = mapped_column(Boolean, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default=text("'pending'"))
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    lease_owner: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_class: Mapped[str | None] = mapped_column(String(120))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
