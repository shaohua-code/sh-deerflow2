---
name: deerflow-upgrade
description: 当用户要求将本仓库的 Flow Desk 与 DeerFlow 官方稳定版进行兼容核对或升级时使用；在本仓库中，用户发送 --升级 即触发此流程。
metadata:
  short-description: DeerFlow 上游升级与兼容检查
---

# DeerFlow 上游升级 Skill

## 快速调用

- 在 Codex 对话里发送 `--升级` 即可触发本流程；它是本仓库约定的任务触发词，不是 PowerShell 命令。
- 每次都会重新查看官方稳定版和本地状态。没有更新时只写检查记录；有更新时先分析自有改造和上游兼容，再做本地代码升级。
- 本流程只负责本地仓库的核对、改造和验证，不会连接服务器、迁移生产数据库或推送代码。

按官方 DeerFlow 稳定版检查并升级本仓库的 Flow Desk 产品化分支。用户输入 --升级 时，执行本流程，不要只描述流程。

## 本仓库约定

- 官方上游仅指 https://github.com/bytedance/deer-flow 的正式发布标签和官方发布说明。默认跟随最新稳定 Release；用户明确要求 main、预发布版本或指定 tag 时才切换目标。
- 自有 Git remote 是 origin。它属于用户的产品仓库，绝不改名、覆盖、推送或用上游地址替换。
- 本地 Git 历史可能没有 DeerFlow 上游共同祖先。每次运行都重新检查来源关系；上次核验版本和来源基线以 `docs/上游补丁台账.md`、`docs/upgrades/` 中的记录为准，版本字符串相同不代表源码相同。
- 产品前端主要位于 frontend/src/product/，自有 Gateway 扩展位于 product/backend-extension/，部署配置位于 product/deploy/。逐条复核 docs/上游补丁台账.md 的 P 项；不要把“在产品目录之外”误当成自动兼容。
- 用户要求保留未提交工作，不删除电脑文件、不改其他项目或本机配置。只在本仓库内完成已授权的代码/文档操作，不连接或部署到服务器，不触碰生产数据库。
- 详细模块规则按变更读取 backend/AGENTS.md、frontend/AGENTS.md，以及对应目录最近的 AGENTS.md。不要修改 CLAUDE.md。

## 本仓库已核实的上游来源基线

截至 2026-10-09，本地初始化提交 `f8d6980dd43fe70fd831e9a747699b6fac5d813f` 与官方 DeerFlow `v2.1.0`（`345f08be00c8a9495079b732a39b46aa9af1584e`）没有共同祖先，根 tree 哈希也不同。逐文件核对发现 2,813 个文件完全相同、94 个共有路径内容或模式不同、57 个仅官方存在、3 个仅本地存在。基线和完整路径清单见[源码差异报告](../../upgrades/2026年10月09日逐文件源码差异.md)；不能把 94 个不同路径一概视为产品补丁。

处理未来版本时分开审查三种差异：官方上一 tag 到候选 tag 的上游变化、本地初始提交相对 `v2.1.0` 的历史差异、当前工作区中 Flow Desk 的自有改造。以[上游补丁台账](../../上游补丁台账.md)核对产品改造，并对每个冲突路径记录处置和回归测试。

特别关注数据库迁移：官方 `v2.1.0` 有 `0025_repair_run_change_seq`，本仓库已使用同一迁移序号 `0025_user_active`，并继续到 `0026_iam_oidc_token_vault`。不要直接复制或重命名 revision 文件，否则已部署数据库可能因未知 revision 无法启动。本仓库已在当前 head 后加上 `fd_0027_repair_run_change_seq`，保留原有 revision ID，并用 SQLite 回归模拟“版本记录已到 `0024_project_documents` 但运行变更表/列/索引缺失”；迁移链与仓储读写回归 8 项通过。后续上游若继续调整这段 schema，必须保留该修复或提供向前兼容的新迁移，并复核旧 stamp；PostgreSQL 副本验证仍是发布前待办。

