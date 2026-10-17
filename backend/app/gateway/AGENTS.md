### Gateway API (`app/gateway/`)

`routers/console.py` returns cross-resource aggregates: stats needs `runs:read`, `threads:read`, `agents:read` permissions and each matching Central IAM self scope; runs history also needs run/thread permissions and scopes because it returns thread titles; usage needs run read. Check every scope before `_session_factory_or_503()` and keep local `user_id` filters. Do not grant these automatically in IAM migrations.

Project create/update/archive/restore must check `projects:write` (`action="write"`) and, because their responses contain the full project row, `projects:read` (`action="read"`) before repository mutation. Project deletion must check `projects:delete` (`action="delete"`) before mutation. Pass the authenticated local `user_id` explicitly to every project write; IAM owner/self scope and local repository ownership are both required.
Project-document upload and thread-file promotion check project write plus read scopes before staging; promotion also checks `threads:read`. Attaching a shelf document checks project `read` and target-thread `write` scopes before staging or ingestion. Moving a document to trash and single/batch purge require `projects:delete`; restore checks project write/read scopes for the target before restoring. Trash retention cleanup is a destructive side effect of listing: check delete scope first, and skip only the cleanup (keep the authorized list response) when scope is denied or unavailable. Resolve trash rows through the local owner filter before using their project IDs for resource-scoped checks. Pass the authenticated local `user_id` explicitly to mutations.
Owner-checked thread/run mutations must also call Central IAM data-scope authorization after the local ownership check and before the handler: `threads:write/delete`, `runs:create/cancel`. Thread writes/deletes use `thread_id`; run cancellation uses the existing `run_id`; run creation must not invent an ID before admission. Add a denial-before-handler regression whenever adding an owner-bound mutation. Other user-data writes without this decorator still need a route-by-route scope audit.
Scheduled-task routes must check the current account's IAM self data scope before reading or mutating the owner-filtered task repository: list/get use `threads:read`, create uses both `threads:write` and `runs:create`, update/pause use `threads:write`, resume/manual trigger also use `runs:create`, delete uses `threads:delete`, and task-run history uses both `threads:read` and `runs:read`. Reused-thread schedules must also check `threads:read` for the referenced thread before `check_access`. Keep local `user_id` filtering on every repository operation. The background scheduler also revalidates the active owner, current IAM grants/data scopes, and matching vault session before queue admission and again before launch; denied access pauses the task and cancels queued work. Keep the tests that pin this lifecycle.


IAM data-scope guards run before protected reads: projects, global thread search, direct owner-checked thread/run reads, project documents/content, project thread-file aggregation, trash, and personal memory data all check their matching route target before storage/query access. Memory routes require `memory:read/write/delete/admin`; because write responses include the whole document, they also check `memory:read` scope before modifying memory. Browser memory requests that include `X-Expected-User-Id` must match the authenticated `request.state.user.id` before data-scope checks or storage access; keep the header optional for older API clients and trusted internal callers. `/api/memory/status` returns private `backend_config` fields and therefore requires both `memory:admin` and `memory:read` before reading configuration or memory. Keep the IAM check fail-closed; do not assume a successful list query protects direct-ID routes.
个人偏好 API 的 `preferences:read/write` 必须保留在 Gateway `_ALL_PERMISSIONS` 中，才能在未启用外部授权时正常使用；启用中央 IAM 后仍需独立权限与本人 data scope。浏览器 session、请求账号核对和本地 owner 过滤不能因权限清单齐全而省略。
自有 Gateway 扩展可通过公开 `deerflow_extension_api.require_data_scope()` 请求当前 HTTP 请求的中央 IAM row scope；宿主在 `app.state` 注入异步 checker，并复用 `require_iam_data_scope_for_request()`，扩展不得导入 `app.gateway.authz`。`Flow Desk` 的产品偏好、文件目录与数据任务请求需在产品存储访问前同时检查 route grant 和对应 data scope。当前请求之外的持久任务只能使用 `ExtensionRuntimeDeps.owner_data_authorizer`：Gateway 重新加载活跃账号、刷新服务端 vault 会话并重算 route/data scope，在领取和每个数据批次前调用；403 终止任务，503 有界重试。不得保存或伪造 Request，不得把 IAM 凭据或授权快照写入任务行、运行 context、checkpoint 或日志。产品数据任务列表也必须按每条任务 scope 重新授权并隐藏已撤权条目。
The custom-Agent router has an additional boundary: per-user Agent list/name-check/detail routes require `agents:read` plus its owner/self scope; create/update require both `agents:write` and `agents:read` because responses return the complete Agent definition, and both matching scopes are checked before store access; delete requires `agents:delete` and delete scope before mutation. Preserve the store's local `user_id` filter on every path. `/api/user-profile` addresses deployment-wide `USER.md`, which is injected into all custom Agents; both read and write require the separate `agents:admin` permission. Never expose that shared profile route to PATs. Keep the IAM example map synchronized and do not grant these permissions automatically in migrations.

