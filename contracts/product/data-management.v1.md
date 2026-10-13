# Flow Desk 数据管理接口 v1

本文件固化已有数据管理行为、本轮新增能力发现接口与未完成的恢复要求。`api_version` 固定为整数 `1`；JSON 请求和响应使用 UTF-8。接口属于自有产品边界，不直接公开 DeerFlow 数据库表、文件路径或 worker 租约。

## 1. 身份、功能开关与请求入口

除项目另行定义的公开品牌接口外，本文件所有接口都要求 Gateway 已认证身份。owner 始终由 principal 解析；任务查询、取消和下载均按此 owner 限定。他人任务与不存在的任务统一返回 `404`。

数据任务须由可信运维配置显式启用 `plugins[].config.data_jobs.enabled: true`；未启用时任务路由返回 `404`。存储未准备好或宿主缺少请求范围的执行能力时返回 `503`。产品界面开关只控制展示，不能视为权限。

| 方法与路径                                        | 含义                       | 成功响应                                            |
| ------------------------------------------------- | -------------------------- | --------------------------------------------------- |
| `POST /api/product/v1/data-exports`               | 创建一个明确范围的导出任务 | `202`，`{api_version: 1, job}`                      |
| `POST /api/product/v1/data-deletions`             | 创建一个明确范围的删除任务 | `202`，`{api_version: 1, job}`                      |
| `GET /api/product/v1/data-capabilities`           | 读取七种删除范围支持情况   | `{api_version: 1, deletion_scopes}`                 |
| `GET /api/product/v1/data-jobs`                   | 本人任务分页               | `{api_version: 1, jobs, limit, offset, has_more}`   |
| `GET /api/product/v1/data-jobs/{job_id}`          | 本人单个任务               | `{api_version: 1, job}`                             |
| `POST /api/product/v1/data-jobs/{job_id}/cancel`  | 请求取消本人任务           | `{api_version: 1, job}`                             |
| `GET /api/product/v1/data-jobs/{job_id}/artifact` | 下载本人完成且未过期的导出 | JSON 或 ZIP 文件                                    |
| `GET /api/product/v1/admin/audit-events`          | 管理员只读审计分页         | `{api_version: 1, events, limit, offset, has_more}` |
| `GET /api/product/v1/files`                       | 本人文件元数据分页         | 见第 6 节                                           |

创建任务必须带 `Idempotency-Key`。请求模型拒绝额外字段；导出请求体为 `{"scope":["preferences"]}`，删除请求另加 `confirmation`。`scope` 不传时服务端默认 `preferences`，明确传入时必须恰好包含一项。

## 2. kind、scope 与删除含义

`kind` 只有 `export` 和 `deletion`。以下七种单一范围支持导出及受限删除；`account` 只支持导出，不能提交账号全量删除。

| scope             | 删除确认短语             | 范围说明                                                                 |
| ----------------- | ------------------------ | ------------------------------------------------------------------------ |
| `preferences`     | `DELETE PREFERENCES`     | Flow Desk 自有产品偏好，不包含模型提供商凭据                             |
| `threads`         | `DELETE THREAD HISTORY`  | 本人的宿主管理会话历史；活动或失败资源可保留并形成部分结果               |
| `projects`        | `DELETE MY PROJECTS`     | 本人项目空间；删除解除会话关联，保留会话，并把 active 项目资料移入回收站 |
| `scheduled_tasks` | `DELETE SCHEDULED TASKS` | 本人的计划任务定义；导出不包含 occurrence/run 历史                       |
| `agents`          | `DELETE CUSTOM AGENTS`   | 本人的自建 Agent 定义；导出不包含部署共享 Agent 或 GitHub 绑定           |
| `memory`          | `DELETE MY MEMORY`       | 当前配置后端的 owner-scoped 记忆视图；清空须由宿主明确支持               |
| `files`           | `DELETE MY FILES`        | 本人的受支持文件；删除仅永久清除线程上传，并将项目原件移入回收站         |
| `account`         | 不适用                   | 将七种可用范围组合为 ZIP 与 `manifest.json`，始终是部分导出              |

确认短语必须与范围精确对应，由服务端再次验证。关闭确认弹窗不会取消已经持久化的任务；执行取消须调用专门的取消接口。

单类宿主数据导出始终标记 `result.completeness: "partial"`；仅偏好范围可以报告 `complete`。文件包可以包含符合宿主读取边界的线程上传、生成产物、有界工作区文件和 active 项目资料原件；其中生成产物与工作区文件在删除任务中仍是只读资源。导出范围不覆盖部署管理的凭据、可恢复 checkpoint 或审计留存，不能称作完整账号备份。文件正文不进行嵌入密钥扫描，用户文件仍可能自行包含敏感内容，分享前需复核。

