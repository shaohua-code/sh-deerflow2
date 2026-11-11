"""为任务分页持久化当前路由授权键。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "fd_0008"
down_revision = "fd_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    schema = "product" if bind.dialect.name == "postgresql" else None
    op.add_column(
        "flowdesk_data_jobs",
        sa.Column("authorization_key", sa.String(length=64), nullable=True),
        schema=schema,
    )

    jobs = sa.table(
        "flowdesk_data_jobs",
        sa.Column("job_id", sa.String(length=36)),
        sa.Column("kind", sa.String(length=24)),
        sa.Column("scope", sa.JSON()),
        sa.Column("authorization_key", sa.String(length=64)),
        schema=schema,
    )
    rows = bind.execute(sa.select(jobs.c.job_id, jobs.c.kind, jobs.c.scope).order_by(jobs.c.job_id))
    update_key = (
        sa.update(jobs)
        .where(jobs.c.job_id == sa.bindparam("lookup_job_id"))
        .values(authorization_key=sa.bindparam("value_authorization_key"))
    )
    while batch := rows.fetchmany(500):
        values = []
        for job_id, kind, scope in batch:
            scope_key = (
                scope[0]
                if isinstance(scope, list) and scope and isinstance(scope[0], str)
                else "unknown"
            )
            kind_key = kind if isinstance(kind, str) else "unknown"
            values.append(
                {
                    "lookup_job_id": job_id,
                    "value_authorization_key": f"{kind_key}:{scope_key}",
                }
            )
        bind.execute(update_key, values)

    op.create_index(
        "ix_flowdesk_data_jobs_owner_authorization_created",
        "flowdesk_data_jobs",
        ["owner_user_id", "authorization_key", "created_at", "job_id"],
        schema=schema,
    )


def downgrade() -> None:
    schema = "product" if op.get_bind().dialect.name == "postgresql" else None
    op.drop_index(
        "ix_flowdesk_data_jobs_owner_authorization_created",
        table_name="flowdesk_data_jobs",
        schema=schema,
    )
    op.drop_column("flowdesk_data_jobs", "authorization_key", schema=schema)
