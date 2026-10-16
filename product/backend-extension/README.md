# Flow Desk Gateway 产品扩展

本目录是 Flow Desk 自有后端能力的边界。扩展只依赖公开的 `deerflow-extension-api`，不得导入 DeerFlow 内部的 `deerflow.*` 或 Gateway 私有的 `app.*` 模块。根级 `tests/test_flow_desk_extension_boundary.py` 会检查目录内所有 Python 文件的直接导入和常见动态导入，并由后端默认 CI job 执行，避免上游内部实现变化时把私有依赖带进产品扩展。

## 当前 API

Gateway 的记忆管理接口也会将用户主动发起的导出、导入、清空、事实新增/编辑/删除写入该审计流；事件仅含固定动作码、资源类型及事实 ID（适用时），不会包含记忆正文或请求体。Agent 运行期间自动生成的后台记忆更新不在这组 HTTP 管理审计范围内。

`GET /api/product/v1/bootstrap` 返回版本化的产品展示配置，以及由 Gateway 解析的当前用户 ID 和管理员标记。Gateway 会为扩展路由执行会话认证；principal 无法解析时接口会拒绝请求。响应只包含白名单产品设置，不会回传扩展的任意私有配置。

个人偏好通过产品自有的 `flowdesk_user_settings` 表保存，对应接口为 `GET /api/product/v1/settings`、`PUT /api/product/v1/settings/{key}` 和 `DELETE /api/product/v1/settings/{key}`。读取要求 `preferences:read`，新增、更新和删除要求 `preferences:write`；扩展先检查 Gateway principal 与有效路由授权，再访问存储，并始终按 principal 的用户 ID 限定范围。每个 JSON 值最多 64 KiB；键名仅允许小写字母、数字、`.`、`_` 和 `-`。不要在这里保存模型提供商密钥或 API 凭据；部署密钥应由运维的密钥管理系统保存。扩展使用独立 Alembic 迁移链，当前版本为 `fd_0008`，迁移版本保存在 `flowdesk_alembic_version` 表中。PostgreSQL 将表放在显式的 `product` schema；SQLite 没有 schema 命名空间，因此通过 schema 映射使用默认数据库。

`fd_0002` 迁移新增 `flowdesk_audit_events`。偏好写入/删除及对应审计事件在同一事务提交。Gateway 账号启用/停用操作也会通过公开的 `AdminActionObserver` 契约投递到此表，投递发生在宿主账号事务提交之后。事件只包含受限长度的操作者/资源 ID、稳定动作码、结果、时间和可选 request ID，不包含偏好内容、个人资料、消息正文或凭据。宿主账号审计采用尽力投递；失败会记入 Gateway 诊断。`GET /api/product/v1/admin/audit-events` 要求 Gateway 投影的管理员身份，分页大小限制为 1–100；响应的 `has_more` 通过多读一条哨兵记录精确判断，避免整页边界误导前端；旧版响应没有该字段时，前端仍按页长兼容。Gateway 不会将个人访问令牌（PAT）视为管理员身份。没有修改或删除审计事件的 API。

`fd_0003` 迁移新增带版本的 `flowdesk_product_settings`。管理员通过 `GET /api/product/v1/admin/settings` 读取产品展示配置，通过同一路径的 `PATCH` 更新中英文产品名和白名单界面开关。每次更新都必须提交 `expected_version`；版本过期时返回 HTTP 409，不会覆盖新配置。配置更新和审计记录在同一事务提交。`files` 开关用于显示自有文件中心；`GET /api/product/v1/files` 先读取产品数据库中按用户隔离的元数据快照，首次访问、快照超过 5 分钟或 `refresh=true` 时，再调用 Gateway 的 `OwnerDataReader.list_files` 有界重建。Gateway 同时要求 `threads:read` 和 `projects:read`，扫描线程上传/输出、最多遍历 200 个目录的会话工作区和项目资料架原件，最多扫描 5,000 个会话、5,000 个项目和 10,000 个文件；工作区扫描跳过生成目录并拒绝符号链接/联接点，达到上限或来源不可用时会返回不完整状态。`fd_0007` 只持久化经过 Gateway owner 投影的文件元数据，不保存正文、宿主路径或签名；每个用户的目录按 5 分钟有效期重建，刷新失败时保留旧快照并标记陈旧，30 秒内重复刷新会延后并通过 `catalog_refresh_deferred` 告知前端。`DELETE /api/product/v1/files/catalog-entry` 只清除已经由 Gateway 成功删除的本用户缓存行，并标记目录待重建；该接口不执行文件删除。手动刷新也受此间隔和跨实例租约约束，避免反复扫描；打开文件仍由原 Gateway 路由再次校验 owner。会话工作区在文件中心只读，只有现有支持删除的上传和项目原件显示删除操作。后台文件导出可包含下文所述的有界工作区文件，仍会跳过生成目录、敏感名称、符号链接和联接点，并报告截断或读取失败；它不是完整工作区备份。完整账号级数据管理交付前，`data_privacy` 必须保持关闭。

