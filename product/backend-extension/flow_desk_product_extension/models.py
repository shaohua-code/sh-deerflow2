"""产品扩展自己的 SQLAlchemy MetaData 与数据表定义。"""

from __future__ import annotations

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Table,
    Text,
    UniqueConstraint,
)

# 不能把产品表注册到 DeerFlow 的 Base.metadata：否则关闭产品扩展时，
# Gateway 仍可能由自己的 create_all 意外创建或管理这些表。
metadata = MetaData(schema="product")

user_settings = Table(
    "flowdesk_user_settings",
    metadata,
    Column("user_id", String(255), nullable=False),
    Column("setting_key", String(64), nullable=False),
    Column("value", JSON, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    PrimaryKeyConstraint(
        "user_id",
        "setting_key",
        name="pk_flowdesk_user_settings",
    ),
)

# 部署级的可在线编辑展示配置只存白名单字段，不接受运行路径或凭据。
product_settings = Table(
    "flowdesk_product_settings",
    metadata,
    Column("setting_key", String(64), primary_key=True),
    Column("value", JSON, nullable=False),
    Column("config_version", Integer, nullable=False),
    Column("updated_by", String(255), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

# 审计表只保存产品操作元数据；绝不复制设置值、对话正文或认证凭据。
audit_events = Table(
    "flowdesk_audit_events",
    metadata,
    Column("event_id", String(36), primary_key=True),
    Column("actor_user_id", String(255), nullable=False, index=True),
    Column("action", String(100), nullable=False),
    Column("resource_type", String(100), nullable=False),
    Column("resource_id", String(255), nullable=False),
    Column("outcome", String(32), nullable=False),
    Column("occurred_at", DateTime(timezone=True), nullable=False, index=True),
    Column("request_id", String(128), nullable=True),
)

# 任务只保存执行状态、游标和最终结果引用；不得把消息正文或凭据塞进 JSON。
data_jobs = Table(
    "flowdesk_data_jobs",
    metadata,
    Column("job_id", String(36), nullable=False),
    Column("owner_user_id", String(255), nullable=False),
    Column("kind", String(24), nullable=False),
    # 数据任务列表按这个路由授权键先过滤，再分页；nullable 供旧进程滚动升级期间兼容。
    Column("authorization_key", String(64), nullable=True),
    Column("idempotency_key", String(128), nullable=False),
    Column("request_id", String(128), nullable=True),
    Column("scope", JSON, nullable=False),
    Column("status", String(24), nullable=False),
    Column("progress", JSON, nullable=False),
    Column("result", JSON, nullable=True),
    Column("error_code", String(80), nullable=True),
    Column("attempt", Integer, nullable=False),
    Column("max_attempts", Integer, nullable=False),
    Column("available_at", DateTime(timezone=True), nullable=False),
    Column("lease_owner", String(128), nullable=True),
    Column("lease_token", String(36), nullable=True),
    Column("lease_expires_at", DateTime(timezone=True), nullable=True),
    Column("cancel_requested", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    PrimaryKeyConstraint("job_id", name="pk_flowdesk_data_jobs"),
    UniqueConstraint(
        "owner_user_id",
        "idempotency_key",
        name="uq_flowdesk_data_jobs_owner_idempotency",
    ),
    CheckConstraint("kind IN ('export', 'deletion')", name="ck_flowdesk_data_jobs_kind"),
    CheckConstraint(
        "status IN ('queued', 'running', 'retry_wait', 'completed', 'partial', "
        "'failed', 'cancelled')",
        name="ck_flowdesk_data_jobs_status",
    ),
    CheckConstraint("attempt >= 0 AND max_attempts >= 1", name="ck_flowdesk_data_jobs_attempts"),
    schema="product",
)
data_job_rate_limits = Table(
    "flowdesk_data_job_rate_limits",
    metadata,
    Column("owner_user_id", String(255), primary_key=True),
    Column("window_started_at", DateTime(timezone=True), nullable=False),
    Column("request_count", Integer, nullable=False),
    CheckConstraint("request_count >= 0", name="ck_flowdesk_data_job_rate_count"),
    schema="product",
)

# 文件目录只持久化 Gateway 已按 owner 投影的元数据，不保存文件正文或宿主路径。
# 状态行保存当前快照与刷新租约；entry 用 SHA-256 键避免长工作区相对路径撑大索引。
file_catalog_state = Table(
    "flowdesk_file_catalog_state",
    metadata,
    Column("owner_user_id", String(255), primary_key=True),
    Column("snapshot_id", String(36), nullable=True),
    Column("indexed_at", DateTime(timezone=True), nullable=True),
    Column("last_attempt_at", DateTime(timezone=True), nullable=True),
    Column("refresh_token", String(36), nullable=True),
    Column("refresh_lease_expires_at", DateTime(timezone=True), nullable=True),
    Column("refresh_failed", Boolean, nullable=False),
    Column("truncated", Boolean, nullable=False),
    Column("failed_count", Integer, nullable=False),
    Column("coverage_notes", JSON, nullable=False),
    CheckConstraint(
        "failed_count >= 0",
        name="ck_flowdesk_file_catalog_state_failed_count",
    ),
    schema="product",
)

file_catalog_entries = Table(
    "flowdesk_file_catalog_entries",
    metadata,
    Column("owner_user_id", String(255), nullable=False),
    Column("snapshot_id", String(36), nullable=False),
    Column("entry_hash", String(64), nullable=False),
    Column("file_id", Text, nullable=False),
    Column("source", String(32), nullable=False),
    Column("name", Text, nullable=False),
    Column("size_bytes", BigInteger, nullable=False),
    Column("artifact_url", Text, nullable=False),
    Column("modified_at", Float, nullable=True),
    Column("storage_name", Text, nullable=True),
    Column("thread_id", Text, nullable=True),
    Column("thread_name", Text, nullable=True),
    Column("project_id", Text, nullable=True),
    Column("project_name", Text, nullable=True),
    Column("document_id", Text, nullable=True),
    PrimaryKeyConstraint(
        "owner_user_id",
        "snapshot_id",
        "entry_hash",
        name="pk_flowdesk_file_catalog_entries",
    ),
    CheckConstraint(
        "source IN ('thread_upload', 'thread_output', 'thread_workspace', 'project_document')",
        name="ck_flowdesk_file_catalog_entries_source",
    ),
    CheckConstraint(
        "size_bytes >= 0",
        name="ck_flowdesk_file_catalog_entries_size",
    ),
    schema="product",
)
Index(
    "ix_flowdesk_file_catalog_entries_owner_snapshot",
    file_catalog_entries.c.owner_user_id,
    file_catalog_entries.c.snapshot_id,
)
Index(
    "ix_flowdesk_data_jobs_dispatch",
    data_jobs.c.status,
    data_jobs.c.available_at,
    data_jobs.c.created_at,
)
Index("ix_flowdesk_data_jobs_owner_created", data_jobs.c.owner_user_id, data_jobs.c.created_at)
Index(
    "ix_flowdesk_data_jobs_owner_authorization_created",
    data_jobs.c.owner_user_id,
    data_jobs.c.authorization_key,
    data_jobs.c.created_at,
    data_jobs.c.job_id,
)
Index(
    "uq_flowdesk_data_jobs_active_owner",
    data_jobs.c.owner_user_id,
    unique=True,
    postgresql_where=data_jobs.c.status.in_(("queued", "running", "retry_wait")),
    sqlite_where=data_jobs.c.status.in_(("queued", "running", "retry_wait")),
)