## 3. 任务公开投影与六种状态

任务对象包含以下必需字段。内部 `owner_user_id`、`idempotency_key`、`available_at`、`lease_owner`、`lease_token` 和 `lease_expires_at` 不进入浏览器任务 DTO。

| 字段                       | 类型与含义                                                      |
| -------------------------- | --------------------------------------------------------------- |
| `job_id`                   | 字符串任务标识；路由当前接受 36 字符 UUID 形式                  |
| `kind`                     | `export` 或 `deletion`                                          |
| `scope`                    | 第 2 节允许的一项字符串数组                                     |
| `status`                   | 下表六种公开状态之一                                            |
| `progress`                 | `{stage: string, completed: integer >= 0, total: integer >= 0}` |
| `result`                   | 小型白名单结果对象或 `null`，见第 4 节                          |
| `error_code`               | 稳定字符串码或 `null`；未知码按第 7 节回退                      |
| `attempt`                  | 非负整数，worker 已领取的尝试次数                               |
| `max_attempts`             | 正整数；当前仓储默认 5，允许 1–10，不由浏览器请求决定           |
| `cancel_requested`         | 布尔值，取消申请是否已提交                                      |
| `request_id`               | 格式受限的请求追踪 ID 或 `null`                                 |
| `created_at`、`updated_at` | 服务端时间字符串                                                |

| status       | 是否终态 | 客户端处理                                                |
| ------------ | -------- | --------------------------------------------------------- |
| `queued`     | 否       | 已持久化，等待 worker；取消通常立即进入 `cancelled`       |
| `running`    | 否       | worker 执行中；申请取消后等待安全点，不能立即显示取消成功 |
| `retry_wait` | 否       | worker 在有界重试间隔内等待；仍占用本人活动任务名额       |
| `completed`  | 是       | 读取 `result` 判断完成范围；不能将此状态等同于全量成功    |
| `failed`     | 是       | 显示稳定错误原因；删除任务不能自动创建一个新任务重试      |
| `cancelled`  | 是       | 无导出下载入口；取消不承诺撤销已经提交的删除              |

常规转换为 `queued → running → completed/failed/cancelled`，暂时性执行错误可以产生 `running → retry_wait → running`。实例退出后，过期租约可以重新领取，旧执行者不得覆盖新租约结果；达到尝试上限则失败。`queued` 和 `retry_wait` 可以直接取消。记忆清空等已经提交的删除遇到晚到取消时仍须报告真实完成结果。

`partial` 是 `result.completeness` 的值，**不是第七种公开 status**。当前仓储内部终态防御集合仍含 `partial`，不应将该集合直接导出为 API 枚举。未知状态或非法 kind/scope 组合属于不兼容结构，现有前端会拒绝该响应；升级时须协调部署。

当前 `progress.stage` 写入白名单为 `queued`、`starting`、`inventory`、`history`、`files`、`packaging`、`deleting`、`finalizing`；它用于描述阶段，不能用于证明操作已提交。总数为零表示尚未确定总量，界面不得据此显示完成。

## 4. 终态、结果与制品

结果只保存引用、摘要和计数，不保存用户数据正文。结果 JSON 当前最大 16 KiB，进度 JSON 最大 4 KiB。

| result 字段                 | 出现条件与语义                                      |
| --------------------------- | --------------------------------------------------- |
| `artifact_id`               | 导出制品标识；不是文件 URL 或宿主路径               |
| `sha256`                    | 制品最终字节的 SHA-256，小写 64 位十六进制字符串    |
| `size_bytes`                | 制品非负整数字节数                                  |
| `expires_at`                | 导出生成后 24 小时的服务端有效期，含时区的 ISO 时间 |
| `completeness`              | `complete` 或 `partial`，说明此范围结果的覆盖情况   |
| `failed_resources_count`    | 单项失败资源数量，非负整数                          |
| `deleted_resources_count`   | 已执行删除或对应范围移入回收站的资源计数，非负整数  |
| `remaining_resources_count` | 未删除或未完成的资源计数，非负整数                  |

这些字段在 DTO 中都是可选项，`result` 可以为 `null`。当前偏好删除结果只写删除数及剩余数，不携带 `completeness`；不能把缺少该字段自动解释成整个账号已清空。宿主范围删除即使状态为 `completed`，仍可能是 `partial`。

下载路由重复检查 owner、导出 kind、`completed` 状态、有效期和制品存在性。未完成返回 `409`；制品缺失、过期或不可下载返回 `410`；未知或他人任务返回 `404`。单类下载媒体类型为 `application/json`，`account` 为 `application/zip`。不要根据内部存储文件扩展名推断组合包类型。