## 执行流程

1. **检查工作区。** 记录当前分支、HEAD、remote 名称/URL 和 git status。保留所有未提交和未跟踪文件。禁止 git reset、clean、stash、强制 checkout、覆盖式复制和任何清理用户数据的命令。绝不改写 origin。
2. **核实官方目标。** 浏览 DeerFlow 官方 Releases 和目标 tag 的发布说明，记录核验日期、版本、tag、上游 commit 和是否为稳定版。不要只根据官网首页、main 分支或搜索摘要判断版本。查看官方 changelog 中的破坏性变更、安全修复、数据库迁移、配置迁移、API 与前端契约。
3. **核对本地版本。** 检查 backend/pyproject.toml、frontend/package.json、deploy/helm/deer-flow/Chart.yaml 的版本；它们必须保持一致。比较当前版本和官方最新稳定版：
   - 本地已是目标版或高于目标版：不做代码降级；仍须用官方 tag/commit 与已有源码差异记录核实来源和兼容覆盖。版本号相同不代表已合入同一份源码；来源未核实就记录未验证风险，不能宣称兼容通过。
   - 没有比本地更新的稳定 Release：记录“无新版本”，不从 main 偷渡功能。
   - 存在新稳定版：进入来源基线评估。
4. **确认源码关系。** 查看 `git log`、`git merge-base` 与官方 tag 对象。仅在有可证明的共同祖先、差异可审阅且不会覆盖未提交工作的情况下采用常规合并/补丁流程。缺少共同祖先时：
   - 禁止 `git merge --allow-unrelated-histories`，禁止把上游归档整体解压覆盖到本仓库，也禁止根据相同版本号假设源码相同。
   - 先用官方 GitHub 比较页核对上一参考 tag 到目标 tag 的文件清单和提交差异（`https://github.com/bytedance/deer-flow/compare/<上次官方tag>...<目标tag>`），再查阅目标 Release、官方 changelog 和受影响文件在两个 tag 上的内容。
   - 先参考本仓库已保存的 v2.1.0 源码差异报告；使用隔离的官方克隆分别对比相邻官方 tag，并对本地实际文件和 `docs/上游补丁台账.md` 逐项形成“上游变化 / 本地自有变化 / 兼容处理 / 回归验证”清单。若 GitHub 比较页无法展示完整差异，或高风险文件的来源无法确认，就记录阻塞并停止该部分代码写入；不得猜测性覆盖。
   - 不需要新增或改写 `origin`，不需要为方便比较而修改本机 Git 配置。若确需获取源码对象，只能放在与当前工作区隔离的临时审查副本中；审查后保留来源和清理方式的记录，不把副本混进产品代码。
   - 对比已准备好的本地仓库和隔离官方克隆时，使用只读脚本 `scripts/compare_upstream_trees.py` 生成路径、模式、对象类型及 blob/tree ID 差异报告：`python scripts/compare_upstream_trees.py --local-repo . --local-ref <本地基线提交> --upstream-repo <隔离官方克隆路径> --upstream-ref <官方 tag>`。脚本只向标准输出报告已提交 tree，不检出文件、不访问网络、不改 remote；保存输出时使用一个确认不存在的新报告文件名。它只建立文件级差异清单，不判断差异归属，也不替代对官方变更、产品补丁和当前未提交工作区的人工审查。