`fd_0004`、`fd_0005`、`fd_0006` 迁移增加持久化 `flowdesk_data_jobs` 任务元数据、每位用户最多一个活动任务的数据库约束，以及按用户维护的任务创建计数。已认证用户可以通过 `POST /api/product/v1/data-exports` 或 `POST /api/product/v1/data-deletions` 创建任务，通过 `GET /api/product/v1/data-jobs` 和 `GET /api/product/v1/data-jobs/{id}` 查询进度，申请取消，并在完成后下载短期有效的导出文件。任务列表支持 `limit`/`offset` 分页并返回 `has_more`；调用方不得假设一页 20 条就是完整历史。每位用户每个固定一小时窗口最多创建十个新任务；同一个幂等请求重放不消耗额度，超过限额会返回包含 `Retry-After` 的 429。运维未在可信的 `plugins:` 配置中显式打开任务时，这些路由返回 404：

```yaml
plugins:
  - name: flow-desk-product
    config:
      data_jobs:
        enabled: true
```

`fd_0008` 为任务保存 `kind:scope` 授权键，并按 owner、授权键、创建时间和任务 ID 建立分页索引。列表先逐类复核当前 route grant 与 Central IAM self-scope，再在 SQL 中只选取获准类别并应用 `offset`，避免加载并逐条检查整段任务历史。`has_more` 仅在后续存在至少一条当前可见任务时为 `true`。滚动升级期间旧进程新写入的 NULL 授权键仍按任务 scope 逐条检查；响应中的 `next_offset` 指向下一页第一条可见任务，避免前端重复或跳过被过滤的旧行。前端仍以 `has_more` 决定能否继续，并对旧版响应缺少 `next_offset` 的情况按页长回退，不能根据 owner 原始行数推断。

`GET /api/product/v1/data-capabilities` 供已登录页面在打开删除确认前发现当前宿主支持的范围。它同样受上述 `data_jobs.enabled` 开关控制，关闭时返回 404；未认证返回 401，扩展 store 缺失返回 503。响应只包含 `api_version: 1` 和封闭的 `deletion_scopes` 布尔白名单：`preferences`、`memory`、`files`、`threads`、`projects`、`agents`、`scheduled_tasks`。偏好删除由扩展实现，其余范围复用 store 当前同步 `can_delete_*` 属性；缺少能力、属性异常或非布尔投影都视为不支持，不返回内部原因、路径或配置。接口不会执行宿主读取/删除、排队任务或写入数据库。能力发现只是当前实现的可用性提示，不保证任务服务已就绪、操作者对每项资源已有权限或提交后仍然支持；创建任务和 worker 继续执行原有最终能力检查、身份校验及逐资源 owner 保护。

创建任务必须带 `Idempotency-Key`；任务 owner 始终来自 Gateway principal。扩展按所选范围复用 Gateway 当前 route grants：偏好读写分别要求 `preferences:read/write`；会话导出要求 `threads:read + runs:read`；项目、Agent 和记忆导出分别要求 `projects:read`、`agents:read` 和 `memory:read`；计划任务导出沿用 Gateway 的 `threads:read`；文件导出要求 `threads:read + projects:read`；删除范围分别使用对应的 `*:delete`，其中计划任务沿用 `threads:delete`，文件删除同时要求 `threads:delete + projects:delete`。组合 `account` 导出必须同时具备所有组成范围的读取权限。创建任务、读取任务详情、取消任务和下载导出制品都会基于当前 principal 重验所需权限；owner 过滤仍是独立边界。偏好删除要求确认短语 `DELETE PREFERENCES`；计划任务定义删除要求单独确认 `DELETE SCHEDULED TASKS`；记忆清空要求 `DELETE MY MEMORY`，且仅在 Gateway 确认当前后端实现了 `clear_memory` 后开放。每项删除都由服务端重新使用显式 owner ID，不能从请求正文读取身份。

文件删除使用 `DELETE MY FILES` 确认，作为持久后台任务执行。Gateway 只永久删除本人线程上传文件，并把项目资料移入可恢复回收站；生成产物与会话工作区文件继续只读，并在结果中作为未完成资源显示。worker 收集有界清单后逐项调用 `OwnerDataDeleter.delete_file(user_id, file_id)`，不接受宿主路径或文件正文；Gateway 按储存边界重复校验 owner，审计不包含文件名。目录截断、覆盖提示、单项失败或仍有只读文件时必须报告 `partial`。