当前 worker 为生成的制品计算摘要，并在组合包内复核子制品；这不等于浏览器下载端已经执行完整性复核。当前前端结果校验只确认 `sha256`/`expires_at` 为字符串，未强制摘要格式或时间语义；当前下载路径也不逐次重算文件 SHA-256。加强下载校验属于后续要求，不得描述成已经实现。

单类 JSON 制品最多 10 MiB，组合包原始内容合计最多 64 MiB。制品到期后 worker 会清理，任务元数据仍可显示；完成状态不保证永远可下载。文件单类另受 5,000 文件及 7 MiB 原始数据边界约束，读取失败或截断需要保留覆盖说明。

## 5. 幂等重放与恢复边界

服务端仓储已经支持同一 `owner + Idempotency-Key` 重放：kind 与规范化 scope 相同则返回原任务，不消耗新建额度；改变 kind 或 scope 返回 `409`。键只允许 `[A-Za-z0-9._:-]`，长度 1–128。每位用户最多一个活动任务；每个固定一小时窗口最多创建十个新任务，超额返回 `429` 与 `Retry-After`。

**逻辑提交要求**：一次用户确认对应一个幂等键。发送成功但响应丢失、网络重试、失败后确认原提交结果，都必须保留原键及原 kind/scope，重放同一次提交；用户明确发起新的任务才生成新键。客户端不应把未知提交结果当作“未创建”。

**前端恢复行为**：产品页将一个未确认请求的 `kind`、`scope` 和 `Idempotency-Key` 保存在按认证用户分区的 `sessionStorage` 中，不保存删除确认短语、任务正文或响应内容。页面重载后只展示恢复入口，不会自动发送请求；用户主动重试时仍使用原键和原范围，因此服务端返回原任务或在首次请求未到达时创建该任务。收到可验证的任务响应后才清除记录。若读取、写入或清理恢复记录失败，前端暂停新任务；若记录已在内存中，仍可用同键显式恢复。账号切换会卸载旧状态并读取新用户分区。此机制依赖当前浏览器标签页的会话存储；关闭标签页会结束会话恢复能力，用户可从服务端任务历史继续查看已创建的任务。

**恢复限制**：服务端仍会先执行认证、运维开关及当前宿主能力检查，再进入幂等仓储；能力或配置变化时，重放可能先得到 `404` 或 `503`，而非读取原任务。删除恢复只重放用户此前已确认的逻辑请求；前端不存储确认短语。服务端键校验和 owner 隔离仍是最终边界。

HTTP 路由仍会先执行认证、运维开关及当前宿主能力检查，再进入幂等仓储；能力或配置发生变化时，重放可能先得到 `404` 或 `503`，而非绕过检查读取原任务。相同 key 不提供跨账号访问能力，也不代替执行权限。

worker 对同一任务的租约恢复与客户端重新创建任务是两件事。界面只允许对明确可重试原因的失败导出发起新的任务；删除始终不能用“重试”按钮自动创建新任务。

## 6. 分页与可选快照字段

任务与管理员审计使用 `limit`/`offset`：limit 为 1–100，offset 为 0–1,000,000。当前后端多读一条哨兵记录后返回准确 `has_more`，不会把哨兵放入响应数组。任务分页含 `jobs`，审计分页含 `events`；一页不能代表完整历史。

旧版 v1 宿主允许省略任务和审计的 `has_more`。前端兼容回退为“当前数组长度达到 limit 时可能有下一页”，可能多走一次空页；有明确布尔值时必须优先采用它。此兼容规则不适用于文件目录。

文件分页响应必须包含 `api_version`、`files`、`total`、`limit`、`offset`、`has_more`、`next_offset`、`truncated`、`failed_count` 和字符串数组 `coverage_notes`。`has_more` 必须为布尔值；`next_offset` 必须为整数或 `null`，不能省略。当前快照服务在还有数据时返回 `offset + 本页条数`，否则为 `null`；后续页不得重新从零开始或无限重复同一 offset。

文件条目的 `source` 只有 `thread_upload`、`thread_output`、`thread_workspace`、`project_document`。元数据含文件标识、名称、大小、授权内容 URL 与对应线程或项目标识；内容打开时 Gateway 仍要再次校验 owner，目录缓存不是下载授权。

以下快照字段属于 v1 可选新增项，旧版响应可以省略：

| 字段                       | 类型                    | 含义                         |
| -------------------------- | ----------------------- | ---------------------------- |
| `catalog_updated_at`       | ISO 时间字符串或 `null` | 上次快照更新时间             |
| `catalog_stale`            | 布尔值                  | 当前返回的是陈旧快照         |
| `catalog_refresh_deferred` | 布尔值                  | 本次刷新因间隔或租约约束延后 |

目录扫描有上限，`total` 是当前有界目录的条数，不能被解释为账号所有文件总数。达到上限、来源失败或旧快照状态须由 `truncated`、`failed_count`、`coverage_notes` 和可选快照字段说明。

