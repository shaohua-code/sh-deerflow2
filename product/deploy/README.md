# Flow Desk 部署方案

默认 DeerFlow 服务栈主要面向开发。此部署方案增加自有 PostgreSQL 16 服务，并让 Gateway 将应用数据、LangGraph checkpoint、运行事件和 Custom Agent 定义持久化到该数据库。

## 配置与启动

1. 检出已经在测试环境验证过的产品版本，并安装 Docker Engine 与 Compose 插件。生产主机不需要本地 Node.js、Python 或 `make install` 开发依赖。
2. 若运行配置不存在，依据仓库模板创建根目录 `.env`、`config.yaml`、`extensions_config.json` 和 `frontend/.env`。将 `config.postgres.fragment.yaml` 合并到被 Git 忽略的根目录 `config.yaml`，并保留当前 checkout 的 `config.example.yaml` 中的 `config_version`。
3. 在根目录 `.env` 中填入 `DEER_FLOW_CONFIG_PATH`、`DEER_FLOW_EXTENSIONS_CONFIG_PATH` 和 `DEER_FLOW_HOME` 的绝对路径，并设置 `BIND_HOST=127.0.0.1`、`UV_EXTRAS=postgres`、`POSTGRES_PASSWORD`、`BETTER_AUTH_SECRET`、`DEER_FLOW_INTERNAL_AUTH_TOKEN`。为每个密钥生成不同的 URL-safe 随机值。不要提交 `.env`、`config.yaml` 或真实用户数据。
4. 使用 PostgreSQL 覆盖配置启动所需服务。显式指定服务名可以避免单机部署启动可选 Kubernetes Provisioner：

   ```powershell
   docker compose --env-file .env --project-name deer-flow -f docker/docker-compose.yaml -f product/deploy/docker-compose.postgres.yaml up --build -d postgres redis frontend gateway nginx
   ```

5. 检查 Gateway readiness 接口，创建首个管理员并测试一条会话；重启服务后确认账号和历史仍然存在。对公网开放前，关闭开放注册。

## 首次构建前准备 Flow Desk 扩展

仓库内的 `product/backend-extension/` 是 Flow Desk 的自有 Gateway API。它提供产品 bootstrap、偏好、审计、文件目录和受限数据任务；Docker 镜像不会因为目录存在就自动加载它，因为 Python 扩展拥有 Gateway 进程权限。若需要完整的 Flow Desk 页面与 API，必须在受控构建环境把扩展作为可信插件安装，再构建并发布镜像。

在已经安装仓库构建依赖的受控 checkout 中执行：

```powershell
$extensionSource = (Resolve-Path .\product\backend-extension).Path
make extension-install "SOURCE=$extensionSource"
make extension-list
```

安装器会生成部署快照、更新锁定依赖并写入本地 `config.yaml`。提交/制作发布包时，确认镜像构建上下文包含 `backend/extensions/sources/` 与更新后的后端锁文件；不要把构建机的整个 `config.yaml` 或 `.env` 复制到服务器。服务器运行配置只合并该插件记录，保留安装器生成的 `package` 字段，并至少具有以下关键项：

```yaml
plugins:
  - name: flow-desk-product
    use: flow_desk_product_extension:install
    enabled: true
    required: true
    table_prefix: flowdesk_
    config:
      features:
        administration: true
      data_jobs:
        enabled: true
```

`required: true` 让插件加载、贡献路由挂载或产品存储服务启动失败时阻止 Gateway 启动，避免把缺少产品 API 的实例当作完整的 Flow Desk 服务交付；`administration` 只控制管理员页面是否显示，服务端仍校验真实管理员 principal。`data_jobs.enabled` 显式打开偏好删除与各类标记为 `partial` 的单范围导出；完整账号擦除仍未实现。若暂时不需要后台数据任务，可保持其关闭并隐藏对应入口。扩展源码、依赖锁、插件配置必须来自同一个经过验证的产品版本。

腾讯云轻量应用服务器的容量、端口、TLS、备份和升级方案见[服务器部署方案](../../docs/plans/服务器部署方案.md)。

PostgreSQL 数据保存在 Docker 卷 `product-postgres-data`。上传文件、Agent 工作区、记忆和短期 Flow Desk 导出文件位于 `DEER_FLOW_HOME`，应按保留策略纳入备份；只备份 SQL 并不完整。产品数据任务默认关闭；启用后，用户可以提交本人偏好、会话历史、项目空间、计划任务定义、自建 Agent 和记忆的删除任务，也可以分别导出偏好、会话、项目、计划任务、Agent、记忆和文件七类范围，或生成合并这些范围的 `account` ZIP。组合包在根目录含 `manifest.json`，外层始终标记为 `partial`，不是账号完整快照，也不会导出可恢复 checkpoint、部署密钥或其他用户数据。所有导出只读取 Gateway 暴露的 owner-scoped 数据，并采用有界分页；文件任务包括符合限制的线程上传/输出、工作区文件和项目资料架原件，工作区敏感名称路径、生成目录、符号链接/联接点会排除，正文不扫描密钥。文件中心的单文件删除和资料回收站操作不等于账号级文件清理，账号全量擦除仍未实现。每位用户最多一个活动任务、每小时最多创建十个新任务。此方案没有内置备份调度器，也不会自动迁移现有 SQLite 数据库。