5. **形成升级清单。** 按上游实际变化建立文件级候选清单，并把每项本地改造标记为保留、重做、由上游替换或删除。重点检查身份/owner 鉴权、线程与 SSE 重连、文件路径与下载、数据库 schema/migrations、配置默认值、sandbox 边界、认证/CSRF、前端 route/hooks/locale 以及产品扩展 API。单独核对 `deerflow-extension-api` 的 `API_VERSION`、`pyproject.toml`、Harness 精确 pin、Flow Desk 最低版本范围、`uv.lock` 和扩展 `@extension(api=...)` 声明；不能只改版本字符串而不跑公开 surface/契约测试。
   - 复核 owner 数据读取与变更能力仍是两个不同的公开契约：`OwnerDataReader` 是只读；`OwnerDataDeleter` 可选地开放计划任务定义、自建 Agent、本人会话历史、本人项目空间和本人记忆五种窄范围删除。计划任务必须在仓储事务内重查 owner、原子取消 queued occurrence、拒绝删除 launching/running 定义，并保留运行历史和会话内容。Agent 删除必须按 `AgentStore.list_owned` 清单调用 `AgentStore.delete(name, user_id=...)`，复用记忆 debounce 前后取消，并保留共享 legacy Agent 和纯记忆目录。会话删除必须从 owner-scoped thread 清单取 ID，再由 Gateway 重新核验 owner，在 goal lock 和 durable delete reservation 内清理工作区、checkpoint、事件、run rows 和 metadata；活动会话与失败操作应返回部分结果。项目空间删除只可调用支持显式 `user_id` 的 Gateway 项目仓储；项目定义被移除、会话解除关联、活动资料进入回收站，不能宣传为永久文件擦除。记忆删除只可调用配置管理器的 `clear_memory(user_id=...)`，必须验证具体 backend 覆写该能力，且任何异常或旧宿主都应失败关闭；清空提交后遇到晚到取消请求仍须报告真实完成结果。跨存储不是原子事务。扩展不得直连 `app.*`、ORM 或宿主表。
   - 完整账号导出/擦除仍未交付，`data_privacy` 必须继续关闭。组合 ZIP 与各范围 partial 导出都不是全账号闭环；只有 PRD 的完整数据覆盖、跨 DB/文件/记忆/Agent/调度清理、持久编排、失败重试与恢复清单均实现并验证后，才可重新评估功能开关。
   - 复核 P092 文件目录快照迁移 `fd_0007`：Gateway `OwnerDataReader.list_files` 仍是 owner 和访问 URL 的权威来源；产品表只缓存当前用户的有界元数据，不保存正文、宿主路径或授权凭据。确认五分钟 TTL、每用户刷新冷却/跨实例租约、快照原子切换、失败时保留旧数据并标陈旧、删除成功后的本人快照行失效、旧 Gateway 缺 reader 时文件 API 失败关闭，以及 SQLite/PostgreSQL 迁移链和 API additive 字段仍兼容。不得把可重建的 10,000 条扫描投影宣传成完整文件清单、备份或 Gateway 授权数据源。
   - 同步检查 docs/上游补丁台账.md（包括 P074/P075/P080/P081/P082/P083/P084/P085/P086/P087/P088/P089）；复核组合导出时保证七种原始 scope 能力、固定 ZIP entry、manifest 和 64 MiB 限制保持一致。复核 Skill 管理时保留 `skill.install`、`skill.reload`、`skill.custom.update`、`skill.custom.delete`、`skill.custom.rollback`、`skill.enable`、`skill.disable` 稳定动作码，并确认仅持久化成功后审计、事件不含 Skill 名称或内容。复核会话数据导出时，运行摘要须先校验线程 owner，再以相同 owner 查询 RunStore，只投影状态、时间、Agent 标识和 token 计数；不导出请求参数、错误正文、任意 metadata、stop reason 或 worker lease，且游标按 UTC 时间与 run ID 稳定倒序推进。旧 Gateway 缺少可选 `list_thread_runs` 时必须明确提示部分覆盖。复核工作台最近文件时，保留 `files` 功能开关、按用户 ID 分区的查询缓存、静态演示不加载个人数据，以及由 Gateway owner-check 保护的 artifact URL；不得改为前端直接扫描文件系统。复核工作台状态摘要时，活动线程必须从 owner-aware 搜索接口按 `busy` 状态有界读取，Agent 使用频率仅由账号分区的最近会话摘要统计，并保持静态演示隔离与双开关门禁。检查 Extension API 版本时同步 `API_VERSION`、包元数据、Harness pin、`uv.lock`、产品扩展下限和 `@extension(api=...)`，并运行对应公开 surface、owner reader 和 worker 分页回归。不确定归属的文件不要覆盖。
   - 保留 `FLOW_DESK_DOCS_REPOSITORY_BASE` 与 Nextra `docsRepositoryBase` 接入；检查产品文档页的反馈/编辑链接仍指向自有仓库，而不是上游 DeerFlow 或 Nextra 默认仓库。Playwright 的隔离目录、端口与回环代理绕过只在测试进程及仓库目录内生效，不要迁移成全局机器配置；隔离产物必须继续被 Git、Tailwind 和 ESLint 排除。
   - 复核 `docs/快速启动.md` 与 `product/deploy/README.md` 中 Flow Desk 扩展安装命令仍匹配 Harness 扩展 CLI：必须从仓库 `product/backend-extension` 安装可信源码、保留 `required` 门禁，并只在插件私有 `config` 中合并产品功能开关；不得把首次安装误写成每次启动步骤，也不得改成全局 Python/PATH 配置。