Run admission copies the effective `AuthContext.permissions` into the server-owned `config["context"]["route_permissions"]` snapshot for built-in tools; strip client-supplied values from both config sections and never place the snapshot in `configurable` (which is checkpointed). `setup_agent` and `update_agent` use this snapshot because they write the Agent store directly instead of calling the protected HTTP mutation routes.

`conversation_access.py` binds an opt-in read-only tool to a run request's
explicit `conversation_references` and effective `runs:read` permission. Never
derive grants from message contents or checkpoints. The callback travels through
`RunContext`, not serialized config; the worker owns its context injection and
terminal cleanup. `conversation_reader.py` shares the existing HTTP transcript
visibility/pagination logic without a Request dependency; ownership remains a
caller responsibility. The tool additionally excludes non-text/internal content.
`RunCreateRequest` also accepts the list as `context.conversation_references`
(LangGraph SDK clients cannot send top-level extras): a before-validator lifts
it into the top-level field, so bounds and error locations are shared, and drops
it from `context`, so `merge_run_context_overrides` never sees it; sending both
is a 422. `conversation_references_enabled()` is the one "tool is configured"
predicate, used by admission and by `/api/features`.

Flow Desk 的 owner 数据读取、删除、审计与文件目录约束详见 [Gateway 产品数据边界](../../docs/产品数据边界.md)。修改 `owner_data_reader`、`owner_data_deleter` 或产品审计接入点前，先阅读该文件；产品扩展不得直接导入宿主私有模块或绕过 Gateway owner 校验。

### Upload path compatibility

`ThreadUploadIngestionService` owns ordinary uploads and project-shelf attachment staging. The shared upload manager limits each basename to 255 UTF-8 bytes; on Windows, Gateway additionally computes a conservative basename budget from the complete uploads directory path and reserves the longest temporary `.part` name. Long but otherwise valid names are shortened on a UTF-8 boundary, extensions are preserved when they fit, and the API returns `original_filename` whenever storage uses a shortened or deduplicated name. Keep retries and converted Markdown sidecars inside the same budget; do not rely on machine-level long-path settings.

FastAPI listens on port 8001; health: `GET /health` (liveness) and `GET /health/ready` (readiness; concurrently probes the ORM engine behind `database:` plus the effective LangGraph checkpointer/Store backend - the legacy `checkpointer:` section, otherwise derived from `database:`, resolved from the startup config snapshot recorded on `app.state` - beneath a single bounded deadline, with connection-opening probes serialized behind a strict per-process gate, 503 while either is unreachable or the startup backend cannot be resolved, `not_configured` for process-local backends such as `backend=memory`). Set `GATEWAY_ENABLE_DOCS=false` to disable the default `/docs`, `/redoc`, and `/openapi.json` endpoints.

Flow Desk 的 `/api/product/v1/public-brand` 是唯一向匿名浏览器公开的产品 API：必须在
`AuthMiddleware` 的精确 allowlist 中登记，并用严格 DTO 仅返回品牌 `name` / `name_zh`；不得
返回 UI 功能开关、扩展私有配置、用户身份或管理员状态。读取在线品牌配置失败时退回部署默认名；
前端仍以源码品牌做首屏回退。扩展/路由未启用时登录和公开页面必须保持可用。

`build_run_config()` resolves the default LangGraph super-step budget from the
hot-reloaded top-level `recursion_limit` setting. A valid request-level value
takes precedence; invalid values fall back to that default, and
`max_recursion_limit` caps both sources.

Durable MCP notifications use internal Agent runs. Keep their trusted delivery instruction outside the user-input boundary, and frame serialized remote events as untrusted before model invocation. Strict thread existence/ownership admission dead-letters events whose task outlives its deleted chat instead of recreating the thread.

CORS is same-origin by default when requests enter through nginx on port 2026. Split-origin or port-forwarded browser clients must opt in with `GATEWAY_CORS_ORIGINS` (exact origins); Gateway `CORSMiddleware` and `CSRFMiddleware` both read that variable so browser CORS and auth-origin checks stay aligned. Those clients also need `CORS_EXPOSED_HEADERS` (`csrf_middleware.py`): run-creating routes return the run's id in `Content-Location`, which is not CORS-safelisted, so JS cannot read it unless it is exposed — and the LangGraph SDK resolves run metadata from that header alone, so withholding it breaks `useStream`'s `onCreated` and thread-gated actions.

Browser auth sessions are owned by `app.gateway.auth.session_cookie`. Login accepts a `remember_me` form flag, but the Gateway never stores passwords. `SessionCookiePolicy` persists the `HttpOnly access_token` cookie only for HTTPS/trusted-forwarded HTTPS, direct-host localhost HTTP, or explicit operator opt-in for insecure persistence; public HTTP sandbox URLs degrade to session cookies. Session-creating handlers stamp the final `max_age` on `request.state`; CSRF cookie creation mirrors it so the double-submit pair expires together, including re-issue after password changes and OIDC callbacks. A small `HttpOnly` preference cookie preserves the remember choice across re-issues. Logout clears all auth cookies and suppresses CSRF re-issue on the logout response.