数据任务的创建、成功完成、最终失败、取消申请、终态取消和 owner 授权后的导出下载请求都会写入产品审计表。异步终态事件使用任务创建时的 request ID；取消申请和排队任务即时取消优先记录取消请求的 request ID。下载事件表示 Gateway 已授权并开始响应该请求，不保证客户端完整接收文件。worker 异常只保留稳定错误码用于任务状态，审计记录不包含异常正文、导出内容或凭据。状态变更与对应终态审计在同一数据库事务提交；管理员可以只读分页查看审计事件。

工作台个人偏好页提供任务历史、进度轮询、取消和短期导出文件下载。导出可以单独选择 Flow Desk 偏好、Gateway 可见的会话历史、当前用户的项目元数据、计划任务定义、当前用户自建 Agent、记忆或文件。会话包包含线程摘要、可见消息和按 owner 校验的运行摘要/token 用量；运行白名单排除请求参数、错误正文、任意 metadata、stop reason 与 worker lease。项目包只包含项目名称、说明、展示配置、状态与时间戳，不包含项目文档内容或文件；计划任务包只包含任务定义与调度频率，不包含 occurrence/run 历史、运行 ID、运行时错误或租约状态；Agent 包只包含个人设置与 SOUL；记忆包只读取当前配置后端返回的 owner-scoped 记忆视图，本地 DeerMem 默认读取共享摘要和 `__default__` bucket，其他 backend 的覆盖范围可能不同；文件包只包含 owner 的平铺线程上传/输出、每个会话最多扫描 200 个目录且全任务合计最多扫描 20,000 个目录的工作区文件，以及项目资料架 active 原件；跳过生成目录、符号链接/联接点、疑似凭据名称、转换预览、已删除资料和其他宿主文件。宿主通过 `OwnerDataReader.read_files` 显式接收 user ID 并复核每个线程/文档归属；产品 worker 只拿到原始文件 bytes，不接触宿主路径；正文不扫描密钥，分享前需复核。每个文件包最多 5,000 个文件、7 MiB 原始数据和 10 MiB JSON，总是标记为 `partial`，并注明截断或读取失败；分页或读取期间发生的变化可能没有包含在内。删除现支持 Flow Desk 偏好、计划任务定义、自建 Agent 定义、本人会话历史、项目空间、记忆和受限文件。文件任务只永久删除本人线程上传，并把项目资料移入可恢复回收站；生成产物与会话工作区文件继续只读，结果标记为部分完成。记忆删除要求 Gateway 的已配置 memory manager 覆写 `clear_memory`，再以任务 owner ID 调用；如果后端不支持会在排队前返回 503。清理开始后的晚到取消不会掩盖已经提交的结果。会话范围仍逐条清除 Gateway 管理的工作区、checkpoint、事件、运行用量及线程元数据；正在运行或失败的会话保留并报告部分结果。会话清除由 Gateway capability 二次核对 owner 并持有 durable delete reservation，但跨存储没有原子事务保证。账号级完整擦除尚未实现，以上任务不会打开完整账号级 `data_privacy` 功能。

个人数据页还提供组合 ZIP 导出：`account` 仅允许用于导出，按顺序复用七种 owner-scoped JSON 导出，并在根目录写入 `manifest.json`。单类制品各自保留 10 MiB 限制，组合包原始内容合计最多 64 MiB；缺少 Gateway 能力或受总量限制的范围会在清单标记为未包含。下载始终是 `partial`，不包含凭据、部署配置、checkpoint 或运行续接状态，不能作为完整账号备份。