## 已有 SQLite 环境迁移

仓库提供 `migrate_sqlite_to_postgres.py`，用于把**单个、统一的** `database.sqlite_path`（默认 `{database.sqlite_dir}/deerflow.db`）中的数据库行复制到已初始化的 PostgreSQL。该工具先做只读预检，只有带 `--apply` 且确认目标数据库名后才写入；来源以只读模式打开，并在复制期间保持一个一致的 SQLite 读取快照；core 与 `product` 目标 schema 的业务表都必须为空。目标表/列不匹配、必填列无法映射或外键形成循环时会拒绝迁移，不会把来源 Alembic 版本直接覆写到目标。应用数据和 checkpoint 中的常见表会一起检查；`alembic_version`、`flowdesk_alembic_version` 与 `checkpoint_migrations` 是版本账本，不作为业务行复制。每张表复制后会核对行数，失败会回滚整个目标事务。

此工具只搬运 SQL 数据行，不搬文件、工作区、记忆目录、配置或密钥；JSONL/内存型运行事件不在 SQLite 文件中，必须按各自存储另行处理。另行配置的 SQLite checkpointer 会被 CLI 拒绝，需独立评估。若使用文件式 Custom Agent/托管 Subagent，还需运行现有 `backend/scripts/migrate_agents_to_db.py`；这不是本工具自动完成的步骤。迁移仍须先在授权副本验证登录、会话历史、checkpoint 恢复、运行事件和产品扩展数据。

### 副本演练与正式迁移

1. 确认来源 checkout 与产品扩展版本，停止来源 Gateway/调度器和所有写入者；为 `deerflow.db`、`DEER_FLOW_HOME` 及关联外部存储制作同一维护窗口内的备份。不要直接在持续写入的数据库上执行复制。
2. 用受控产品镜像和 `required: true` 的 Flow Desk 扩展配置启动空 PostgreSQL 目标，让 Gateway 完成 core 与 `product` schema 迁移；不要创建目标管理员或导入任何业务数据。然后停止 Gateway。
3. 在包含对应后端依赖的 checkout 中，将当前运行配置指向该 PostgreSQL 目标，并以旧 SQLite 文件路径显式指定来源。先只运行预检：

   ```bash
   cd backend
   SOURCE_SQLITE=/secure/backup/deerflow.db
   uv run --locked --extra postgres python ../product/deploy/migrate_sqlite_to_postgres.py \
     --source-sqlite "$SOURCE_SQLITE"
   ```

4. 检查所有表名、行数及空目标预检结果。先在授权副本执行下面的应用命令：

   ```bash
   uv run --locked --extra postgres python ../product/deploy/migrate_sqlite_to_postgres.py \
     --source-sqlite "$SOURCE_SQLITE" \
     --apply --confirm-target deerflow
   ```

   将 `deerflow` 换成配置 URL 中的实际数据库名。在隔离栈验证用户登录、会话列表/历史、旧 checkpoint 可续跑、自有扩展设置和计划任务；对每个来源表抽样核对行数及关键 ID。
5. 正式迁移时再次停止全部写入者，使用最终一致来源快照重复预检，再执行同一命令并追加 `--apply --confirm-target <实际 PostgreSQL 数据库名>`。应用完成后保持来源备份只读，启动 Gateway，检查运行事件与文件/记忆存储，并在切流前保留回退窗口。

从 PostgreSQL 回退到旧 SQLite 会丢失切流后的新写入；回退时应恢复同一时间点的数据库与 `DEER_FLOW_HOME`，而不是只改连接配置。目标服务器尚未运行此迁移演练时，不得宣称历史数据迁移已验收。

## 备份起点

从运行中的容器使用 PostgreSQL 工具创建数据库 dump；通过组织的密钥管理系统保存相应时间点的 `DEER_FLOW_HOME` 快照和部署密钥。Gateway 写入暂停期间，让数据库备份和文件快照时间保持一致。在隔离服务栈中同时恢复数据库和文件，再将备份视为可用。

发布检查、Linux 服务器一致性备份命令和隔离恢复演练见[发布与恢复操作手册](OPERATIONS.md)。同机并行恢复须额外叠加 `docker-compose.isolated-recovery.yaml`，并使用不同 Compose project、`RECOVERY_STACK_NAME`、数据目录及 loopback 端口。仓库提供的是可执行演练流程，不代表已经在目标服务器完成恢复验收；SQLite 到 PostgreSQL 的历史迁移工具也必须先在授权副本单独演练。