Personal Access Tokens (`app.gateway.auth.pat`, `Authorization: Bearer dfp_...`) run as their owning user: an invalid Bearer is a hard 401 with no cookie fallback, which keeps `CSRFMiddleware`'s Bearer skip safe (origin checks still run). PAT scopes are a curated subset of Gateway permissions and are never expanded automatically when `_ALL_PERMISSIONS` grows. A second exact path/method allowlist admits selected thread/run, project/document/trash, personal custom-Agent, and personal-memory routes; permission scopes and local owner checks narrow access within it. Models, preferences, MCP/skills configuration, integrations, channels, uploads, deployment-wide profile, and all unlisted methods remain denied; admin capability is suppressed. PAT management and `/change-password` require session auth; only SHA-256 digests are stored (`0017`).

Local administrators manage deployment accounts through the session-only `GET /api/v1/auth/admin/users` and `PATCH /api/v1/auth/admin/users/{user_id}` routes. Account status is part of the persisted user model (`0025`); disabling an account invalidates session versions and revokes active PATs, blocks local/OIDC/PAT authentication, pauses owned scheduled tasks, and asks `RunManager.cancel_active_runs_for_user()` to stop that owner's active Agent runs. The response reports locally stopped runs, cancellations awaiting a peer Gateway heartbeat, and outcomes that could not be confirmed; thread-operation reservations such as checkpoint writes are excluded. Scheduled dispatch checks the owner again before launching queued work. The final active admin cannot be disabled. These routes deliberately do not change roles or delete accounts. After a successful status write, the Gateway publishes a bounded `AdminActionEvent` to the public extension observer; the product extension persists it in its own audit table. Dispatch is best-effort after the account transaction commits, so a missing or failing extension cannot block account management and is reported through Gateway diagnostics.

Skill routes use the optional product audit observer after successful mutations: `skill.install`, `skill.reload`, `skill.custom.update`, `skill.custom.delete`, `skill.custom.rollback`, `skill.enable`, and `skill.disable`. The payload contains only the stable action code and `resource_type="skill"`; keep `resource_id` empty and never include a Skill name, description, archive path, or body. Scanner rejection, missing resources, and failed writes must not emit success events; observer dispatch remains best-effort and must not change the Gateway response.

Thread→project membership is written by thread creation (`POST /api/threads` with
a validated `project_id`), branch creation (the new row inherits the source
thread's project; an archived/deleted project degrades the branch to unassigned
instead of failing), and explicit moves (`POST /api/threads/{id}/move`); run
admission never modifies membership; it only pins the resolved project context
read-only into the run context. The server-reserved `deerflow_project_id`
metadata key is a read-only exposure of the `threads_meta.project_id` column and
is stripped from client writes.

Localhost persistence deliberately reads the direct request `Host` and ignores `Forwarded` / `X-Forwarded-Host`. Scheme and auth-origin reconstruction still consume forwarding headers. The bundled nginx sets `X-Forwarded-Proto`, but preserves an upstream HTTPS value and does not overwrite every forwarded header, so the outer trusted proxy must replace or strip client-supplied forwarding headers before traffic reaches DeerFlow.

Standalone local LangGraph Studio is recognized only through the upstream
`Auth.types.StudioUser` principal type, never by its reusable identity string.
The type is resolved once at import; an older SDK without it degrades to normal
owner scoping.
For that principal's assistant reads/searches, `langgraph_auth.add_owner_filter`
selects genuine server-registered assistants plus assistants owned by Studio;
all other resources remain owner-scoped. Assistant create/update handlers make
both `user_id` and `created_by=user` server-owned, because LangGraph gives
`created_by=system` privileged ownership semantics during run creation. The
custom application module in `langgraph_studio.py` is imported before the
locked in-memory runtime lifespan. At that pre-runtime boundary it derives
genuine system assistant IDs from the CLI-provided graph registry, removes
their persisted active/version rows so graph registration recreates them, and
demotes every other legacy `created_by=system` marker in both active assistants
and version history. This must happen before runtime 0.30.0 loads and purges
system-marked rows; a user application lifespan is too late. LangGraph executes
this file-backed custom app without first registering its module in
`sys.modules`; keep its annotations eager so dataclass processing remains
compatible with that loader, and preserve the direct file-loader regression
test. An empty graph registry or absent persistence file is a no-op, while
persistence parse/write errors fail startup closed. The harness requires
in-memory runtime 0.30.0 or newer, and a persisted store containing no
expected registered assistant row emits a drift warning so changes to
LangGraph's internal persistence contract are observable. With current
create/update writes and all legacy versions sanitized, ordinary
owner-scoped assistant version selection remains enabled.

**Router map**:

- `routers/auth.py` owns session/OIDC/PAT and session-only administrator behavior; preserve the middleware principal, CSRF/origin, and route-permission contracts.
- `routers/threads.py`, `routers/runs.py`, `routers/feedback.py`, and `routers/artifacts.py` own LangGraph-compatible conversation, streaming, run history, feedback, and artifact routes. Keep owner checks and run/thread reservations at the Gateway boundary. `GET /threads/{id}/summary` is the chat-header read: a stored thread row returns status, times, and metadata without materializing a checkpoint; only a checkpoint-only legacy thread falls back to the full read.
- `routers/uploads.py`, `routers/projects.py`, and `routers/trash.py` own user-file and project-document routes. Keep paths server-derived, recheck ownership before reads/deletes, and preserve safe generic 5xx responses.
- `routers/models.py`, `features.py`, `mcp.py`, `skills.py`, `memory.py`, `subagents.py`, and `integrations.py` expose the corresponding runtime capabilities. UI feature flags never replace server authorization.
- Product-only endpoints live in `product/backend-extension/` and use the public extension API with separate DTOs and migrations; do not add product persistence to the Harness ORM.

When adding a route, define a bounded request/response DTO, permission and owner semantics, a focused route test, and any required bilingual product copy. Use the running Gateway's OpenAPI as the current endpoint inventory rather than duplicating every handler detail in this guide.
Thread identifiers use the shared `deerflow.utils.thread_id` contract
`^[A-Za-z0-9_-]{1,64}$`. Caller-provided opaque IDs remain supported; UUIDs
are generated only for `None`, while explicit empty strings fail validation.
Gateway creation and state-producing request boundaries, embedded-client
entry points, filesystem/upload/event-store consumers, scheduled launches,
and the standalone Provisioner enforce the same contract before persistence
or workspace initialization. Route-addressable legacy IDs remain accepted by
pure reads and cleanup/control endpoints; deleting one best-effort removes
metadata and checkpoints but skips local filesystem cleanup, so the raw value
is never interpolated into a host path. New runs, workspace/sandbox
operations, and other state-producing mutations remain blocked.