6. **实现候选升级。** 保持产品层和 DeerFlow 引擎边界。先写必要的回归测试，再做最小兼容改动；新增数据库迁移必须由正确的模块拥有，并验证升级路径。对任意 Python 扩展、依赖安装脚本或构建钩子做代码审查后才纳入。不要启用需要真实凭据、真实用户数据或服务器连接的测试。
7. **同步版本和文档。** 新稳定版确认、候选代码及四处版本字段均检查完成后，按仓库约定运行 `scripts/bump_version.sh VERSION`，随后执行 `scripts/verify_versions.sh VERSION`。版本脚本会先预检全部版本源再写入，若字段缺失或格式异常须先修正脚本/源文件并复核，不能手工只补一个版本号；同版本重复运行应无改动。版本脚本不创建 tag 或推送代码，升级流程也不得执行它输出之外的发布动作。更新必要的 README.md、中文 README、相关 AGENTS.md、部署说明、补丁台账和产品文档。旧 config.yaml 不自动覆盖；按 config-upgrade 流程合并新默认项并记录人工决策。
8. **验证和回退边界。** 根据修改范围运行相关测试；前端至少按需运行 pnpm check/相关 rstest，后端按需运行受影响 pytest、make test 和 blocking-I/O 检查，Docker/依赖变更要做构建或 Compose 配置验证。数据库迁移须在隔离数据库副本验证。只读检查可运行；不得对服务器执行部署、迁移或回退。
9. **保存记录。** 每次运行新建中文文件名的 `docs/upgrades/YYYY-MM-DD-HHmm-<中文主题>-v版本号.md`（同一天重复检查时保留每次记录），例如 `2026-09-28-1630-无新稳定版本-v2.1.0.md`；核对记录也使用中文主题，例如 `2026-09-27-v2.1.0-上游候选基线核对.md`。记录官方来源链接、核验时间、本地 HEAD/版本、上游基线可信度、patch 处置、改动文件、测试命令及真实结果、未验证风险和回退依据；然后更新 `docs/上游补丁台账.md` 的最近检查链接。未执行的步骤标记未执行，不能写成通过。

## 停止条件

- 未发现更新的稳定 Release：停止所有版本/依赖/源码改动，只保留升级检查记录。
- 上游版本更新但本地来源树无法安全比对：只完成影响分析与报告，不猜测性覆盖核心文件；明确需要取得的官方源码对象或建立的隔离基线。
- 工作区有用户改动：始终保留，只有能精确区分和安全编辑时才继续。
- 需要生产凭据、线上数据库迁移或服务器访问才能验证：留在本地代码和隔离测试范围，报告未完成的部署验证。