## 7. 稳定错误码与未知回退

公开 `error_code` 只允许稳定诊断码，不承载异常消息、文件路径、用户内容或凭据。当前仓储写入格式为 `[a-z][a-z0-9_]{0,79}`。HTTP 请求失败的任意 `detail` 仍属于诊断信息，界面采用操作对应的本地化提示。

| 已知 error_code                                                                                   | 前端安全原因分类                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `temporary_storage_error`、`worker_lease_exhausted`                                               | 暂时性失败                                       |
| `scope_unavailable`、`no_export_scopes_available`                                                 | 请求范围暂不可用                                 |
| `export_size_limit`、`account_export_size_limit`                                                  | 超出导出大小上限                                 |
| `unsupported_job_kind`、`unsupported_scope`                                                       | 不支持的任务或范围                               |
| `invalid_deleter_result`、`invalid_export_data`、`invalid_reader_page`、`scope_export_incomplete` | 宿主或制品数据不符合约定                         |
| `invalid_scope_artifact`、`scope_artifact_integrity_error`                                        | 制品完整性问题                                   |
| `cancelled_by_owner`                                                                              | owner 申请取消；按取消状态展示，不作为可重试失败 |

未知字符串错误码仍是合法 DTO 字段：保留任务及分页响应，映射为 `unknown` 并显示通用本地化失败文案。不能因为新 worker 增加了一个错误码就拒绝全部历史；也不能把未知码或原始异常文字直接显示给用户。映射必须检查白名单自身属性，`constructor`、`toString` 等原型键不能命中分类。

当前仅“暂时性失败”和“范围暂不可用”分类允许界面重建失败导出；未知原因不自动重试。状态、scope 和字段类型仍须结构校验，未知错误码回退不意味着接受畸形响应。

## 8. 新增删除能力发现约定

本轮源码新增已认证 `GET /api/product/v1/data-capabilities` 路由及前端适配器；尚未进行运行验收。响应结构如下：

```json
{
  "api_version": 1,
  "deletion_scopes": {
    "preferences": true,
    "memory": false,
    "files": false,
    "threads": false,
    "projects": false,
    "agents": false,
    "scheduled_tasks": false
  }
}
```

七个布尔字段均需明确返回。当前前端对顶层两字段和七项范围采用严格集合校验，缺少、额外或类型错误都拒绝；增加新范围或顶层字段须协调前后端部署或提供新版本，不能套用普通可选字段增加的兼容规则。

这些布尔值表示当前宿主及扩展具备实现该范围删除的必要能力，**不表示当前账号已获所有删除权限、所有资源都可删除、删除范围完整、任务必然成功或可以直接跳过确认**。`account` 不在删除能力字典中。接口不能返回 user ID、密钥、宿主路径或 memory backend 内部配置。

能力读取先检查任务运维开关、认证身份与产品存储对象是否存在，不执行资源扫描、读取、删除或数据库健康探测。偏好删除由产品自身提供；其余字段复用已有 `can_delete_*` 判断。会话、项目、计划任务、自建 Agent 与文件需要清单读取及对应删除方法；项目和文件还需要宿主显式支持标记。记忆清空单独要求 `supports_memory_clear` 为真且提供 `delete_memory`，不需要清单读取方法。缺少旧宿主可选能力返回对应 `false`，不能为此引入私有 `app.*`/`deerflow.*` 导入。

前端在弹出破坏性确认前读取能力；请求失败、响应结构未知或 capability 为 `false` 时显示本地化说明与重读入口。旧宿主没有此路由时不猜测七项均支持。能力变化可能发生在确认之后，`POST /data-deletions` 仍保留现有 owner、确认短语、权限、能力与存储检查，worker 执行时仍复核资源归属。

## 9. 验证范围与待完成项

本契约按 `api.py`、`settings.py`、`jobs.py`、前端 `api.ts` 和 `data-job-failure.ts` 静态整理，没有执行接口或运行验收。以下事项须分别记录实现及证据：

- 删除能力发现接口及前端适配器的 HTTP/DOM 回归执行与真实账号切换浏览器验证。
- 客户端同一逻辑提交的幂等键保存、响应丢失后重放及切换账号恢复边界。
- 跨 Python/TypeScript 的同一 DTO 样本校验；当前两端校验独立，并非由本文件自动生成。
- 制品摘要和有效期的下载端语义校验；现有字符串校验不能作为完整性验收依据。
- PostgreSQL 并发、跨 Gateway 租约恢复及共享制品目录集成验证。

完整账号擦除、完整备份与运行续接状态迁移仍未交付；对应 `data_privacy` 展示开关应保持关闭。不能将本文件或单项静态格式化结果作为全项目验收通过的证据。
