"""Copy a unified DeerFlow SQLite database into an initialized PostgreSQL target.

This deliberately does not migrate files, memory directories, JSONL run events,
separate checkpointer databases, or secrets. The default invocation is a read-only
preflight; pass ``--apply`` and the exact destination database name to write rows.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import (
    MetaData,
    Table,
    bindparam,
    create_engine,
    func,
    inspect,
    select,
    text,
)
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError

LEDGER_TABLES = frozenset(
    {
        "alembic_version",
        "flowdesk_alembic_version",
        "checkpoint_migrations",
        "sqlite_sequence",
    }
)
DEFAULT_BATCH_SIZE = 500


class MigrationRefused(RuntimeError):
    """Raised when a safe, lossless copy cannot be established in preflight."""


@dataclass(frozen=True)
class TableCopy:
    schema: str | None
    table_name: str
    source_rows: int
    source_columns: tuple[str, ...]


@dataclass(frozen=True)
class CopyPlan:
    tables: tuple[TableCopy, ...]


@dataclass(frozen=True)
class CopyResult:
    copied_rows: int
    copied_tables: int


def _is_ledger(table_name: str) -> bool:
    # 上游与 Flow Desk 分别维护 Alembic 版本；目标数据库已经执行迁移，不能覆盖版本表。
    return table_name in LEDGER_TABLES


def _destination_schema(
    table_name: str, core_schema: str | None, product_schema: str | None
) -> str | None:
    if table_name.startswith("flowdesk_") and product_schema:
        return product_schema
    return core_schema


def _reflect_table(engine: Engine, table_name: str, schema: str | None) -> Table:
    return Table(table_name, MetaData(), schema=schema, autoload_with=engine)


def _tables_in_schema(engine: Engine, schema: str | None) -> set[str]:
    return set(inspect(engine).get_table_names(schema=schema))


def _assert_target_empty(
    target_engine: Engine, schemas: tuple[str | None, ...]
) -> None:
    inspector = inspect(target_engine)
    for schema in schemas:
        for name in inspector.get_table_names(schema=schema):
            if _is_ledger(name):
                continue
            target_table = _reflect_table(target_engine, name, schema)
            with target_engine.connect() as connection:
                has_rows = connection.scalar(
                    select(func.count()).select_from(target_table)
                )
            if has_rows:
                raise MigrationRefused(
                    f"target is not empty: {schema + '.' if schema else ''}{name} contains data"
                )


def _ordered_tables(
    target_engine: Engine, tables: list[TableCopy], core_schema: str | None
) -> list[TableCopy]:
    """Order rows by foreign-key dependencies; refuse cycles rather than risk partial writes."""
    by_key = {(item.schema, item.table_name): item for item in tables}
    pending: dict[tuple[str | None, str], set[tuple[str | None, str]]] = {}
    for key, item in by_key.items():
        dependencies: set[tuple[str | None, str]] = set()
        for foreign_key in inspect(target_engine).get_foreign_keys(
            item.table_name, schema=item.schema
        ):
            referred = foreign_key.get("referred_table")
            if not referred:
                continue
            referred_schema = foreign_key.get("referred_schema") or core_schema
            candidate = (referred_schema, referred)
            if candidate in by_key:
                dependencies.add(candidate)
        pending[key] = dependencies

    ordered: list[TableCopy] = []
    while pending:
        ready = sorted(
            (key for key, dependencies in pending.items() if not dependencies),
            key=str,
        )
        if not ready:
            names = ", ".join(
                f"{schema + '.' if schema else ''}{name}"
                for schema, name in sorted(pending, key=str)
            )
            raise MigrationRefused(
                f"foreign-key cycle prevents safe row ordering: {names}"
            )
        for key in ready:
            ordered.append(by_key[key])
            pending.pop(key)
        for dependencies in pending.values():
            dependencies.difference_update(ready)
    return ordered


def plan_database_copy(
    source_engine: Engine,
    target_engine: Engine,
    *,
    core_schema: str | None = None,
    product_schema: str | None = None,
) -> CopyPlan:
    """Inspect table compatibility and report source row counts without writing."""
    source_inspector = inspect(source_engine)
    source_tables = source_inspector.get_table_names()
    target_tables_by_schema: dict[str | None, set[str]] = {}
    plans: list[TableCopy] = []

    for name in source_tables:
        if _is_ledger(name):
            continue
        schema = _destination_schema(name, core_schema, product_schema)
        if schema not in target_tables_by_schema:
            target_tables_by_schema[schema] = _tables_in_schema(target_engine, schema)
        if name not in target_tables_by_schema[schema]:
            raise MigrationRefused(
                f"source table {name!r} is missing from the target schema {schema!r}; run Gateway and product migrations first"
            )

        source_table = _reflect_table(source_engine, name, None)
        target_table = _reflect_table(target_engine, name, schema)
        source_names = tuple(column.name for column in source_table.columns)
        target_columns = {column.name: column for column in target_table.columns}
        missing_columns = set(source_names) - set(target_columns)
        if missing_columns:
            raise MigrationRefused(
                f"source column(s) {sorted(missing_columns)!r} in {name!r} have no target counterpart"
            )

        for column in target_table.columns:
            if (
                column.name in source_names
                or column.computed is not None
                or column.identity is not None
            ):
                continue
            if (
                not column.nullable
                and column.default is None
                and column.server_default is None
            ):
                raise MigrationRefused(
                    f"required target column {column.name!r} in {name!r} has no source value or default"
                )

        with source_engine.connect() as connection:
            row_count = int(
                connection.scalar(select(func.count()).select_from(source_table)) or 0
            )
        plans.append(
            TableCopy(
                schema=schema,
                table_name=name,
                source_rows=row_count,
                source_columns=source_names,
            )
        )

    ordered = _ordered_tables(target_engine, plans, core_schema)
    return CopyPlan(tables=tuple(ordered))


def _quoted_table_name(table: Table, dialect: Any) -> str:
    preparer = dialect.identifier_preparer
    name = preparer.quote(table.name)
    if table.schema:
        name = f"{preparer.quote_schema(table.schema)}.{name}"
    return name


def _copy_batch(
    target_connection: Any, target_table: Table, rows: list[dict[str, Any]]
) -> None:
    if not rows:
        return
    insert_columns = [
        column
        for column in target_table.columns
        if column.name in rows[0] and column.computed is None
    ]
    if not insert_columns:
        raise MigrationRefused(f"table {target_table.name!r} has no insertable columns")
    identity_always = any(
        column.identity is not None and column.identity.always
        for column in insert_columns
    )
    if not identity_always:
        target_connection.execute(
            target_table.insert(),
            [
                {column.name: row[column.name] for column in insert_columns}
                for row in rows
            ],
        )
        return

    # 明确写入旧 SQLite 主键；OVERRIDING SYSTEM VALUE 允许 PostgreSQL ALWAYS identity 保留关联 ID。
    dialect = target_connection.dialect
    preparer = dialect.identifier_preparer
    columns_sql = ", ".join(preparer.quote(column.name) for column in insert_columns)
    placeholders = ", ".join(f":v{index}" for index in range(len(insert_columns)))
    statement = text(
        f"INSERT INTO {_quoted_table_name(target_table, dialect)} ({columns_sql}) "
        f"OVERRIDING SYSTEM VALUE VALUES ({placeholders})"
    ).bindparams(
        *(
            bindparam(f"v{index}", type_=column.type)
            for index, column in enumerate(insert_columns)
        )
    )
    parameters = [
        {f"v{index}": row[column.name] for index, column in enumerate(insert_columns)}
        for row in rows
    ]
    target_connection.execute(statement, parameters)


def _reset_postgres_sequence(connection: Any, table: Table) -> None:
    """Make a copied integer autoincrement key continue after the imported maximum."""
    if connection.dialect.name != "postgresql" or len(table.primary_key.columns) != 1:
        return
    column = next(iter(table.primary_key.columns))
    if not column.autoincrement or column.computed is not None:
        return
    qualified = f"{table.schema}.{table.name}" if table.schema else table.name
    sequence_name = connection.scalar(
        text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
        {"table_name": qualified, "column_name": column.name},
    )
    if not sequence_name:
        return
    maximum = connection.scalar(select(func.max(column)).select_from(table))
    next_value = int(maximum) + 1 if maximum is not None else 1
    # PostgreSQL ALTER SEQUENCE is transactional; an aborted copy rolls this reset back too.
    preparer = connection.dialect.identifier_preparer
    pieces = sequence_name.split(".")
    quoted_sequence = ".".join(preparer.quote(piece.strip('"')) for piece in pieces)
    connection.execute(
        text(f"ALTER SEQUENCE {quoted_sequence} RESTART WITH {next_value}")
    )


def copy_database(
    source_engine: Engine,
    target_engine: Engine,
    *,
    core_schema: str | None = None,
    product_schema: str | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> CopyResult:
    """Copy all supported rows in one target transaction; never mutate the source."""
    if batch_size <= 0:
        raise ValueError("batch_size must be greater than zero")
    plan = plan_database_copy(
        source_engine,
        target_engine,
        core_schema=core_schema,
        product_schema=product_schema,
    )
    # 即使来源没有 product 表，也要阻止将数据合并进已含业务行的目标 schema。
    schemas = tuple(
        dict.fromkeys(
            (core_schema, product_schema, *(item.schema for item in plan.tables))
        )
    )

    copied_rows = 0
    with target_engine.begin() as target_connection:
        # Check and write under the same target transaction so a partially seeded DB is never merged.
        inspector = inspect(target_connection)
        for schema in schemas:
            for name in inspector.get_table_names(schema=schema):
                if _is_ledger(name):
                    continue
                table = _reflect_table(target_engine, name, schema)
                if target_connection.scalar(select(func.count()).select_from(table)):
                    raise MigrationRefused(
                        f"target is not empty: {schema + '.' if schema else ''}{name} contains data"
                    )

        with source_engine.connect() as source_connection:
            # 同一只读事务为所有表提供一致快照，避免复制时读到不同时间点的数据。
            with source_connection.begin():
                for item in plan.tables:
                    source_table = _reflect_table(source_engine, item.table_name, None)
                    target_table = _reflect_table(
                        target_engine, item.table_name, item.schema
                    )
                    table_copied_rows = 0
                    result = source_connection.execution_options(
                        stream_results=True
                    ).execute(select(source_table))
                    while batch := result.fetchmany(batch_size):
                        rows = [dict(row._mapping) for row in batch]
                        _copy_batch(target_connection, target_table, rows)
                        batch_rows = len(rows)
                        copied_rows += batch_rows
                        table_copied_rows += batch_rows
                    if table_copied_rows != item.source_rows:
                        raise MigrationRefused(
                            f"source row count changed for {item.table_name!r} between preflight and copy"
                        )
                    target_rows = int(
                        target_connection.scalar(
                            select(func.count()).select_from(target_table)
                        )
                        or 0
                    )
                    if target_rows != item.source_rows:
                        raise MigrationRefused(
                            f"copied row count mismatch for {item.table_name!r}: "
                            f"expected {item.source_rows}, found {target_rows}"
                        )
                    _reset_postgres_sequence(target_connection, target_table)

    return CopyResult(copied_rows=copied_rows, copied_tables=len(plan.tables))


def _readonly_sqlite_engine(path: Path) -> Engine:
    uri = f"{path.resolve().as_uri()}?mode=ro"
    # 使用 sqlite3 URI mode=ro，避免误把拼写错误的路径当作空数据库创建出来。
    return create_engine(
        "sqlite+pysqlite://", creator=lambda: sqlite3.connect(uri, uri=True)
    )


def _safe_target_label(url: str) -> tuple[str, str]:
    parsed = make_url(url)
    database_name = parsed.database or ""
    return parsed.render_as_string(hide_password=True), database_name


def _load_runtime_config() -> Any:
    try:
        from deerflow.config.app_config import get_app_config
    except ImportError as exc:
        raise MigrationRefused(
            "cannot import DeerFlow config; run this command from backend with the installed project environment"
        ) from exc
    return get_app_config()


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preflight or copy the unified DeerFlow SQLite database to PostgreSQL."
    )
    parser.add_argument(
        "--source-sqlite",
        required=True,
        type=Path,
        help="Path to the stopped/consistent deerflow.db source file",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the copy; without this flag the command is read-only",
    )
    parser.add_argument(
        "--confirm-target",
        help="Must exactly match the PostgreSQL database name when --apply is used",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Rows per batch (default: {DEFAULT_BATCH_SIZE})",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _argument_parser()
    args = parser.parse_args(argv)
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than zero")
    source_path = args.source_sqlite.expanduser().resolve()
    if not source_path.is_file():
        parser.error(f"SQLite source file does not exist: {source_path}")

    source_engine: Engine | None = None
    target_engine: Engine | None = None
    try:
        config = _load_runtime_config()
        database = config.database
        if database.backend != "postgres" or not database.postgres_url:
            raise MigrationRefused(
                "target config must set database.backend: postgres and database.postgres_url"
            )
        if config.checkpointer is not None and config.checkpointer.type == "sqlite":
            raise MigrationRefused(
                "a separately configured SQLite checkpointer is unsupported; migrate that checkpoint database separately before cutover"
            )
        target_url = database.app_sync_sqlalchemy_url
        safe_label, database_name = _safe_target_label(target_url)
        if args.apply and args.confirm_target != database_name:
            raise MigrationRefused(
                f"--apply requires --confirm-target {database_name!r} to match the configured target database"
            )
        if not args.apply and args.confirm_target:
            raise MigrationRefused(
                "--confirm-target is only valid together with --apply"
            )

        source_engine = _readonly_sqlite_engine(source_path)
        target_engine = create_engine(target_url, pool_pre_ping=True)
        core_schema = database.postgres_schema or None
        # Flow Desk owns a distinct migration schema; the extension must be installed before preflight.
        product_schema = "product"
        plan = plan_database_copy(
            source_engine,
            target_engine,
            core_schema=core_schema,
            product_schema=product_schema,
        )
        _assert_target_empty(
            target_engine, tuple(dict.fromkeys((core_schema, product_schema)))
        )

        print(f"Source SQLite: {source_path}")
        print(f"Target PostgreSQL: {safe_label}")
        print(
            f"Plan: {len(plan.tables)} tables, {sum(table.source_rows for table in plan.tables)} rows"
        )
        for item in plan.tables:
            location = (
                f"{item.schema}.{item.table_name}" if item.schema else item.table_name
            )
            print(f"  {location}: {item.source_rows} rows")
        if not args.apply:
            print(
                "Preflight only; no data was written. Stop Gateway and rerun with --apply --confirm-target <database-name> to copy."
            )
            return 0

        result = copy_database(
            source_engine,
            target_engine,
            core_schema=core_schema,
            product_schema=product_schema,
            batch_size=args.batch_size,
        )
        print(
            f"Copy complete: {result.copied_rows} rows across {result.copied_tables} tables."
        )
        print(
            "Source SQLite was opened read-only. Validate account, thread, checkpoint, and extension data before cutover."
        )
        return 0
    except MigrationRefused as exc:
        print(
            f"Migration refused or failed: {type(exc).__name__}: {exc}", file=sys.stderr
        )
        return 2
    except (SQLAlchemyError, OSError, ValueError) as exc:
        # 驱动异常可能包含连接信息；只报告异常类型，避免把 URL/凭据写进终端记录。
        print(
            f"Migration failed: {type(exc).__name__}. Connection details were suppressed.",
            file=sys.stderr,
        )
        return 2
    finally:
        if source_engine is not None:
            source_engine.dispose()
        if target_engine is not None:
            target_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
