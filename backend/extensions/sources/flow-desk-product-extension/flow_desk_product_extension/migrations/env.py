"""Alembic 入口：只迁移 Flow Desk 自有表，不导入 DeerFlow ORM Base。"""

from __future__ import annotations

from alembic import context

from flow_desk_product_extension.models import metadata

config = context.config


def run_migrations_online() -> None:
    """使用 ExtensionService 传入的连接，保持共享数据库和独立版本表。"""
    connection = config.attributes.get("connection")
    if connection is None:
        raise RuntimeError("Flow Desk migrations must run through the Gateway extension service")

    def include_name(name: str | None, type_: str, _parent_names: dict[str, str]) -> bool:
        """Autogenerate 只扫描自有 schema/表，禁止拿宿主表生成删除建议。"""
        if type_ == "schema":
            return name == "product" if connection.dialect.name == "postgresql" else name is None
        if type_ == "table":
            return isinstance(name, str) and name.startswith("flowdesk_")
        return True

    context.configure(
        connection=connection,
        target_metadata=metadata,
        version_table="flowdesk_alembic_version",
        # Alembic 自己的 version table 不会应用 SQLAlchemy 的 schema map；
        # SQLite 上必须用无 schema 名称，否则它无法在第二次启动识别版本。
        version_table_schema=("product" if connection.dialect.name == "postgresql" else None),
        include_schemas=True,
        include_name=include_name,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


run_migrations_online()
