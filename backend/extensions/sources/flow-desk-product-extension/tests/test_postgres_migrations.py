from __future__ import annotations

import os
from uuid import uuid4

import pytest
from deerflow_extension_api import ExtensionRuntimeDeps
from sqlalchemy import inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from flow_desk_product_extension.settings import ProductSettingsStore


def _postgres_test_url() -> URL:
    if os.environ.get("FLOWDESK_TEST_POSTGRES") != "1":
        pytest.skip("Set FLOWDESK_TEST_POSTGRES=1 to opt into the disposable PostgreSQL check")

    configured_url = os.environ.get("TEST_POSTGRES_URI")
    if not configured_url:
        pytest.fail("TEST_POSTGRES_URI is required for the opted-in PostgreSQL check")

    try:
        url = make_url(configured_url)
    except ArgumentError:
        pytest.fail("TEST_POSTGRES_URI is not a valid SQLAlchemy URL")
    if (
        url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.database != "deerflow_test"
        or url.drivername not in {"postgresql", "postgresql+asyncpg"}
    ):
        pytest.fail(
            "Refusing PostgreSQL migration test outside localhost/deerflow_test with asyncpg"
        )

    # The service URL comes from the backend test harness and may carry psycopg's
    # sslmode query. The CI service is loopback-only, so asyncpg uses its defaults.
    return url.set(drivername="postgresql+asyncpg", query={})


def test_postgres_check_refuses_to_run_without_opt_in(monkeypatch) -> None:
    monkeypatch.delenv("FLOWDESK_TEST_POSTGRES", raising=False)
    monkeypatch.setenv(
        "TEST_POSTGRES_URI",
        "postgresql://deerflow:deerflow@localhost:5432/deerflow_test",
    )

    with pytest.raises(pytest.skip.Exception):
        _postgres_test_url()


@pytest.mark.parametrize(
    "configured_url",
    [
        "postgresql://deerflow:deerflow@database.example:5432/deerflow_test",
        "postgresql://deerflow:deerflow@localhost:5432/deerflow",
    ],
)
def test_postgres_check_refuses_remote_or_non_test_databases(
    monkeypatch,
    configured_url: str,
) -> None:
    monkeypatch.setenv("FLOWDESK_TEST_POSTGRES", "1")
    monkeypatch.setenv("TEST_POSTGRES_URI", configured_url)

    with pytest.raises(pytest.fail.Exception, match="Refusing PostgreSQL migration test"):
        _postgres_test_url()


def test_postgres_check_normalizes_only_a_loopback_test_url(monkeypatch) -> None:
    monkeypatch.setenv("FLOWDESK_TEST_POSTGRES", "1")
    monkeypatch.setenv(
        "TEST_POSTGRES_URI",
        "postgresql://deerflow:deerflow@localhost:5432/deerflow_test?sslmode=disable",
    )

    url = _postgres_test_url()

    assert url.drivername == "postgresql+asyncpg"
    assert url.host == "localhost"
    assert url.database == "deerflow_test"
    assert not url.query


@pytest.mark.asyncio
async def test_postgres_migration_is_isolated_and_idempotent() -> None:
    """在明确标记的本机/CI 临时库中验证独立 schema 和启动迁移。"""
    url = _postgres_test_url()
    engine = create_async_engine(url, poolclass=NullPool)
    store = ProductSettingsStore()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    owner_id = f"flowdesk-ci-{uuid4().hex}"

    try:
        deps = ExtensionRuntimeDeps(session_factory=session_factory)
        await store.start(deps)
        # 第二次启动必须读取现有 fd_0007，而不是重建表或卡住 advisory lock。
        await store.start(deps)
        await store.put_for_user(owner_id, "ci-smoke", {"migration": "fd_0007"})
        assert await store.list_for_user(owner_id) == [
            {"key": "ci-smoke", "value": {"migration": "fd_0007"}}
        ]

        async with engine.connect() as connection:
            product_tables = await connection.run_sync(
                lambda sync_connection: set(
                    inspect(sync_connection).get_table_names(schema="product")
                )
            )
            revision = await connection.scalar(
                text("SELECT version_num FROM product.flowdesk_alembic_version")
            )

        assert {
            "flowdesk_user_settings",
            "flowdesk_audit_events",
            "flowdesk_product_settings",
            "flowdesk_data_jobs",
            "flowdesk_data_job_rate_limits",
            "flowdesk_file_catalog_state",
            "flowdesk_file_catalog_entries",
            "flowdesk_alembic_version",
        } <= product_tables
        assert revision == "fd_0007"
    finally:
        await store.stop()
        await engine.dispose()
