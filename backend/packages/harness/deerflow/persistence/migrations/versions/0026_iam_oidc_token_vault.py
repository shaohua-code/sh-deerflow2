"""Store encrypted IAM OIDC token envelopes for explicitly linked users.

Revision ID: 0026_iam_oidc_token_vault
Revises: 0025_user_active
Create Date: 2026-10-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_iam_oidc_token_vault"
down_revision: str | Sequence[str] | None = "0025_user_active"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the encrypted token table without backfilling legacy accounts."""
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("iam_oidc_token_vault"):
        op.create_table(
            "iam_oidc_token_vault",
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("session_id", sa.String(length=36), nullable=False),
            sa.Column("provider_id", sa.String(length=64), nullable=False),
            sa.Column("issuer", sa.String(length=512), nullable=False),
            sa.Column("subject", sa.String(length=512), nullable=False),
            sa.Column("tenant_id", sa.String(length=128), nullable=False),
            sa.Column("access_token_ciphertext", sa.Text(), nullable=False),
            sa.Column("refresh_token_ciphertext", sa.Text(), nullable=False),
            sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id", "session_id"),
        )


def downgrade() -> None:
    """Drop only the table introduced by this revision."""
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("iam_oidc_token_vault"):
        op.drop_table("iam_oidc_token_vault")
