"""Regression tests for databases stamped past the run-change migration hole."""

from __future__ import annotations

import asyncio

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from deerflow.persistence.bootstrap import _MIGRATIONS_DIR, _get_alembic_config, _get_head_revision
from deerflow.persistence.run import RunRepository

pytestmark = pytest.mark.asyncio

REVISION = "fd_0027_repair_run_change_seq"
PREVIOUS = "0026_iam_oidc_token_vault"
LEGACY_STAMP = "0024_project_documents"


async def test_repair_revision_is_the_single_head_after_product_migrations():
    script = ScriptDirectory(str(_MIGRATIONS_DIR))

    assert script.get_heads() == [REVISION]
    assert script.get_revision(REVISION).down_revision == PREVIOUS
    assert _get_head_revision() == REVISION


async def test_upgrade_repairs_run_change_schema_skipped_by_existing_stamp(tmp_path):
    """A DB stamped at 0024 may still lack schema added earlier in history."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'repair-run-change-seq.db'}")
    cfg = _get_alembic_config(engine)
    try:
        await asyncio.to_thread(command.upgrade, cfg, LEGACY_STAMP)
        async with engine.begin() as connection:
            await connection.execute(
                sa.text(
                    "INSERT INTO runs "
                    "(run_id, thread_id, user_id, status, operation_kind, metadata_json, "
                    "kwargs_json, multitask_strategy, message_count, total_input_tokens, "
                    "total_output_tokens, total_tokens, llm_call_count, lead_agent_tokens, "
                    "subagent_tokens, middleware_tokens, created_at, updated_at) "
                    "VALUES ('legacy-run', 'thread-legacy', 'user-1', 'pending', 'run', '{}', '{}', "
                    "'reject', 0, 0, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            await connection.execute(sa.text("DROP INDEX ix_runs_user_change_seq"))
            await connection.execute(sa.text("DROP INDEX ix_runs_change_seq"))
            await connection.execute(sa.text("ALTER TABLE runs DROP COLUMN change_seq"))
            await connection.execute(sa.text("DROP TABLE run_change_clock"))

        # Simulate an older deployed DB whose Alembic stamp says the earlier
        # revision ran even though the run-change schema was skipped.
        await asyncio.to_thread(command.upgrade, cfg, REVISION)

        async with engine.connect() as connection:
            columns = await connection.run_sync(lambda sync_connection: {column["name"] for column in sa.inspect(sync_connection).get_columns("runs")})
            tables = await connection.run_sync(lambda sync_connection: set(sa.inspect(sync_connection).get_table_names()))
            indexes = await connection.run_sync(lambda sync_connection: {index["name"] for index in sa.inspect(sync_connection).get_indexes("runs")})
            legacy_seq = await connection.scalar(sa.text("SELECT change_seq FROM runs WHERE run_id = 'legacy-run'"))

        assert "change_seq" in columns
        assert "run_change_clock" in tables
        assert {"ix_runs_change_seq", "ix_runs_user_change_seq"} <= indexes
        assert legacy_seq == 0

        factory = async_sessionmaker(engine, expire_on_commit=False)
        repository = RunRepository(factory)
        changed = await repository.list_changed(
            after_change_seq=-1,
            after_run_id="",
            user_id="user-1",
            limit=10,
        )
        assert [(row["change_seq"], row["run_id"]) for row in changed] == [(0, "legacy-run")]

        await repository.update_status("legacy-run", "error")
        changed = await repository.list_changed(
            after_change_seq=0,
            after_run_id="legacy-run",
            user_id="user-1",
            limit=10,
        )
        assert [row["run_id"] for row in changed] == ["legacy-run"]
        assert changed[0]["change_seq"] > 0
    finally:
        await engine.dispose()
