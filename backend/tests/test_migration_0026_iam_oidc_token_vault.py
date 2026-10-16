"""Migration tests for the encrypted IAM OIDC token vault table."""

from __future__ import annotations

import asyncio

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import create_async_engine

from deerflow.persistence.bootstrap import _MIGRATIONS_DIR, _get_alembic_config

pytestmark = pytest.mark.asyncio

REVISION = "0026_iam_oidc_token_vault"
PREVIOUS = "0025_user_active"


async def test_0026_remains_in_the_single_head_chain():
    script = ScriptDirectory(str(_MIGRATIONS_DIR))

    assert script.get_revision(REVISION).down_revision == PREVIOUS
    assert len(script.get_heads()) == 1
    assert REVISION in {revision.revision for revision in script.walk_revisions()}


async def test_0026_creates_user_cascaded_encrypted_token_storage(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'iam-token-vault.db'}")
    cfg = _get_alembic_config(engine)
    try:
        await asyncio.to_thread(command.upgrade, cfg, PREVIOUS)
        await asyncio.to_thread(command.upgrade, cfg, REVISION)

        async with engine.connect() as connection:
            columns = await connection.run_sync(lambda sync_connection: {column["name"]: column for column in sa.inspect(sync_connection).get_columns("iam_oidc_token_vault")})
            foreign_keys = await connection.run_sync(lambda sync_connection: sa.inspect(sync_connection).get_foreign_keys("iam_oidc_token_vault"))
            primary_key = await connection.run_sync(lambda sync_connection: sa.inspect(sync_connection).get_pk_constraint("iam_oidc_token_vault"))

        assert set(columns) == {
            "user_id",
            "session_id",
            "provider_id",
            "issuer",
            "subject",
            "tenant_id",
            "access_token_ciphertext",
            "refresh_token_ciphertext",
            "access_expires_at",
            "refresh_expires_at",
            "created_at",
            "updated_at",
        }
        assert columns["access_token_ciphertext"]["nullable"] is False
        assert columns["refresh_token_ciphertext"]["nullable"] is False
        assert foreign_keys == [
            {
                "name": None,
                "constrained_columns": ["user_id"],
                "referred_schema": None,
                "referred_table": "users",
                "referred_columns": ["id"],
                "options": {"ondelete": "CASCADE"},
            }
        ]
        assert primary_key["constrained_columns"] == ["user_id", "session_id"]
    finally:
        await engine.dispose()