**Message feed seq** (#4666): streaming `values` frames, `GET
/threads/{id}/state`, and `POST /threads/{id}/history` stamp serialized
messages with `additional_kwargs.deerflow_seq` so clients can place
checkpoint-kept messages against the paged feed; the REST reads resolve the
store via `threads.py::_optional_run_event_store` (a feed-less deployment
still reads threads), and `services.py::normalize_input` strips the
server-owned key from client input (#4380). Mechanism and identity rule:
`packages/harness/deerflow/runtime/AGENTS.md`.

**Workspace change review**: `packages/harness/deerflow/workspace_changes/`
captures a pre-run and post-run snapshot of the thread-owned `workspace` and
`outputs` directories. `runtime/runs/worker.py` performs the filesystem scan via
`asyncio.to_thread` and writes a `workspace_changes` event with category
`workspace` when changes exist. Uploads are intentionally excluded. Text diffs
are size-limited; binary, large, and sensitive-looking paths are persisted as
metadata only. Internal process-feedback directories never count as changes:
the scanner's `EXCLUDED_DIR_NAMES` drops `BROWSER_FRAMES_DIRNAME` (transient
browser screenshots) and `TOOL_RESULTS_DIRNAME` (the tool-output budget
middleware's default externalization subdir, `constants.py` is the shared
source of truth for both writers and the scanner), and the worker threads the
configured `tool_output.storage_subdir` through the snapshot capture as an
extra excluded dir name so custom storage locations stay excluded too.

**Run delivery receipts**: the worker derives delivery requirements from the
run's workspace snapshots rather than a client request option (files
created/modified under `/mnt/user-data/outputs`, minus internal
process-feedback exclusions) and idempotently persists a run-scoped
`run.delivery` receipt before the terminal run status; missing or
unverifiable `present_files` coverage downgrades the run to error, while runs
without changed outputs keep ordinary chat behavior. Journal mechanics
(callback attribution, receipt idempotency and retries, orphan recovery):
`packages/harness/deerflow/runtime/AGENTS.md`. Multi-worker deployments
require `run_events.backend: db` for shared, ordered delivery events; the
startup gate rejects process-local memory and JSONL event stores when
`GATEWAY_WORKERS > 1`.

**RunManager / RunStore contract**:

- LangGraph-compatible run requests validate their supported subset before creating a run. `runtime/stream_modes.py` is the shared backend contract for public stream modes and the worker's `graph.astream` mapping; the public `messages-tuple` mode maps to LangGraph's internal `messages` mode, while public `messages`, `events`, and other unsupported modes are rejected instead of being dropped or replaced with `values`. `app/gateway/run_models.py::RunCreateRequest` is shared by HTTP and internal scheduled launch paths, retains only truthful compatibility defaults for unimplemented options (`if_not_exists="create"` plus `None` placeholders), returns 422 for unsupported values including `on_completion="complete"`, `on_completion="continue"`, and `multitask_strategy="enqueue"`, and forbids undeclared SDK options so fields such as `checkpoint_during` and `durability` cannot be silently discarded. A placeholder must still accept the stock SDK's own default: `langgraph_sdk` drops only `None` from its run payload, so `stream_resumable=False` reaches every request and means "non-resumable", which is what DeerFlow serves — rejecting it 422'd every IM channel run (#4466). `tests/test_run_request_validation.py::test_gateway_accepts_langgraph_sdk_default_payload` pins the real SDK payload against this boundary; channel tests mock the SDK client and cannot catch this class of drift.
- `RunManager.get()` is async; direct callers must `await` it.
- The history batch helpers `list_successful_regenerate_sources()`, `list_edit_regenerate_runs()`, and `get_many_by_thread()` default to `user_id=AUTO`: they resolve the request user and fail closed when no user context exists. Migration/admin callers that intentionally need an unscoped read must pass `user_id=None` explicitly.
- Edit-and-rerun visibility is derived from edit replay runs (`metadata.replay_kind="edit"` plus `regenerate_from_run_id`) by `RunManager.list_edit_replay_visibility()`: the newest attempt for each source run is authoritative. Pending/running/success attempts hide the original source run; failed, timed-out, or interrupted attempts hide only the failed attempt so the original conversation reappears.
- When a persistent `RunStore` is configured, `get()` and `list_by_thread()` hydrate historical runs from the store. In-memory records win for the same `run_id` so task, abort, and stream-control state stays attached to active local runs.
- Thread metadata status switches to `running` only after `RunManager.try_start()` succeeds. Pending-cancelled runs therefore skip the old `running` projection, while clients may observe the prior thread status during the short worker-startup window.
- `cancel()` returns a :class:`~deerflow.runtime.CancelOutcome` enum: `cancelled` (local cancel), `requested` (the non-owning worker durably recorded the first cancellation action for the live owner), `taken_over` (non-owning worker claimed the run because the owner's lease expired — marks it as `error`), `lease_valid_elsewhere` (legacy/custom store lacks the durable request primitive — caller retains the safe 409 + `Retry-After` fallback), `not_active_locally` (heartbeat disabled, preserving the old 409 path), `not_cancellable` (terminal state), or `unknown` (not found in memory or store). `create_or_reject(..., multitask_strategy="interrupt"|"rollback")` persists interrupted status through `RunStore.update_status()`, matching normal `set_status()` transitions.
- Interrupt/rollback admission registers the replacement before its best-effort persistence of locally interrupted predecessors. If the admitting caller is cancelled during that post-registration await, `RunManager` drains a shielded replacement cleanup before propagating `CancelledError`, including across repeated cancellation. The cleanup normally persists `interrupted`; if that best-effort transition fails, it retries the active-to-`interrupted` store transition strictly and verifies the result with the replacement's captured owner identity. A concurrent peer terminal transition wins and is synchronized back into the local record rather than being overwritten or deleted.
- Store-only hydrated runs are readable history. In multi-worker mode with heartbeat enabled, cancel on a store-only run records `runs.cancel_action` / `cancel_requested_at` while the owner's lease is live; the first action wins even if a retry later lands on the owner. `RunStore.request_cancel()` and owner completion through `finalize_if_not_cancelled()` are competing active-row CAS operations, so an accepted cancel cannot be overwritten by a later success. `RunStore.renew_lease()` renews and observes the request atomically in the SQL implementation. The owner then executes the normal process-local interrupt/rollback and terminal stream path without transferring the lease. An expired owner is still taken over and marked `error`. `wait=true` and cancel-then-stream use the shared bridge to observe owner finalization; a non-standard process-local bridge returns accepted 202 instead of subscribing to an unreachable stream. In single-worker mode (heartbeat off), store-only runs still return 409.
- A local worker's `RunRecord.lease_expires_at` is the last durably confirmed ownership deadline. `_renew_leases()` bounds each renewal attempt by that deadline: transient store exceptions remain retryable while it is valid, but an exception or blocked call that reaches expiry sets the process-local `ownership_lost` fence, raises `abort_event`, and cancels the run task. Successful renewals collect durable cancellation actions; after all local renewals have been attempted, heartbeat only signals the corresponding process-local tasks, leaving status writes and rollback cleanup to the worker finalization path. Fenced workers do not perform subsequent journal/delivery-receipt, progress/completion/status, checkpoint/thread-metadata, or `on_run_completed` writes; the peer recovery path owns the terminal receipt. `RunStore.update_run_completion()` also refuses to replace a different terminal status, closing the peer-takeover/late-finalization race. `grace_seconds` delays peer reclamation for clock skew but is not extra execution time for an owner that can no longer confirm its lease. Already-committed remote tool side effects remain outside this local cancellation boundary.
- Startup/orphan reconciliation must claim stale active rows with `RunStore.claim_for_takeover()`, not a plain `update_status()`. The final claim re-checks `status` and lease expiry atomically, so a heartbeat renewal between the candidate scan and the recovery write keeps the run active.
- Run admission and independent writes are first-class thread operations. `runs.operation_kind` distinguishes `run` from `checkpoint_write`, `artifact_write`, `artifact_archive`, `branch`, and `delete`; every active kind shares the durable active-thread uniqueness constraint. New operation kinds must go through `RunStore.create_thread_operation_atomic()` and `RunManager.reserve_thread_operation()` rather than adding another lock or metadata marker. Live and lease-less reservations are non-interruptible; an expired leased reservation can be reclaimed immediately by interrupt/rollback admission without waiting for orphan reconciliation. Lease-less rows stay fail-closed because the store cannot distinguish a stale row from a live writer in another heartbeat-disabled worker; a rare failed delete therefore requires startup reconciliation, and heartbeat-disabled multi-worker deployment remains unsupported. Reservation bodies are attached to their caller task so loss detected by lease renewal cancels the writer before it can continue after takeover; the context manager translates that lease-loss cancellation to `ConflictError` after cleanup so Gateway mutation routes return a retryable 409 instead of dropping the HTTP request. The cleanup scope begins immediately after durable admission, including the await that attaches the caller task, so cancellation cannot strand a locally renewed pending reservation. A failed renewal is revalidated under the manager lock before cancellation; if the reservation completed and unregistered while the store update was in flight, its request task must not be cancelled after the write. Reservations are excluded from run history/reporting and from run-only helpers such as `list_by_thread()` and `has_inflight()`, release uses the captured owner rather than ambient user context, and local cleanup still runs when the best-effort store delete fails. `RunStore.create_run_atomic()` remains a deprecated compatibility shim for external stores that only admit normal runs; new stores must implement `create_thread_operation_atomic()` to support internal operation kinds.
- Gateway checkpoint mutations outside run execution must use `services.reserve_checkpoint_write()`, which composes the process-local thread lock with the durable `checkpoint_write` reservation. Manual compaction, `POST /threads/{id}/state`, and both goal mutation routes (`PUT` / `DELETE /threads/{id}/goal`, including creation of a missing goal checkpoint) use this boundary, so an existing run blocks the write and the reservation blocks new reject/interrupt/rollback runs across workers.
- Branch/state-update checkpoints copy only the source checkpoint's persisted `deerflow_agent_name`, never request metadata; missing or malformed bindings stay unbound so compaction fails closed.
- `POST /wait` (both thread-scoped and `/api/runs/wait`) drains the stream bridge via `wait_for_run_completion()` instead of bare `await record.task`, so it honours the run's `on_disconnect` setting and cancels the background run on real client disconnect rather than returning a stale checkpoint (issue #3265).
- Memory and Redis `StreamBridge` implementations retain only `stream_bridge.queue_maxsize` data events. A syntactically valid `Last-Event-ID` older than the retained watermark, or a live subscriber that falls behind it, yields `StreamGap` before any partial replay. `sse_consumer` maps that control item to an id-less SSE `gap` payload (`stream_replay_gap`) and intentionally leaves the run active; internal `/wait` consumers resume from its latest retained ID because they only need terminal completion. Redis checks bounds plus the non-blocking read in one transaction, using blocking `XREAD` only as a wake-up before repeating the atomic snapshot. For a no-cursor subscriber that established a wait on an empty stream, the first wake response remains provisional until that next snapshot verifies its tail is still retained; this closes the pre-first-delivery trimming window without changing malformed-cursor live tailing. The correctness tradeoff is one three-command snapshot pipeline per poll plus the blocking wake round trip while idle. Malformed cursor behavior remains backend-specific. Memory treats a syntactically numeric cursor below its watermark conservatively as a gap even when the evicted timestamp can no longer be verified; unknown ids at or above the watermark retain the legacy replay-from-earliest policy.
- Redis `StreamBridge` keys use a rolling retained-buffer TTL (`stream_bridge.stream_ttl_seconds`, refreshed on `publish()` / `publish_end()`) as a leak safety net, not as a run timeout. Startup and lease-driven periodic orphan recovery share one Gateway stream-terminalization path: after `RunManager` durably marks a run `error` with `stop_reason=orphan_recovered`, Gateway publishes `END_SENTINEL` and schedules stream cleanup. The periodic store scan, per-row status writes, and Gateway callback run as one supervised single-flight task, so a slow pass is skipped at the next interval instead of piling up or pausing the sole lease-renewal loop. Store retries have bounded attempts/backoff; an individual operation still relies on the database driver/pool timeout. `RunManager.shutdown()` gives active user runs priority within its shared deadline, then drains or cancels orphan recovery. Gateway tracks delayed recovered-stream cleanups and converts unfinished delays to immediate deletes before closing the bridge; the Redis TTL remains the outage safety net. Only startup recovery, before the runtime yields to requests, projects the latest affected thread to `error`; periodic recovery deliberately avoids that non-atomic projection because `ThreadMetaStore` has no `latest_run_id` conditional-update contract. Store-only SSE and `/wait` consumers wait for the bridge's real END marker after an ordinary durable terminal status, because status persistence can precede tail events. The explicit `orphan_recovered` signal is the only heartbeat fallback: its publisher is known to be gone, so it supplies the liveness boundary if END publication fails or the retained key expires. Malformed `Last-Event-ID` reconnect values live-tail new Redis events rather than replaying the retained buffer. Keep cross-component recovery orchestration in Gateway through the generic `RunManager.on_orphans_recovered` callback; do not introduce a harness-to-app dependency. Callback failure warnings include every recovered `run_id` so operators can identify rows whose Gateway-side terminalization needs inspection.
- Thread-scoped run creation accepts an optional `Idempotency-Key` header on create, stream, and wait. Gateway hashes the caller key with the authenticated owner and `thread_id` before passing it to `RunManager`, whose persistence index is process-wide; never pass an unscoped external key to that index. The same scoped key is shared across `/runs`, `/runs/stream`, and `/runs/wait`; a reused admission whose stored `input` or `assistant_id` differs from the retry returns 409. `/wait` must not treat `task is None` as completion: `store_only` records without a cross-process bridge return durable `status`/`error` instead of serializing the current checkpoint; otherwise wait on the bridge. An idempotent reuse must not serialize the latest thread checkpoint as this run's result — a later run on the same thread may have advanced the head — so reused `/wait` returns durable `status`/`error`. Capture that reuse decision before awaiting completion; `idempotency_reused` is sticky on the shared cached record and an overlapping retry must not suppress the original creating request's checkpoint. After observing completion, refresh store-backed `status`/`error` before returning them — a hydrated peer record still holds admission-time fields. A creating-endpoint retry of a terminal record whose stream is gone emits SSE `gap`/`stream_replay_gap` with `recovery: reload_durable_state` rather than a bare `end`; observer joins of that same record still emit `end`. That gap is opt-in via `sse_consumer(..., emit_gap_on_missing_stream=True)` from thread-scoped `/runs/stream` on this request's reuse — do not key it off `apply_on_disconnect` or the sticky `idempotency_reused` flag. Default `sse_consumer` callers, including stateless `/api/runs/stream`, still emit `end`. A reused still-running `store_only` record on a process-local bridge returns 409 from `/stream` with no `Retry-After`, matching `join`. Missing headers preserve ordinary non-idempotent admission. Stateless `/api/runs/*` stays outside this contract because a request without an explicit thread creates a fresh temporary thread before admission.
- Streaming endpoints opt into mid-run authorization rechecks with `sse_consumer(..., permission_recheck=("runs", "create"|"read"), data_scope_recheck=("runs:create"|"runs:read", ...))`: on each heartbeat at least `permission_recheck_interval` seconds apart (default 30s), `authz.recheck_stream_permission()` re-resolves the caller — cookie sessions bypass the `request.state.user` cache and reload the account from the repository so role changes and deactivations are observed; PAT/internal callers keep their setup identity while provider grants are re-evaluated — and re-runs the permission the endpoint enforced at connection setup. `data_scope_recheck` additionally mirrors the endpoint's `require_iam_data_scope_for_request` call against the freshly refreshed `iam_authz_attributes`, so a mid-run Central IAM row-scope revocation ends the stream too (scope-check 503s fail open like permission-path infrastructure failures). A denied recheck logs a warning, emits a bare `end` frame, and returns without firing the creator's cancel-on-disconnect policy: revoking a grant terminates that caller's view of the run, never the run itself. Authorization disabled (default deployment) short-circuits to allow, token errors mid-stream deny outright, and recheck infrastructure failures fail open so transient faults never tear down healthy runs.
- Thread-scoped run creation accepts `checkpoint` / `checkpoint_id`; Gateway validates the checkpoint belongs to the request thread before writing `checkpoint_id` / `checkpoint_ns` into `config.configurable` for LangGraph branching. In `delta` checkpoint mode the worker rewrites that fork into a linear head write before the graph starts (see "A delta-mode run cannot fork" under Checkpoint Channel Modes), because delta state for a fork replays the abandoned sibling's writes.
- Thread-scoped Gateway runs evaluate an active `ThreadState.goal` after the visible turn completes. `runtime/goal.py` asks a non-thinking evaluator model to judge only visible conversation evidence and return a typed blocker; the evaluator model is created once per run and reused across hidden continuation checks. The evaluator runs after the graph root's tracing scope has already closed, so `create_goal_evaluator_model`/`evaluate_goal_completion` attach their own model-level tracing callbacks (`attach_tracing=True`) and inject Langfuse trace metadata (`thread_id`/`user_id`/`deerflow_trace_id`) directly onto the `ainvoke` call — the same standalone-caller pattern as `oneshot_llm.run_oneshot_llm` and `MemoryUpdater` (see Tracing System below). Satisfied goals are cleared; every non-satisfied evaluation — continuable or stand-down — is persisted with `last_evaluation` (the blocker, reason, and evidence summary; outcomes that stop the loop additionally record a `stand_down_reason` for observability), but only `goal_not_met_yet` evaluations are streamed as hidden `HumanMessage` continuations, and only when the turn did not end on an unanswered Human Input Card (`ask_clarification` or the sandbox network prompt; the evaluator never sees those ToolMessages, so the goal stands down with `blocker: "needs_user_input"` without calling it), a durable assistant end-of-turn checkpoint exists, the run has not been aborted, the run has not hit its token-budget hard stop (`stop_reason == "token_capped"`; the goal stands down with `stand_down_reason: "token_capped"`), the thread did not change during evaluation, and the no-progress breaker has not fired. The continuation cap is 8 — a hard maximum in the `0`–`8` range; callers requesting more are clamped (`set_goal`/TUI) or rejected with 422 (`PUT /goal`). The no-progress breaker keys on the latest visible assistant evidence (not the evaluator's free-text reason, which an LLM rewords every turn), so two consecutive continuations that add no new visible assistant output stop the loop after 2 attempts. Model-response cleanup helpers such as think-block stripping and code-fence stripping live in `deerflow.utils.llm_text` so `runtime/goal.py` and Gateway suggestion parsing share the same JSON-prep behavior.
- Run event stream changes must keep producer code, `deerflow/constants.py`, `runtime/events/catalog.py`, `contracts/run_event_stream_contract.json`, `backend/docs/RUN_EVENT_STREAM.md`, and `tests/test_run_event_stream_contract.py` in sync. The dependency-free constants module owns the persisted envelope limits (`event_type` 32 characters, `category` 16) and cross-layer workspace event identity; the catalog owns validated runtime definitions and categories. Dynamic middleware tags are limited to 21 characters after the `middleware:` prefix. The JSON contract owns payload schemas, backend-specific storage semantics, legacy aliases, and compatibility rules; conformance tests require both views and all producer groups to agree. `run.end.content` remains opaque and may retain nested Python values in memory while JSONL/database stores stringify non-JSON nested values, so consumers must not assume backend-identical nested output representations.

Proxied through nginx: `/api/langgraph/*` → Gateway LangGraph-compatible runtime, all other `/api/*` → Gateway REST APIs.

**Thread lifecycle**: Before changing branching, regeneration, edit replay, or
archive/search behavior, read [Thread lifecycle invariants](../../docs/THREAD_LIFECYCLE.md).
It owns lineage and settled-checkpoint rules, legacy fallback boundaries, archive
filtering before pagination, owner isolation, and activity-time preservation.

Thread deletion holds the durable `delete` thread-operation reservation. After
local workspace cleanup, it clears checkpoints, the separate `run_event_store`
feed, and persisted run rows (which also hold token usage) before removing
`thread_meta`. A failure in any durable step returns a generic 500 and leaves
thread metadata available so the owner can retry. Run-row deletion must preserve
the active delete reservation and fail closed on a conflicting owner. These
separate stores are not one atomic cross-store transaction; browser-session
teardown remains best-effort. Do not put backend exception text or stored
content in the response.

OIDC provisioning invariant: `get_or_provision_oidc_user()` creates every new
SSO account with `system_role="user"`. The compatibility field
`OIDCProviderConfig.admin_emails` is ignored and must never be used as an
authorization source. Do not infer IAM administrator access from email or
provider claims. Central permissions require an online IAM decision from a
server-held, verified session. When tenant context is used for IAM decisions,
accept `tenant_id` only from the validated ID Token; UserInfo may update profile
claims but cannot introduce or replace that tenant boundary. Changing existing
account roles requires a separate reviewed migration/policy and must not happen
as a side effect of login.

`OIDCService.authenticate_callback()` returns `OIDCAuthenticationResult`, whose
access/refresh-token fields are backend-only and whose repr is redacted. An IAM
Provider must opt in with `iam_token_vault_enabled: true` and `offline_access`;
the Gateway stores AES-GCM ciphertext by `(user_id, local_session_id)` and puts
only that local session ID (`sid`) in its signed browser JWT. The key comes from
`DEERFLOW_IAM_TOKEN_ENCRYPTION_KEY`. Logout removes only the matching user's
session row. Keep plaintext out of responses, cookies, logs, `RunnableConfig`,
`configurable`, checkpoints, and general Agent runtime context. The request-level
resolver now accepts only the signed local `sid`, validates the active OIDC user
against the vault identity, refreshes/rotates under the session row lock, and
passes the access token in a repr-redacted Mapping to `requires_iam_identity`
providers. Route permissions, model-catalog checks, and sandbox-sync checks can
use this request-scoped capability. Never accept browser/model credentials.
An authenticated Gateway run now passes the redacted IAM credential Mapping on
the non-serializable `RunContext.authorization_credentials` field. `run_agent`
binds it to a run-scoped ContextVar; `build_principal_from_context` attaches it
only when the current `oauth_id` exactly matches the capability's IAM subject.
The binding resets at the start of finalization and is never copied into
LangGraph config/context or checkpoints. This covers Agent model selection and
tool filtering/execution checks. Scheduled/programmatic runs without a user
session fail closed with the central provider. Long-run session revalidation and token refresh are implemented.
Gateway host callbacks now reauthorize DeerMem memory writes at commit and recheck the current user/vault/model
before each background model dispatch; the usage callback is attached only for that invocation and closed on
completion. Memory queue state never stores credentials or capabilities. Target database/provider failure
behavior still needs acceptance; data-scope enforcement beyond owner-scoped Gateway resources, remote revocation,
adapter distribution in target images, and live IAM interoperability remain open.

OIDC metadata parsing retains the optional `revocation_endpoint`, and
`OIDCService.revoke_token()` implements an RFC 7009 HTTPS request with redacted
errors. `/auth/logout` still only removes the local vault row; do not send
server-held tokens to the issuer until the operator explicitly approves that
credential egress.