Gateway 仅向可信扩展授予 `DEER_FLOW_HOME/flow-desk/data-jobs` 下的持久目录。后台 worker 通过数据库租约和 fencing token 领取任务，Gateway 实例异常退出后其他实例可恢复过期租约。单类 JSON 导出最大 10 MiB，组合 account ZIP 的总量上限为 64 MiB，均包含 SHA-256 校验值，并在 24 小时后过期。偏好包只包含产品设置；会话包通过宿主提供的 owner-scoped `OwnerDataReader` 读取线程摘要、可见消息和运行摘要/token 用量；运行记录按 `(created_at, run_id)` 游标倒序分页，只投影状态、Agent 标识、时间和 token 计数，不导出请求参数、错误正文、任意 metadata、stop reason 或 worker lease；项目包只包含白名单项目元数据；计划任务包只包含用户自己的定义字段，不包含 occurrence/run 历史、运行 ID、运行时错误或租约状态；Agent 包只通过 `OwnerDataReader` 读取精确 owner 的 Agent 分页和可移交字段，不使用会合并部署共享定义的普通列表；记忆包只通过 `OwnerDataReader.read_memory(user_id=...)` 调用显式 owner 的 memory manager，再由 worker 二次过滤文档与事实字段，最多 5,000 条事实；文件包只通过 `OwnerDataReader.read_files(user_id=...)` 读取 owner 的平铺 uploads/outputs、有界 thread workspace 文件（每个会话最多 200 个目录，全任务最多 20,000 个目录）和项目资料架 active 原件；排除生成目录、符号链接/联接点及疑似凭据名称，不接收路径，并限制 5,000 个文件、7 MiB 原始数据。正文不扫描密钥，必须提示用户分享前复核。线程、项目、计划任务、Agent、记忆和文件导出均标记为 `partial`。偏好包以外的其他范围包不含记忆内容；任何包都不含可恢复 checkpoint、凭据或审计留存。组合后台包和账号设置页的前台 JSON 都是受支持数据范围导出，不是完整账号迁移或备份；账号全量擦除尚未实现，因此不能打开完整账号级 `data_privacy`。

任务进度与结果 JSON 有大小限制和字段白名单。任务行只保存文件引用和计数，不保存对话正文、文件内容或凭据。导出目录继承 Gateway 数据卷权限，必须纳入受保护的 `DEER_FLOW_HOME` 备份范围；后台 worker 会清理过期文件。PostgreSQL 并发行为及多 Gateway 共享目录仍需集成验证。

`GET /api/product/v1/version` 面向已登录的诊断页面，返回产品名称、产品扩展分发包版本和 DeerFlow Harness 分发包版本。缺少分发包元数据时返回 `unknown`；响应不包含密钥和部署路径。

`GET /api/product/v1/public-brand` 供未登录的公开首页和认证页读取中英文品牌名；该路由只返回 `name` / `name_zh`，不返回功能开关、用户 ID 或管理员状态。Gateway 仅对这一条精确路径开放匿名访问；扩展存储不可用时返回部署配置中的默认名称，前端另有源码回退。

功能开关只是界面展示提示，不代表 API 授权。前端使用该响应显示工作台品牌和导航；扩展端点不可用时回退到 `frontend/src/product/features.ts` 中的默认值。默认值要与 `DEFAULT_FEATURES` 保持一致。

## 本地开发

在隔离的 Python 环境中安装公开扩展契约和本扩展，参考 `examples/deerflow-extension-example/` 的流程。要把扩展安装到当前 checkout，可在仓库根目录使用受信任扩展管理器，并传入绝对源码路径：

扩展 API、SQLite 迁移和数据任务单测复用后端锁定的开发依赖。在仓库根目录执行以下命令；该测试只创建临时 SQLite 数据，不需要连接生产数据库：

```powershell
cd backend
make test-product-extension
```

PostgreSQL 迁移冒烟测试只面向明确标记的本机测试库。测试会拒绝非 loopback 地址或数据库名不是 `deerflow_test` 的连接；运行前需要设置 `FLOWDESK_TEST_POSTGRES=1` 和 `TEST_POSTGRES_URI`，不要填写生产连接串。CI 使用隔离的 PostgreSQL 16 服务运行此检查。

```powershell
make extension-install SOURCE="D:\project\deer-flow\product\backend-extension"
```

此命令会把可部署快照写到 `backend/extensions/sources/`，更新扩展依赖锁，并向 `config.yaml` 写入由运维控制的 `plugins:` 项。该项需要添加 `table_prefix: flowdesk_`，避免 DeerFlow 的 Alembic 自动生成把产品自有表纳入上游迁移；扩展管理器仍会独立执行产品迁移。首次启动时，Gateway 数据库角色需要有权创建 `product` schema 并管理产品表；也可以由运维预建 schema 并授权。安装后重启 Gateway。使用 `make extension-list` 查看扩展，使用 `make extension-disable NAME=flow-desk-product` 停用。

扩展不会自动安装，因为 Python 扩展以 Gateway 权限运行。启用生产实例前，应先审查源码、依赖来源、构建钩子及配置。

要显示第一版管理员页面，需要在 `config.yaml` 中打开运维控制的 `features.administration` 展示开关，并保留产品表前缀。扩展管理器创建的配置项大致如下：

```yaml
plugins:
  - name: flow-desk-product
    use: flow_desk_product_extension:install
    enabled: true
    required: false
    table_prefix: flowdesk_
    config:
      features:
        administration: true
```

