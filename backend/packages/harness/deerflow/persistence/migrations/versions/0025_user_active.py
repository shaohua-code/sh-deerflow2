"""Add the Gateway-managed user account status flag.

Revision ID: 0025_user_active
Revises: 0024_project_documents
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from deerflow.persistence.migrations._helpers import safe_add_column, safe_drop_column

revision: str = "0025_user_active"
down_revision: str | Sequence[str] | None = "0024_project_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Old rows become active when the column is added. The server default also
    # covers old writers during a rolling deploy and matches fresh create_all.
    safe_add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    safe_drop_column("users", "is_active")
