"""Migration tests for 0025_user_active account lifecycle state."""

from __future__ import annotations

import asyncio

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.ext.asyncio import create_async_engine

from deerflow.persistence.bootstrap import _get_alembic_config

pytestmark = pytest.mark.asyncio

REVISION = "0025_user_active"
PREVIOUS = "0024_project_documents"


async def test_0025_migration_file_remains_in_the_chain():
    """Later additive migrations must not make the 0025 revision disappear."""
    from pathlib import Path

    versions = Path(__file__).parents[1] / "packages" / "harness" / "deerflow" / "persistence" / "migrations" / "versions"
    assert (versions / f"{REVISION}.py").is_file()


async def test_0025_adds_active_flag_to_existing_users_as_enabled_by_default(tmp_path):
    """Existing accounts remain usable after a forward migration."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'user-active.db'}")
    cfg = _get_alembic_config(engine)
    try:
        await asyncio.to_thread(command.upgrade, cfg, PREVIOUS)
        async with engine.begin() as connection:
            await connection.execute(
                sa.text(
                    "INSERT INTO users "
                    "(id, email, password_hash, system_role, created_at, oauth_provider, oauth_id, needs_setup, token_version) "
                    "VALUES ('legacy-user', 'legacy@example.com', NULL, 'user', CURRENT_TIMESTAMP, NULL, NULL, 0, 0)"
                )
            )

        await asyncio.to_thread(command.upgrade, cfg, REVISION)
        async with engine.connect() as connection:
            is_active = await connection.scalar(sa.text("SELECT is_active FROM users WHERE id = 'legacy-user'"))
        assert is_active in (True, 1)
    finally:
        await engine.dispose()