管理器也可能自动写入 `package` 字段，请保留该值。此开关只显示管理员界面；每个管理员 API 仍会检查已认证的 Gateway principal。

上面的 `required: false` 仅适用于本地可选扩展试用。按 Flow Desk 独立产品交付时，应采用[生产部署示例](../deploy/README.md)中的 `required: true`，让产品扩展加载或存储启动失败直接阻止 Gateway 就绪。

## 扩展约定

- HTTP 路由放在 `/api/product/v1/` 下；破坏已有响应契约时，创建新的 API 版本。
- 本扩展最低依赖 `deerflow-extension-api>=0.2.18,<0.3`。`require_permission` 复用 Gateway 当前路由授权，异步 `require_data_scope` 将中央 IAM 的本人数据范围检查委托给 Gateway；缺少宿主能力或判定不可用时失败关闭。扩展只传稳定的 `target/action/resource_id`，不接触 IAM 凭据或 Gateway 私有模块。`OwnerDataReader` 提供可选 owner 数据读取；线程历史导出通过 owner-scoped reader 获取安全运行摘要和 token 用量，不暴露原始请求、错误正文或 worker lease。`OwnerDataDeleter` 独立提供 owner-scoped 的计划任务、Agent、会话历史、项目空间、个人记忆和文件清理能力。文件任务永久删除本人线程上传，并把项目资料移入可恢复回收站；生成产物与工作区文件仍只读，结果会报告部分完成。项目移除会解除会话关联，并把项目资料放入 Gateway 回收站；它不会删除会话正文或永久清空回收站。Agent 删除复用宿主的 memory debounce 取消，并保留部署级 legacy Agent 与纯记忆目录；会话清除复用 Gateway durable reservation 和串行清理顺序，不能视作跨存储原子事务。升级 DeerFlow 时先确认宿主实现对应可选 capability，再部署本扩展和前端。

- 启用后台数据任务时，Gateway 必须通过 `ExtensionRuntimeDeps.owner_data_authorizer` 注入可信授权器。worker 在领取任务和每次分页/删除检查点重新读取当前账号权限与中央 IAM self scope；403 以 `authorization_revoked` 结束，503 以 `authorization_unavailable` 延迟重试。任务历史列表按当前范围过滤，IAM 无法判定时返回 503。IAM token 和授权快照永不写入任务记录。
- 兼容旧 Gateway 时，缺少 `list_files` reader 不会阻止扩展启动，也不影响其他产品接口；只有调用文件目录 API 时返回 503。不要为了消除此提示而让产品扩展直接导入 `app.*` 或访问宿主文件路径，应升级 Gateway 的公开 extension-api/reader 实现。
- 使用 `deerflow_extension_api.resolve_principal(request)` 获取身份。绝不相信浏览器提交的 `user_id`、角色或租户字段。
- 产品设置、审计、导出记录和删除任务属于产品自有 schema 与迁移链。不要把它们加入 DeerFlow ORM Base，也不要直接修改宿主私有表。
- Gateway 可选提供 `ExtensionRuntimeDeps.owner_data_reader`，供受信任扩展按显式 owner ID 分页读取线程清单、可见消息页、白名单项目元数据、计划任务定义和安全运行摘要。运行摘要先校验线程 owner，再用相同 owner 查询 RunStore，只投影状态、时间、Agent 标识和 token 计数；不暴露请求参数、错误正文、任意 metadata、stop reason 或 worker lease。项目分页会再次校验 owner，只返回名称、说明、展示配置、状态和时间戳，不包含文档正文；计划任务仅暴露定义字段，不暴露 occurrence/run 历史、运行时错误或租约。`list_files` 只返回受支持来源的文件元数据，扫描有硬上限并报告截断；`read_files` 是单独的有界能力，仅供明确声明内容导出的后台任务使用。文件路径和 checkpoint 都不会交给扩展，Gateway 在内容读取或浏览器下载时再次校验资源 owner。此能力只读且不开放 checkpoint 表。保持完整账号级 `data_privacy` 关闭，直到声明的导出/删除范围、部分失败处理和重试行为都经过实现及验证。
- 用户设置展示了自有数据持久化边界：独立 SQLAlchemy `MetaData`、独立 Alembic 迁移版本表，以及始终按服务端用户 ID 限定范围的仓储方法。增加产品表时也要明确迁移所有者、重试语义和恢复方案；进程内字典不能作为持久用户数据。
- 产品 API 中的功能开关只是显示提示。每项权限都必须在 Gateway API 边界强制执行。
