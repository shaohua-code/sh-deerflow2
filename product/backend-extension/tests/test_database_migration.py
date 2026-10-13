from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    event,
    func,
    inspect,
    select,
)
from sqlalchemy.exc import IntegrityError, OperationalError

MODULE_PATH = Path(__file__).resolve().parents[2] / "deploy" / "migrate_sqlite_to_postgres.py"
SPEC = importlib.util.spec_from_file_location("flowdesk_sqlite_to_postgres", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
migrator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = migrator
SPEC.loader.exec_module(migrator)


def _make_source(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'source.sqlite'}")
    metadata = MetaData()
    users = Table(
        "users",
        metadata,
        Column("id", String(36), primary_key=True),
        Column("email", String(255), nullable=False),
    )
    threads = Table(
        "threads_meta",
        metadata,
        Column("thread_id", String(36), primary_key=True),
        Column("user_id", String(36), ForeignKey("users.id"), nullable=False),
    )
    product = Table(
        "flowdesk_user_settings",
        metadata,
        Column("user_id", String(36), primary_key=True),
        Column("setting_key", String(64), primary_key=True),
        Column("value", String, nullable=False),
    )
    version = Table(
        "alembic_version", metadata, Column("version_num", String(32), primary_key=True)
    )
    product_version = Table(
        "flowdesk_alembic_version", metadata, Column("version_num", String(32), primary_key=True)
    )
    checkpoint_version = Table(
        "checkpoint_migrations", metadata, Column("v", Integer, primary_key=True)
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(users.insert(), [{"id": "alice", "email": "alice@example.test"}])
        connection.execute(threads.insert(), [{"thread_id": "thread-1", "user_id": "alice"}])
        connection.execute(
            product.insert(), [{"user_id": "alice", "setting_key": "density", "value": '"compact"'}]
        )
        connection.execute(version.insert(), [{"version_num": "0025_user_active"}])
        connection.execute(product_version.insert(), [{"version_num": "0006_data_job_rate_limits"}])
        connection.execute(checkpoint_version.insert(), [{"v": 3}])
    return engine


def _make_target(tmp_path: Path, *, extra_columns: bool = False):
    engine = create_engine(f"sqlite:///{tmp_path / 'target.sqlite'}")
    metadata = MetaData()
    Table(
        "users",
        metadata,
        Column("id", String(36), primary_key=True),
        Column("email", String(255), nullable=False),
    )
    Table(
        "threads_meta",
        metadata,
        Column("thread_id", String(36), primary_key=True),
        Column("user_id", String(36), ForeignKey("users.id"), nullable=False),
    )
    setting_columns = [
        Column("user_id", String(36), primary_key=True),
        Column("setting_key", String(64), primary_key=True),
        Column("value", String, nullable=False),
    ]
    if extra_columns:
        setting_columns.append(Column("deployment_note", String, nullable=True))
    Table("flowdesk_user_settings", metadata, *setting_columns)
    metadata.create_all(engine)
    return engine


def _make_schema_target(tmp_path: Path):
    """SQLite attached DBs stand in for the core and product PostgreSQL schemas."""
    engine = create_engine(f"sqlite:///{tmp_path / 'schema-target.sqlite'}")
    product_path = tmp_path / "product-schema.sqlite"

    @event.listens_for(engine, "connect")
    def attach_product_schema(dbapi_connection, _connection_record):
        dbapi_connection.execute("ATTACH DATABASE ? AS product", (str(product_path),))

    metadata = MetaData()
    Table(
        "users",
        metadata,
        Column("id", String(36), primary_key=True),
        Column("email", String(255), nullable=False),
    )
    Table(
        "threads_meta",
        metadata,
        Column("thread_id", String(36), primary_key=True),
        Column("user_id", String(36), ForeignKey("users.id"), nullable=False),
    )
    Table(
        "flowdesk_user_settings",
        metadata,
        Column("user_id", String(36), primary_key=True),
        Column("setting_key", String(64), primary_key=True),
        Column("value", String, nullable=False),
        schema="product",
    )
    metadata.create_all(engine)
    return engine


def test_plan_is_read_only_and_excludes_all_migration_ledgers(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path)

    plan = migrator.plan_database_copy(source, target, core_schema=None, product_schema=None)

    names = [item.table_name for item in plan.tables]
    assert set(names) == {"users", "threads_meta", "flowdesk_user_settings"}
    assert [item.table_name for item in plan.tables].index("users") < [
        item.table_name for item in plan.tables
    ].index("threads_meta")
    assert all(item.source_rows > 0 for item in plan.tables)
    with target.connect() as connection:
        assert (
            connection.scalar(
                select(func.count()).select_from(Table("users", MetaData(), autoload_with=target))
            )
            == 0
        )


def test_apply_copies_rows_but_keeps_source_and_migration_ledgers_untouched(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path)

    result = migrator.copy_database(source, target, core_schema=None, product_schema=None)

    assert result.copied_rows == 3
    with source.connect() as connection:
        assert (
            connection.scalar(
                select(func.count()).select_from(Table("users", MetaData(), autoload_with=source))
            )
            == 1
        )
        assert (
            connection.scalar(
                select(func.count()).select_from(
                    Table("alembic_version", MetaData(), autoload_with=source)
                )
            )
            == 1
        )
    with target.connect() as connection:
        settings = Table("flowdesk_user_settings", MetaData(), autoload_with=target)
        assert connection.execute(select(settings.c.value)).scalar_one() == '"compact"'
        assert (
            connection.scalar(
                select(func.count()).select_from(
                    Table("threads_meta", MetaData(), autoload_with=target)
                )
            )
            == 1
        )
        assert "alembic_version" not in inspect(target).get_table_names()


def test_flowdesk_tables_are_routed_into_product_schema(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_schema_target(tmp_path)

    plan = migrator.plan_database_copy(source, target, core_schema=None, product_schema="product")
    product_item = next(item for item in plan.tables if item.table_name == "flowdesk_user_settings")
    assert product_item.schema == "product"

    result = migrator.copy_database(source, target, core_schema=None, product_schema="product")

    assert result.copied_rows == 3
    with target.connect() as connection:
        settings = Table(
            "flowdesk_user_settings", MetaData(), schema="product", autoload_with=target
        )
        assert connection.execute(select(settings.c.value)).scalar_one() == '"compact"'


def test_apply_checks_all_target_schemas(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_schema_target(tmp_path)
    with source.begin() as connection:
        connection.exec_driver_sql("DROP TABLE flowdesk_user_settings")
    settings = Table("flowdesk_user_settings", MetaData(), schema="product", autoload_with=target)
    with target.begin() as connection:
        connection.execute(
            settings.insert(),
            {"user_id": "seed", "setting_key": "density", "value": '"compact"'},
        )

    with pytest.raises(migrator.MigrationRefused, match="not empty"):
        migrator.copy_database(source, target, core_schema=None, product_schema="product")

    with target.connect() as connection:
        users = Table("users", MetaData(), autoload_with=target)
        assert connection.scalar(select(func.count()).select_from(users)) == 0


def test_apply_refuses_nonempty_target_before_copying_any_table(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path)
    users = Table("users", MetaData(), autoload_with=target)
    with target.begin() as connection:
        connection.execute(users.insert(), {"id": "seed", "email": "seed@example.test"})

    with pytest.raises(migrator.MigrationRefused, match="not empty"):
        migrator.copy_database(source, target, core_schema=None, product_schema=None)

    with target.connect() as connection:
        threads = Table("threads_meta", MetaData(), autoload_with=target)
        assert connection.scalar(select(func.count()).select_from(threads)) == 0


def test_apply_rolls_back_all_tables_if_a_later_table_fails(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path)
    with target.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TRIGGER reject_thread BEFORE INSERT ON threads_meta "
            "BEGIN SELECT RAISE(ABORT, 'simulated copy failure'); END"
        )

    with pytest.raises(IntegrityError, match="simulated copy failure"):
        migrator.copy_database(source, target, core_schema=None, product_schema=None)

    with target.connect() as connection:
        users = Table("users", MetaData(), autoload_with=target)
        assert connection.scalar(select(func.count()).select_from(users)) == 0


def test_apply_rolls_back_if_source_changes_after_preflight(tmp_path: Path, monkeypatch) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path)
    original_plan = migrator.plan_database_copy

    def change_source_after_preflight(*args, **kwargs):
        plan = original_plan(*args, **kwargs)
        users = Table("users", MetaData(), autoload_with=source)
        with source.begin() as connection:
            connection.execute(users.insert(), {"id": "bob", "email": "bob@example.test"})
        return plan

    monkeypatch.setattr(migrator, "plan_database_copy", change_source_after_preflight)

    with pytest.raises(migrator.MigrationRefused, match="source row count changed"):
        migrator.copy_database(source, target, core_schema=None, product_schema=None)

    with target.connect() as connection:
        users = Table("users", MetaData(), autoload_with=target)
        assert connection.scalar(select(func.count()).select_from(users)) == 0


def test_cli_source_engine_opens_sqlite_read_only(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    path = Path(source.url.database)
    source.dispose()
    readonly = migrator._readonly_sqlite_engine(path)
    try:
        with readonly.begin() as connection:
            with pytest.raises(OperationalError, match="readonly"):
                connection.exec_driver_sql(
                    "INSERT INTO users (id, email) VALUES ('x', 'x@example.test')"
                )
    finally:
        readonly.dispose()


def test_plan_refuses_source_tables_missing_from_migrated_target(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path)
    with source.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE unsupported_extension_table (id INTEGER PRIMARY KEY)"
        )
        connection.exec_driver_sql("INSERT INTO unsupported_extension_table (id) VALUES (1)")

    with pytest.raises(migrator.MigrationRefused, match="missing from the target"):
        migrator.plan_database_copy(source, target, core_schema=None, product_schema=None)


def test_plan_refuses_unmappable_source_columns(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path)
    with source.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE users ADD COLUMN legacy_payload TEXT")

    with pytest.raises(migrator.MigrationRefused, match="source column"):
        migrator.plan_database_copy(source, target, core_schema=None, product_schema=None)


def test_plan_refuses_required_target_columns_without_source_or_default(tmp_path: Path) -> None:
    source = _make_source(tmp_path)
    target = _make_target(tmp_path, extra_columns=True)
    with target.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE users ADD COLUMN optional_target_value TEXT NULL")
        connection.exec_driver_sql(
            "ALTER TABLE threads_meta ADD COLUMN required_target_value TEXT NOT NULL"
        )

    with pytest.raises(migrator.MigrationRefused, match="required target column"):
        migrator.plan_database_copy(source, target, core_schema=None, product_schema=None)
