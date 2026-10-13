# 发布、备份与恢复操作手册

本文是 Flow Desk 自有部署的操作清单，面向第一次维护该项目的开发者。服务器上的备份与恢复命令使用 Ubuntu Bash 和 Docker Compose；不要把 Windows 开发机路径直接复制到服务器。仓库当前提供 PostgreSQL 部署覆盖和隔离恢复覆盖；必须在目标部署环境实际演练通过后，才能认定恢复能力已经验收。

## 适用范围

- Compose 项目根目录为仓库根目录，部署覆盖为 `docker/docker-compose.yaml` 与 `product/deploy/docker-compose.postgres.yaml`。
- PostgreSQL 容器服务名为 `postgres`，数据库名/用户为 `deerflow`。
- 数据库卷为 `product-postgres-data`。文件、记忆、工作区和配置目录依据部署中的 `DEER_FLOW_HOME` 与挂载设置另行确认。
- 本手册不承诺跨版本数据库降级安全；已有 SQLite 实例转 PostgreSQL 时，按[部署手册中的迁移步骤](README.md#已有-sqlite-环境迁移)先做授权副本演练。

## 发布前检查

1. 记录产品版本、DeerFlow 上游基线（当前基线建立情况见 `docs/自有项目改造指南.md`）、Git commit、镜像 digest、配置版本和扩展迁移版本。
2. 检查发布候选的变更与兼容性：后端迁移是否可逆、配置是否新增必填项、Gateway API/SSE/权限行为是否变化；在测试环境运行与本次改动相符的前后端测试。
3. 确认 PostgreSQL 和文件存储健康、磁盘空间充足，`.env` 与 `config.yaml` 来自本部署的密钥管理及配置基线，而不是开发者机器。
4. 确认最近一份数据库和文件快照完整，恢复演练没有过期；通知使用者计划维护窗口并停止新写入。
5. 没有可用备份、来源版本不明或迁移风险未评估时，停止发布，先补齐证据。

## 一致性备份

数据库和文件需来自一致的时间点。先通知使用者维护窗口，确认没有正在运行的 Agent 任务，再在 Ubuntu 服务器终端执行下面的命令。备份目标应是已挂载的异机/独立备份介质，不得放在仓库或 `DEER_FLOW_HOME` 中。

```bash
set -euo pipefail
umask 077

REPO_ROOT=/srv/flowdesk
DEER_FLOW_HOME=/data/flowdesk
BACKUP_ROOT=/mnt/flowdesk-backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

compose() {
  docker compose --env-file "$REPO_ROOT/.env" --project-name deer-flow \
    -f "$REPO_ROOT/docker/docker-compose.yaml" \
    -f "$REPO_ROOT/product/deploy/docker-compose.postgres.yaml" "$@"
}

# 先验证配置、路径和 Compose 项目名，再停止入口。
compose config --quiet

test -d "$DEER_FLOW_HOME"
test ! -L "$DEER_FLOW_HOME"
test -d "$BACKUP_ROOT"
case "$(realpath -m "$BACKUP_ROOT")/" in
  "$(realpath -m "$REPO_ROOT")/"*|"$(realpath -m "$DEER_FLOW_HOME")/"*)
    echo "备份目标不能位于代码仓库或运行数据目录中" >&2
    exit 1
    ;;
esac
test ! -e "$BACKUP_DIR"
mkdir -m 700 -- "$BACKUP_DIR"

# 先停止入口和 Gateway，阻止新请求及 Agent 写入；PostgreSQL 保持运行。
restart_stack() {
  if ! compose up -d gateway nginx; then
    echo "无法自动恢复 Gateway/Nginx，请按维护手册检查服务状态" >&2
  fi
}
trap restart_stack EXIT
compose stop nginx gateway

# 自定义格式 dump 直接流到主机备份目录，不在数据库容器中留下临时副本。
compose exec -T postgres pg_dump -U deerflow -d deerflow -Fc > "$BACKUP_DIR/flowdesk.dump"
tar --numeric-owner -czpf "$BACKUP_DIR/flowdesk-home.tar.gz" \
  -C "$(dirname "$DEER_FLOW_HOME")" "$(basename "$DEER_FLOW_HOME")"

# 验证归档可读并写入校验和；不要覆盖已有时间戳目录。
compose exec -T postgres pg_restore --list < "$BACKUP_DIR/flowdesk.dump" > "$BACKUP_DIR/pg-restore.list"
tar -tzf "$BACKUP_DIR/flowdesk-home.tar.gz" > "$BACKUP_DIR/file-list.txt"
(cd "$BACKUP_DIR" && sha256sum flowdesk.dump flowdesk-home.tar.gz > SHA256SUMS)

# 成功时也恢复服务；失败退出时由 EXIT trap 恢复入口，保留不完整备份供检查。
trap - EXIT
restart_stack
```

命令中的 `REPO_ROOT`、`DEER_FLOW_HOME` 和 `BACKUP_ROOT` 必须替换为服务器实际路径。`BACKUP_ROOT` 应位于独立且已挂载的备份介质，先用 `findmnt -T "$BACKUP_ROOT"` 确认挂载目标，再运行备份。备份使用唯一 UTC 时间戳目录，不覆盖旧副本；失败时保留现场并以新时间戳重试，不要把不完整目录当作有效备份。

记录数据库 dump 与文件快照的开始/结束时间、Git commit、数据库迁移版本、密钥/配置的密钥管理引用和操作者。备份介质需与运行主机分开保存，并在传输或存储前按组织规则加密；不得把 `.env`、密钥或用户数据提交进 Git。备份结束后保持已写好的 SHA256SUMS 校验文件，与备份一同异机保存。

## 隔离环境恢复演练

1. 在第二台测试主机或独立的恢复 checkout 中操作，使用经授权的备份副本。当前腾讯云服务器只有 4 GB 内存；若生产服务仍运行，不要在同一台主机再启动完整恢复栈，以免争抢内存并影响线上服务。
2. 恢复 checkout 必须包含与备份相同版本的代码、Docker Compose 文件和产品扩展。为它单独准备 `.env`、`config.yaml`、`extensions_config.json` 与 `frontend/.env`：`DEER_FLOW_HOME` 指向新的空目录；`BIND_HOST=127.0.0.1`、`PORT=2027`；`RECOVERY_STACK_NAME` 使用本次专属且唯一的容器名前缀。不要复用生产运行目录或生产数据库卷。
3. 同一 Docker 主机上做恢复时，Compose project name 会隔离命名卷和网络，但上游 Compose 中写死的 `container_name` 不会随 project name 改变。追加 `product/deploy/docker-compose.isolated-recovery.yaml`，为 Gateway、前端、Nginx、Redis、Provisioner 和 PostgreSQL 指定恢复前缀；该文件没有发布端口或重命名卷。运行前先执行 `docker compose ... config --quiet`，核对恢复项目、容器名前缀、loopback `2027` 入口和专用 `DEER_FLOW_HOME`。
4. 在恢复 checkout 根目录准备只读备份路径和全新的运行目录；先校验归档并恢复文件。然后只启动恢复 PostgreSQL，再将 dump 导入它的新建空数据库：

   ```bash
   set -euo pipefail
   BACKUP_DIR=/mnt/flowdesk-backups/20260930-020000
   RESTORE_PROJECT="flowdesk-restore-$(date -u +%Y%m%d%H%M%S)"
   RECOVERY_STACK_NAME="$RESTORE_PROJECT"
   DEER_FLOW_HOME=/data/flowdesk-recovery-20260930
   BIND_HOST=127.0.0.1
   PORT=2027
   export RESTORE_PROJECT RECOVERY_STACK_NAME DEER_FLOW_HOME BIND_HOST PORT

   test -d "$BACKUP_DIR"
   test ! -e "$DEER_FLOW_HOME"
   mkdir -m 700 -- "$DEER_FLOW_HOME"
   (cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
   tar --numeric-owner -xzpf "$BACKUP_DIR/flowdesk-home.tar.gz" --strip-components=1 -C "$DEER_FLOW_HOME"

   compose() {
     docker compose --env-file .env --project-name "$RESTORE_PROJECT" \
       -f docker/docker-compose.yaml \
       -f product/deploy/docker-compose.postgres.yaml \
       -f product/deploy/docker-compose.isolated-recovery.yaml "$@"
   }

   compose config --quiet

   # 项目名会生成独立命名卷；已有同名卷时停止，不能把恢复数据写进旧卷。
   RESTORE_VOLUME="${RESTORE_PROJECT}_product-postgres-data"
   if docker volume inspect "$RESTORE_VOLUME" >/dev/null 2>&1; then
     echo "恢复卷已存在，请改用新的恢复项目名" >&2
     exit 1
   fi

   compose up -d postgres
   for attempt in $(seq 1 60); do
     if compose exec -T postgres pg_isready -U deerflow -d deerflow >/dev/null 2>&1; then
       break
     fi
     sleep 2
   done
   compose exec -T postgres pg_isready -U deerflow -d deerflow
   compose exec -T postgres pg_restore --exit-on-error --no-owner -U deerflow -d deerflow < "$BACKUP_DIR/flowdesk.dump"
   ```

5. 确认 PostgreSQL 已恢复且迁移版本符合预期，再启动隔离的 `redis frontend gateway nginx`。Gateway 启动可能运行该版本的数据库/扩展迁移，因此必须确认恢复目标是专用卷。诊断入口绑定在 `127.0.0.1:2027`，通过 SSH 隧道访问；恢复配置关闭计划任务和外发集成，不要让历史计划任务或渠道在验收期间执行。
6. 使用现存测试账号验证登录、会话历史与 checkpoint、文件、Agent 工作区、记忆和扩展数据；Agent 调用可能产生外部模型费用，只有在运维配置已确认且测试范围明确时才执行。记录恢复点时间、恢复耗时、缺失资源、迁移输出、应用版本和校验方法。

此流程只生成独立恢复副本，不包含删除卷、清理文件或覆盖生产数据的命令。恢复副本应按组织的数据留存规则处置；本仓库不会自动清理任何恢复数据。文档步骤本身不等于恢复验收，须在目标部署环境真实演练并留下记录。

## 升级与回退

1. 先按上文创建一致性备份，并保存当前应用镜像 digest、配置和迁移版本。
2. 在隔离副本运行候选升级，检查前端构建、Gateway 健康状态、扩展迁移、登录/会话/SSE/文件主路径和跨用户拒绝访问。
3. 确认迁移的向前兼容与回退策略。若数据库迁移不可逆，回退方案必须是恢复升级前的数据库和文件快照，而不能只切回旧镜像。
4. 在维护窗口部署候选版本并验证健康检查及关键用户路径，记录实际版本、迁移输出、开始结束时间和观察结果。
5. 出现数据损坏、权限回归或主路径故障时停止写入，依预先演练的方案恢复数据库与配套文件快照，并验证恢复点；不得在故障现场临时猜测破坏性命令。

## 每次维护的记录

发布记录模板位于 `product/deploy/release-manifest.example.json`。复制到本次 release 专属文件后，填写产品版本与 40 位 commit、核实过的官方 tag/commit、实际镜像摘要锁定引用、配置 schema 版本、`config.example.yaml` 与 `extensions_config.example.json` 的 SHA-256、Gateway/产品扩展迁移 revision、备份标识和各项验收证据。若某个迁移流没有迁移，明确填 `none`；首期发布要求构建、后端测试、前端检查、产品冒烟、升级兼容和隔离备份恢复六项检查都实际通过并提供证据。清单及其证据引用不得包含密钥、服务器地址、用户数据或带凭据的 URL。

```powershell
make release-manifest-check RELEASE_MANIFEST=product/deploy/release-manifest.json
```

检查器会验证必填字段、时间、SHA、镜像 digest 和发布门槛；空白模板会因待填字段而失败。通过仅表示格式完整，不能证明 commit、测试、镜像或恢复记录真实；发布负责人仍须人工核对清单与对应证据。当前上游祖先基线及完整 P0 验收仍未完成，参见[整体产品化 PRD 的实施进度](../../docs/plans/产品化需求与实施记录.md#133-当前实施进度)。
