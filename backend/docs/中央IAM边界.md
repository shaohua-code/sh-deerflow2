# 中央 IAM 接入边界

**2026-10-12 模型调用授权边界：** Gateway run 中，每次 LangChain model dispatch 都按服务端绑定的确切 DeerFlow 模型档案重新检查 `model:use`；统一模型工厂覆盖标题、摘要、评估器和子 Agent 等辅助路径。DeerMem 自己构造的后台模型通过 Gateway 注册的 host callback，在 provider invoke 前重新核验当前用户/vault、`memory:read/write` owner 范围和模型档案授权。Harness 不导入 `app.*`；Gateway 在构造/预热 memory manager 前注入回调。拒绝、超时和授权服务错误都停止外呼。本轮定向授权回归 28/28、Harness boundary 1/1 通过。Python readabilipy fallback 修复后保留安全链接/图片目标，web-fetch 现有回归 50/50、Ruff 通过。修复前 Windows 全量后端为 16,750 通过、442 失败、345 跳过、3 deselected；阻塞 I/O 为 116 通过、26 失败、1 跳过。修复后未重跑全量，其余全量失败尚未逐项归因。临时测试产物已清理；真实 IAM/Provider E2E 尚待完成。

本文件承接 [后端总览](../AGENTS.md) 的中央 IAM 细则。IAM 权限与本人数据范围、本地 owner 过滤是独立边界；新增路由应先完成拒绝前置，再访问存储，并补相应回归。IAM 迁移只登记权限码，不自动授予角色。

**2026-10-12 DeerMem 后台用量接线：** memory updater 的定时模型调用现由 Gateway host callback factory 在每次调用前从当前用户和匹配 vault session 创建单次 IAM usage callback，并只附加到本次 invocation；结果回调清理并关闭 capability 后，才向扩展 observer 派发无凭证配置。关联 memory commit/usage callback 回归 20/20、Harness boundary 1/1 通过，6 个变更 Python 文件 Ruff check/format 通过，临时测试目录已删除。全量测试、目标数据库和真实 IAM/Provider E2E 未验收。

## 控制台汇总

- `/api/console/stats` 在打开 SQL session 前要求 `runs:read`、`threads:read`、`agents:read` 和三项对应的本人数据范围。
- `/api/console/runs` 返回会话标题，因此同时要求运行与会话读取权限及范围；`/api/console/usage` 要求运行读取权限和范围。
- 所有查询继续按本地 `user_id` 过滤，并保留拒绝发生在查询前的测试。

## 模型授权与额度

- `model.invoke` 与 `model_resource_ids` 只约束模型访问，不等于 RPM/TPM 强制额度。可选 `IamModelUsageCallback` 通过运行作用域 ContextVar 传递；`create_chat_model()` 按可信的 DeerFlow 模型配置名绑定到每个 LangChain 实例，不能信任请求 metadata 或 Provider 部署别名。
- `authorization.provider.config.model_usage.enabled` 默认保持 `false`。显式启用时，每个模型映射到 IAM UUID，配置正数 `reserved_output_tokens`，并只向 API 进程密钥存储注入 `IAM_MODEL_USAGE_API_KEY`。
- 回调在调用 Provider 前预留额度，用同一 request ID 结算和上报；通过已验证 vault access token 请求 `/api/v1/auth/me` 获取标准 IAM `user_id`，因为 OIDC `sub` 不透明。预留失败必须在 Provider 调用前向上抛出。只有收到可信终态和可用量时才结算；`on_llm_error()` 或 `close()` 本身不能证明 Provider 未执行，因此保留 reservation 供 IAM 管理员核对，只有确认 Provider 未调用时才可释放。
- DeerFlow `fd_0028_iam_model_usage_outbox` 为本地已提交事件提供 SQL outbox 重试，但无法恢复 Provider 完成与 outbox 本地提交之间崩溃时丢失的实际用量；该 reservation 保留给 IAM 管理员核对。估算时可以短暂检查提示和回复文本，但请求载荷、回调 metadata、checkpoint 和日志不得保存内容或 token。
- DeerMem 是目前静态扫描发现的唯一 `init_chat_model()` 直连模型构造路径，现由 Gateway per-invocation factory 补齐 usage callback；其它 Gateway Agent 模型走共享模型工厂或 `authorized_model_usage_scope`。非 LangChain/custom Provider 与真实数据库重启/故障链路仍需独立确认和验收；quota enforcement 保持关闭。

## Skill、子智能体与 MCP

- 用户 Skill API 在访问个人自定义 Skill 存储前检查 `skills:read/write/delete` 和匹配的 IAM 本人范围；管理员操作个人路由时也不能越过本地用户目录。更新和回滚响应包含完整内容，因此写入前同时检查读、写权限及范围。
- 共享 Skill 启停/缓存刷新、托管子智能体写入，以及 MCP 配置/缓存操作同时要求映射的 IAM 管理权限和现有 Gateway 本地管理员检查。
- 子智能体元数据要求 `subagents:read`；系统提示词仅在本地管理员身份和 IAM `subagents:admin` 同时成立时返回。
- `0029_deerflow_agent_extension_permissions` 迁移只登记权限码，不发角色；部署侧必须显式配置权限映射与范围。

## 个人连接与部署渠道

- 个人 IM 连接、飞书集成状态/配置/OAuth 路由在读取或修改用户数据前检查对应 IAM 路由权限及本人范围，并继续用本地 `user_id`/owner 过滤。
- 共享 `/api/channels` worker 状态要求 `channels:read`；重启 worker 要求 `channels:admin` 加现有本地管理员检查。部署级渠道运行配置和飞书安装也要求映射的 `*.admin` 权限及本地管理员检查。
- `0028_deerflow_connector_permissions` 迁移只登记六个权限码，不发角色。试点启用前由 IAM 显式配置角色授予和个人 self 范围，不能从界面开关或不可信请求字段推断授权。
