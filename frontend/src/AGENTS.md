### Data Flow

`components/theme-provider.tsx` 统一管理产品主题偏好和根元素 class。保留 `theme` localStorage 键的兼容性，在系统主题或跨标签存储变化时更新主题，并要求所有消费者从本地模块导入 `useTheme`。`components/theme-bootstrap.tsx` 在根布局中通过 `next/script` 的 `beforeInteractive` 策略，于 hydration 前同步应用保存的主题。不要通过 `useServerInsertedHTML` 回调返回原生 `<script>`，那会在 React 渲染期间触发脚本节点警告。公开首页继续强制深色，但不覆盖用户保存的偏好。

`useSkills` 按账号缓存技能目录并传递 AbortSignal；`skills:read` 明确拒绝时只清理该账号，调用方停用不清理。创建需要 `runs:create`；安装与开关遵循 `skills:write`、`skills:admin` 与管理员角色。

记忆设置页的 `core/memory/hooks.ts` query key 必须包含认证用户 ID；明确撤销 `memory:read` 或切换账号时取消请求并清除旧 owner 缓存。记忆读取、导出和写入 API 都携带 `X-Expected-User-Id`，Gateway 在访问记忆存储前核对当前会话身份。Mutation 只失效发起操作的账号缓存，不把迟到响应直接写回缓存；导入草稿、事实编辑/删除和清空确认也绑定 owner，账号切换时清除，导出请求取消且忽略迟到回调。继续兼容不带此请求头的旧 API 客户端。

产物面板的 `sessionStorage` v2 键由认证用户 ID 与 pathname 共同组成，只保存产物路径列表、选中路径和面板开关状态；正文编辑草稿仍只在组件内存中。旧 v1 键仅含 pathname，无法证明属于哪个账号，因此不能自动迁入任一已登录用户；保留旧键但不读取。账号或路径变化时，先完成新键水合，再写入新状态，避免旧渲染帧覆盖新账号的存储。

项目资料附加到对话后的待发送附件由 `core/projects/composer-attach.ts` 暂存于 `sessionStorage`；v2 键同时包含认证用户 ID 与 thread ID。项目页在服务端附加成功后传入当前 owner，输入框按同一 owner 读取；账号/会话切换时旧附件不得显示或写入新键。旧版仅含 thread ID 的键无法证明归属，保留但不读取或自动迁移。

项目和回收站 GET 必须传 `AbortSignal`。撤销 `projects:read` 时，工作台边界只取消并清除当前 owner 的项目读缓存和回收站；调用方停用只隐藏、不删该账号缓存。`useProjects` 列表被侧栏、移动菜单和回收站选择器共享，某个视图暂时不用时不能删掉。聊天页项目徽标也受 `projects:read` 控制。

账号数据导出由 `product/data-export.ts` 在浏览器内完成。用户取消或离开页面时，要把同一个 `AbortSignal` 传给所有支持取消的清单、历史、文件列表、项目分页、偏好/记忆读取和附件下载 API；批量 helper 必须在 `Promise.allSettled` 后再次检查信号，不能把 `AbortError` 记为普通的部分导出失败，也不能继续请求下一页或批次。

1. Optional composer helpers such as `core/input-polish` can rewrite the local draft before submission, and `core/voice-input` can transcribe browser microphone input into that same local draft; confirmed user input then flows to thread hooks (`core/threads/hooks.ts`) → LangGraph SDK streaming
2. Stream events update thread state (messages, artifacts, todos, goal). The main thread stream uses the LangGraph SDK's `throttle: true` mode so updates received in the same macrotask coalesce before React is notified; do not replace it with a numeric delay without validating the SDK's trailing-debounce behavior on a continuous stream.
   File-tool artifact auto-open work must run in an effect with timer cleanup; never schedule timers while rendering streamed `write_file` or `str_replace` updates.
   `ThreadState.artifacts` remains the authoritative artifact list. The artifacts provider persists only thread-scoped panel UI state (`open`, selected path, and a refresh bootstrap cache) in session storage; an initial empty stream value must not overwrite that restored state before history finishes loading.
   Formal artifact content is refreshed once when the run finishes; transient `write-file:` previews remain message-driven.
   The detail view exposes explicit editing only for an already-opened formal UTF-8 text artifact under `/mnt/user-data/outputs`. Drafts stay in provider memory until Save so switching right-side panels cannot discard them, render in Markdown/HTML preview, and are protected from remote refreshes by the loaded SHA-256 revision. Saving is disabled during an active run; a changed revision preserves the draft and surfaces a conflict instead of overwriting agent output.
   Regular artifact text loads request at most the first 1 MiB through an HTTP
   byte range. A truncated preview must stay lightweight and expose an explicit
   full-file action; do not mount CodeMirror for that artifact until the user
   requests and receives the complete content. The Gateway retains range
   ownership and returns 206/416 through `FileResponse`.
   Run archive manifest/download routes require `runs:read` plus thread owner checks. Partition manifest cache by user, hide it when denied, cancel and remove that owner's cached manifests on revoke, and pass AbortSignal through the request. Abort an in-flight archive download on owner change, permission revoke, or unmount; Gateway remains authoritative.
   Formal artifact body reads (`GET /threads/{id}/artifacts/{path}`) require `threads:read` and thread owner checks. Key that cache by owner, hide text and in-memory write-file drafts on explicit denial, cancel and drop that owner's artifact queries, and pass AbortSignal through. Hide open, download, iframe, and skill-install actions in the same frame. Unknown permission snapshots stay compatible; Gateway remains authoritative.
3. `useThreadHistory` merges paged history, checkpoint state, and live stream rows by canonical message identity. Preserve the backend's thread-global `seq`: history pages copy it to `deerflow_seq`, and Gateway `values` frames stamp it on persisted messages. It is server-owned and must never be written into checkpoints. Normalize the reserved `__user` suffix only for human identities, so optimistic `local-human-*` inputs match their server echo. Keep latest visible content, the earliest valid positive safe-integer seq per identity, and known `run_id` / `turn_duration` through replacements; a hidden control copy supplies seq only when no visible copy has one. Render positioned rows in ascending seq order, then weave no-seq segments around identity anchors without changing their local order; live-only and rescued positioned rows may anchor adjacent no-seq segments. Do not time-sort.

   Context compaction can keep a protected first input and recent tail while the loaded page covers only a recent window. Rescue every retained visible committed identity across rolling checkpoints with a run-scoped ledger. A rescued row whose seq is below the loaded window belongs before that page, decided before anchor weaving—even if checkpoint and page share no identity. Never drop it or append it to the tail; unloaded gaps remain recoverable by paging. Preserve preceding steps carried by rescued seq anchors. No-seq streaming rows use the weave path, and optimistic rows remain last. History invalidation keeps loaded pages and their ordering positions.

   The durable paged message feed and reconnecting to a saved run require `runs:read` even though thread state and a new live stream use thread access. Pass explicit denial from both chat surfaces into `useThreadStream`; stop, hide and clear cached history pages and disable saved-run reconnect while leaving authorized live messages active. Unknown permission snapshots remain compatible with older Gateways.

   The exported `useThreadRuns` and `useRunDetail` hooks also call `runs.list/get`, which require `runs:read`; give each a distinct owner-scoped query key, hide and clear that owner's cache on explicit revoke, and pass React Query's AbortSignal to the SDK. Preserve stopped-run invalidation for both keys.

   On local submit, snapshot the thread, checkpoint baseline, canonical history identities, maximum trusted seq, and existing transient-bridge identities. Anchor the submitted human turn: restore baseline/page-confirmed messages in their known positions and move only speculative non-baseline AI/tool steps behind it; persisted steps from the current run also remain after their human. Keep the anchor scoped to its thread through finish, stop, or stream error because the settled SDK frame may retain transient order. Replace it on the next submit; clear it on thread switch or replay-gap recovery.

4. Stop actions call the LangGraph SDK stream stop path; `core/threads/hooks.ts` invalidates current-thread, thread-history, token-usage, and sidebar/search caches immediately and schedules one follow-up refetch because SDK stop may finish via abort + fire-and-forget cancel before backend title finalization commits
5. TanStack Query manages server state. `UserPreferencesBoundary` preserves
   workspace SSR and initializes the account cache before browser paint; only
   subsequent account switches gate consumers until the new cache is active. Four allowlisted
   settings sync through `/api/v1/auth/preferences`; confirmed caches are
   account-scoped in localStorage and pending patches are account-scoped in
   tab-local sessionStorage. A stopped account cannot apply late responses, and
   each request carries its expected user ID to fence shared-cookie switches.
   Storage events refresh from the server without echo-writing unchanged data;
   failed reads and writes retry with capped backoff and focus/online wakeups.
   Legacy unscoped settings are never automatically uploaded. Display settings
   and thread model overrides remain local. Shared local-only fields still merge
   across tabs on storage changes/removal/clear, preserving account preferences.
   Explicit InputBox selections pass only fields changed by the action, so a
   mode/effort edit cannot upload an unrelated thread model override.
   InputBox marks automatic model/mode
   resolution separately from user choices on both normal and Custom Agent chat
   pages; `resolveThreadContext` must neither
   enqueue account writes nor create a fallback thread override that masks a
   later server preference. The
   Capability Center > Plugins MCP switch calls the targeted `PATCH /api/mcp/config`
   mutation, disables switches until that mutation's success refetch completes,
   displays localized operation failure copy, keeps backend `detail` in diagnostics, and invalidates
   `["mcpConfig"]` only after success.
   Server management uses targeted `POST /api/mcp/config/servers`,
   `PUT /api/mcp/config/server`, and bodyless
   `DELETE /api/mcp/config/servers/{server_name}` mutations. Delete names are
   percent-encoded, including legacy empty and slash-containing names; every
   successful mutation invalidates `["mcpConfig"]` only after the response.
   MCP 配置按账号缓存；`mcp:admin` 明确拒绝时只清理该账号，停用不清理，权限未知仍请求并传递 AbortSignal。写入仍失效 `["mcpConfig"]`。
   Current-chat MCP background tasks use `core/background-tasks`: show the header
   trigger only for persisted non-mock threads when `/api/features` reports the
   startup-scoped `mcp_tasks` capability and `threads:read` is not explicitly
   denied. The list/detail queries stop and hide cached data without
   `threads:read`; cancellation is available only with `threads:write`. Query
   keys include the authenticated user ID so switching accounts cannot reuse
   another user's task records. Default-disabled and memory-backend deployments
   never poll an endpoint that cannot serve tasks. It lists at most
   20 local task records, refreshes every 3 seconds while any task is active
   (15 seconds otherwise), fetches bounded task details only while a user expands
   a card, and cancels through the thread-scoped local-ID endpoint. The expanded view
   shows result/preview, artifact metadata, input requests, and the latest poll,
   notification-delivery, or cancellation error without exposing the persisted remote handle. A
   persisted cancel request remains "Cancelling…" only while the task status is
   still active; if remote cancellation keeps failing, the active card remains
   expandable and shows the attempt count plus the latest bounded error while
   the backend continues retrying. Notification delivery failures expose their
   bounded error and attempt count; retryable failures use backend backoff,
   while a permanent rejection or exhausted five-attempt budget is shown as
   stopped rather than implying that retries will continue.
   Their GET hooks consume React Query's AbortSignal and cancel/remove the
   thread-and-user scoped list/detail cache when `threads:read` is revoked;
   cancellation mutations must not write returned task data back into a cache.
   Explicit durable native-subagent batches use `core/subagent-batches` and
   `ThreadSubagentBatches`. `/api/features` reports SQL-repository availability
   separately from the startup worker. A running worker exposes the trigger on
   both default and Custom Agent chat pages; a stopped worker keeps threads with
   durable history visible in read-only mode for inspection and JSONL export,
   while deployments with neither a worker nor history keep the trigger hidden.
   Batch history and item pages require `threads:read`, are keyed by both thread
   and authenticated user, consume React Query's AbortSignal, and clear their
   scoped caches when reads are disabled. Pause/resume/cancel/retry requires
   `threads:write`; mutation variables carry the initiating user scope so a
   late success invalidates only that user's cached history.
   The panel renders bounded progress and incrementally paged item previews, controls pause/resume/cancel,
   retries failed items, and exports JSONL. Worker-dependent mutations stay
   disabled in read-only history mode, and persisted progress is normalized to
   a bounded percentage before reaching the UI primitive. Item pagination uses a
   fixed page size and an explicit load-more control; full results remain available
   only through JSONL export. The panel must not infer batch mode from prompt text
   or inject the complete result set into chat state.
   Lark status keys the owner, passes AbortSignal, and clears only that owner on `integrations:read` denial; disable does not clear it. Local generations only
   suppress stale React callbacks; server-issued Lark flow generations must be passed through every
   config/auth completion and across switch-or-register to authorization chains
   so backend cross-tab ordering remains authoritative.
   Settings > Subagents reads one catalog for built-in, config, and managed
   definitions. Only administrators see managed-definition mutation controls;
   `useSubagents` must cancel in-flight reads and remove its cached catalog when
   `subagents:read` is denied. Custom Agent settings use the same permission gate;
   without catalog access, disable binding edits and omit `allowed_subagents` from
   unrelated saves so the stored allowlist is preserved. With access, preserve
   stale selected names as removable "missing" entries instead of silently
   widening the allowlist.
   `useAgentsApiEnabled` keeps the last definitive `/api/features` value in the
   browser cache. Read it with `useSyncExternalStore`: the server snapshot stays
   `undefined` for hydration parity, the browser snapshot reads localStorage,
   and a `storage` event updates other tabs. A live Gateway answer still wins;
   fail open only when neither source has a known value.
6. Components subscribe to thread state and render updates

Project moves in `core/threads/hooks.ts` cancel all per-thread metadata query
variants after the write succeeds, merge only `deerflow_project_id`, then
invalidate/refetch that metadata prefix. Delayed pre-move reads stay fenced.
Search and project-thread lists are invalidated on settlement. Keep the
delayed-read regression in `tests/unit/core/threads/move-thread.dom.test.tsx`.
`useThreadMetadata`, `useInfiniteThreads` and `useThreads` key owner after prefix, forward AbortSignal and clear that owner on `threads:read` denial; unresolved still fetches. Dashboard and projects clear only that owner. Chat headers call `GET /api/threads/{id}/summary`: a stored thread row skips checkpoint materialization, and a checkpoint-only legacy thread falls back to the full read. While that summary is pending, show the matching row from the signed-in user's infinite thread list. Workspace home reuses that same first page for recent chats and agent-usage counts; keep the separate busy-status poll. Agent directory and recent-file queries stay fresh for 30 seconds.

The chat header keeps `ContextUsageBadge` mounted while usage is unavailable. `useThreadTokenUsage` requires `threads:read`, keys cache by owner and thread, forwards AbortSignal, and clears that owner on explicit denial. Retain placeholders only when response thread and owner match.

Settings skill uploads reject archives larger than 100 MiB before starting the
request and disable the hidden file input while an install is pending. The API
client preserves structured SkillScan findings on `SkillRequestError`, and the
settings page renders a compact file/rule/line summary so security rejections
remain actionable; a proxy-generated 413 is mapped to the localized size error.
Capability-center Skill Gallery, MCP configuration and artifact Skill installation use localized operation-specific messages; keep Gateway details in diagnostics. On refresh failure retain cached data with retry, preserve structured security findings, and show explicit admin-required copy for 403.

Run duration is run-scoped UI metadata even though the compatibility field `additional_kwargs.turn_duration` is repeated on historical AI messages. `core/messages/run-duration.ts` folds those copies into one display anchored after the run's last visible message group. `MessageList` owns the temporary client-side duration for a just-completed live turn until authoritative history arrives. The duration is total run wall-clock time, not per-message reasoning time; reasoning disclosure and run activity/duration are rendered separately.

The workspace-change card follows the same rule: it is resolved from `(threadId, runId)` alone, so every AI message of a run would render an identical copy. A run ends in more than one terminal assistant bubble whenever the model emits answer text that never gains a tool call, so `core/messages/workspace-change-anchor.ts` picks the run's last assistant bubble and `MessageListItem` renders the badge only for that anchor (#4555). Any future run-scoped display belongs in the same place — do not hang one off every message. The two anchor helpers deliberately differ in which group types they accept as a run's last position, because an anchor is only useful where the display is actually rendered: run duration is emitted by `MessageList` around every group, so it accepts any type, while the workspace-change card comes from `MessageListItem` and so restricts to `assistant`. Keep a new helper's candidate set matched to its own render site rather than unifying them.

Composer drafts are tab-scoped browser state. `core/threads/composer-draft.ts` stores only text plus the selected slash-skill name in `sessionStorage`, keyed by user, agent, and logical conversation scope. New-chat pages pass the stable scope `"new"` because their runtime `threadId` is a fresh UUID on every reload; established conversations use their real thread ID. `InputBox` waits for enabled skills before restoring a skill chip, degrades a missing/disabled skill back to editable slash text, and clears the stored draft through `SendMessageOptions.onSent` only after the send passes the in-flight guard. Attachments, sidecar quotes, voice state, and polish undo state are not persisted.

read_conversation (backend opt-in) appears only when /api/features enables it and neither threads:read nor runs:read is denied; search needs the former, and Gateway scopes the run reader with the latter. ReferenceConversationsButton queries only while open/authorized, keys cache by user, hides disabled-query cache, excludes the current thread, caps max_references, and shows removable header chips. Submit IDs through InputBoxSubmitOptions.conversationReferences to SendMessageOptions to run context.conversation_references; Gateway consumes them at admission because LangGraph drops unknown top-level fields. Store only display metadata {thread_id,title,agent_name?} on the human message for read-only chips; it grants nothing, and links use pathOfThread for custom-agent routes. References are per-message, never draft-persisted, and clear on send, account/thread switch or loss of either grant; edit/regenerate requires reattaching.

Auth UI note: the login page's "keep me signed in" option submits only `remember_me` to the Gateway and may persist only the email address through `core/auth/remember-login.ts`. Passwords and tokens must never be stored in frontend storage; the `HttpOnly access_token` and readable `csrf_token` cookies remain Gateway-owned.

`/goal` and `/compact` are InputBox commands. Goal status reads; clear/set writes; setting also starts the condition as a run. On project-scoped new chats, precreate the thread before goal PUT because that endpoint materializes rows and an unassigned idempotent row will not later gain the project. Per-thread AbortController cancels stale goal/compact requests on switch or unmount. `GoalStatus` reflects `AgentThreadState.goal` with optimistic updates. Compact summarizes older context, skips welcome/empty chats, and Gateway rejects active runs. Rename shares serialized state writes; keep its dialog open on 409. Preflight goal GET with `threads:read`, set/clear with `threads:write`, and set also with `runs:create`; preserve the draft on denial and allow unresolved legacy snapshots. Manual compact requires `threads:write`, except the welcome no-op.

The composer rechecks those grants before the request and keeps the draft when denied. Unresolved snapshots stay compatible; the Gateway remains the authorization boundary.

Manual `/compact` calls `POST /api/threads/{thread_id}/compact`, whose Gateway route requires `threads:write`. Skip this permission check only for the welcome-mode no-op (it does not call the API); otherwise preflight before starting the request, show the localized permission message, and reject the submit so `/compact` stays in the composer for retry.

The `/` skill list stays reachable after a skill is selected: typing `/` in the editable text beside the chip reopens it, and picking an entry swaps the chip rather than adding a second one, because the wire format carries exactly one leading `/skill`. That list offers skills only while a chip is selected — a builtin command owns the whole composer line, so `/goal` behind a selected skill would submit as chat text instead of running the command. The trigger itself is unchanged: a slash only opens the list at the start of the input (`getLeadingSlashSkillQuery`), pinned by `tests/e2e/chat.spec.ts`.

Human input is a versioned chat protocol: Gateway stores `ToolMessage.artifact.human_input`; validators live in `core/messages/human-input.ts`, UI in `human-input-card.tsx`. V1 supports free text/choice-with-other; v2 adds validated typed fields. Replies stay v1 text with a readable summary and JSON keyed by stable field names. Reject unknown versions/modes and prototype fields; read own properties. Keep selects controlled, checkboxes false by default, and required/invalid labels accessible. A visible user message answers only the latest unanswered request; derive status from raw `thread.messages` because replies are hidden, and clear pending state on reply, dropped dispatch, or stream error. Submit a normal hidden user message with reply payload as the fourth `sendMessage` option (third is run context). Keep the composer enabled; ordinary sends bypass this protocol.

Human-input and composer errors preserve drafts; after failed dispatch reset only the pending marker, log the original exception and show localized fallback copy rather than the Gateway body. Map known recoverable statuses explicitly.

Tool-calling AI messages can contain user-visible text as well as `tool_calls`. `core/messages/utils.ts` keeps these turns in an `assistant:processing` group, and `components/workspace/messages/message-group.tsx` must render the visible text as a processing step instead of treating the message as only tool metadata. This preserves provider text such as error explanations or "trying another approach" notes during tool-heavy runs.
While the current turn is still loading, a content-only AI message after the latest visible human input also stays in that processing group until the turn settles: a provider may append tool-call chunks to the same message later, and classifying it as a final assistant bubble too early makes the text jump into the steps panel. `MessageGroup` therefore renders processing text even before the first tool call arrives.
The same rule applies after an earlier tool call: a later content-only AI message remains visible after the current last tool-call step while streaming, because that message may itself gain another tool call before the turn settles.
Because the same message is rendered by two different components over its lifetime, reasoning must sit above the answer text in both. `MessageListItem` paints the settled bubble's `<Reasoning>` disclosure above its content, so `MessageGroup` puts the trailing reasoning disclosure above the assistant text that follows it and `convertToSteps` emits a message's reasoning step before its content step — otherwise the two swap places the instant the turn settles (#4576). Assistant text emitted _before_ that reasoning keeps its earlier position; only the answer the reasoning produced moves below it.

Edit-and-rerun is deliberately latest-turn-only. `core/messages/utils.ts::getLatestEditableTurn()` exposes a human turn only when the transcript is idle and the most recent visible turn ends in a terminal assistant message. `core/threads/hooks.ts::editAndRegenerateMessage()` calls `POST /api/threads/{id}/runs/edit-regenerate/prepare`, submits the returned replacement message/checkpoint/metadata through the same LangGraph stream path as regenerate, optimistically hides the superseded message ids, and clears the optimistic replacement once the persisted replacement arrives.

`MessageGroup` builds its tool-result and browser-preview lookups once per processing group before converting messages to steps. The lookup preserves the first non-empty result and first screenshot-bearing browser view for each tool-call ID, matching the streamed-message display semantics without repeatedly scanning the full group for every tool call.

Generic tool details get the explicit `Debug` flag from `MessageGroup`; previews mount only while expanded. `tool-detail-preview.ts` caps text/visits at 12,000 and depth at six, counting JSON syntax and truncation markers. Keep text raw (never `JSON.parse`); format objects/arrays only on expansion and preserve specialized renderers. Preserve empty vs missing payload and ToolMessage status. Copy the displayed preview via the shared clipboard fallback and reset feedback after two seconds. Truncated JSON stays valid; keep complete UTF-16 pairs and original keys. Cycles/accessors/depth limits must not hide later siblings; arrays stop when the text budget is exhausted. Shared `getToolCallKind` routes rendering/result conversion, and disclosure names include tool plus call ID.

Array previews coalesce consecutive generated markers only at the end into one omitted-suffix notice. The serializer tracks marker provenance and complete entry boundaries; it must not deduplicate literal ellipsis values or shift the indices of later real elements. A cycle/accessor/depth-limit tail can therefore share one notice while the same markers in the middle retain their positions.

### Key Patterns

- **Server Components by default**, `"use client"` only for interactive components
- **Static root boundary** — `src/app/layout.tsx` must not read cookies or import
  chat-only KaTeX/Streamdown styles. Auth and workspace layouts own the cookie-derived
  locale provider; docs derive locale from their route, and blog owns its preference
  cookie. Public server routes load one dictionary at a time through
  `core/i18n/translations.ts`; the interactive auth/workspace client provider owns both
  formatter-bearing dictionaries because functions cannot cross the RSC boundary.
  Keep public `/` static and keep rich-content CSS on the routes that render it.
- **Thread hooks** (`useThreadStream`, `useSubmitThread`, `useThreads`) are the primary API interface
- **Thread routes** — construct Web UI chat paths through `core/threads/utils.ts::pathOfThread()`, which percent-encodes both custom agent names and thread IDs before inserting them into route segments
- **LangGraph client** is a singleton obtained via `getAPIClient()` in `core/api/`
- **Run stream options** (`core/api/stream-mode.ts`) accept only Gateway modes: `values`, `messages-tuple`, `updates`, `debug`, `tasks`, `checkpoints`, `custom`; reject unsupported modes before HTTP. Chat uses incremental `messages-tuple`/`updates`/`custom` to avoid repeated snapshots, while explicit debug/task/checkpoint modes remain available. `streamResumable` is SDK-only; replay uses SSE `Last-Event-ID`. `values` remains for explicit inspection and gap recovery. File-write batching depends on `messages-tuple`; `stream-state.ts` folds visible `updates`, and the SDK alone assembles/deduplicates message chunks. Keep request schemas aligned; never forward `messages` or `events`.
- **SSE replay gaps** are handled in `core/api/api-client.ts`, which wraps both initial and joined run streams because the upstream SDK ignores unknown event names. An id-less backend `gap` control frame clears stale reconnect metadata, emits an internal `stream_replay_gap` custom event, reloads durable thread values, and resumes after the server-provided retained tail when one exists (or rejoins without a cursor if the buffer is empty), with up to five recovery rejoins after the original stream (six total stream calls on an all-gap exhaustion path). The wrapper remains a lazy async iterable because the SDK consumes it with `for await`. `core/threads/hooks.ts` clears optimistic/transient/subtask state, invalidates durable history caches, and shows the localized recovery warning; never let a gap fall through as a normal stream finish or cancel the still-running backend run.
- **Streaming Markdown rendering** is owned by `core/streamdown`: Streamdown's `animated` / `isAnimating` API handles incremental word animation, while the shared `streamdownRenderingPlugins` config registers the named code-highlighting and Mermaid plugins required by Streamdown 2.5. Keep wrappers and derived configs wired to that shared object; do not reintroduce a rehype plugin that wraps every word, because reparsing a growing block remounts old words and replays their animation.
- Citation links in message and artifact Markdown must derive their `citation:` label from the full `ReactNode` children tree, since Streamdown may provide element or array children during streaming rather than a plain string.
- **Environment validation** uses `@t3-oss/env-nextjs` with Zod schemas (`src/env.js`). Skip with `SKIP_ENV_VALIDATION=1`
- **Subtask step history** (`core/tasks/`) renders assistant/tool timelines (#3779). Use the optional tool description or fall back to `prompt` and a localized label. Append live `task_running` steps with `mergeSteps`; historical event pages require `runs:read` and must pass AbortSignal, aborting on revoke, owner/thread/run switch or unmount. Preserve `task_started` model and cumulative usage snapshots, keeping the largest total across replay/out-of-order events. Terminal ToolMessage metadata restores model/usage after reload. `steps.ts` normalizes live/history rows, deduplicates by `message_index`, and hides the completed final AI step because `result` displays it. `useUpdateSubtask` merges against `tasksRef` to retain late backfill, SSE, and sibling updates. History rows must carry owner `run_id` for event lookup.

### Interaction Ownership

While destructive or external mutations are pending, keep dialogs open and fields locked; closing the local dialog must not imply an already submitted Gateway write was canceled. Feishu wait-for-user flows remain closable.

Route Suspense and lazy chunks each provide localized skeleton feedback; avoid blank initial and tab-switch states.

Feishu connection requires a fresh status refetch. Treat 409 as a replaced flow, 400 as a request error and 504 as still pending; a local timeout does not prove server-side expiry. Generation tokens invalidate stale callbacks, and restart is available only while idle.

Personal-data downloads are single-flight and abortable; late responses must not create object URLs or mutate newer request state.

Export/delete jobs persist one user-scoped idempotency record (kind, scope and key), replay only after explicit user action, and clear it only after an acknowledged response. Never persist task content or confirmation phrases; storage failure blocks creation, and the server still enforces owner and capability.

core/auth/permissions.ts mirrors the Gateway permission vocabulary and distinguishes allow/deny/unknown. On explicit denial, hide or disable the entry and clear stale cache/drafts; unknown remains compatible with older Gateways. Keep feature flags, Gateway capabilities and IAM grants separate. UI checks never replace server authorization: route guards, owner checks and IAM data scopes remain final. Sync new permissions across frontend constants, Gateway and contract tests.

`core/auth/AuthProvider.tsx` treats `/api/v1/auth/me` 401 as an expired session, but a network failure or other non-401 response as a temporary auth/permission-service outage. During that outage preserve the signed-in identity, replace its local `permissions` snapshot with an empty list so permission-gated UI fails closed, and expose `authRefreshUnavailable` for the workspace recovery banner. A later valid response restores the server snapshot; do not reinterpret a legacy Gateway's missing or `null` permissions as a denial outside this explicit outage state.

`product/workspace-home.tsx` follows the same route grants as its data sources: recent chats and running-thread summaries require `threads:read`, recent files require `threads:read + projects:read`, the Agent directory requires `agents:read`, and chat/Agent quick-start links require `runs:create`. When a grant is explicitly revoked, stop the query, hide its cached result, and remove that dashboard query cache; permission fields missing from older Gateway responses remain unresolved for rolling-upgrade compatibility.

File Center requests require threads:read and projects:read; explicit denial hides cached data and clears delete drafts. Recheck permissions on submit; Gateway owner/data-scope checks remain final.

Thread send/continue/regenerate requires runs:create; branch and project-thread creation require threads:write; stopping remains separately gated by runs:cancel. Keep the draft on denial and let Gateway authorization decide.

Message feedback follows its Gateway route grants: adding or changing a rating needs `threads:write`; removing a saved rating also needs `threads:delete`. Hide both controls when write is explicitly denied. If delete is denied, keep the selected rating pressed and disabled with a localized explanation while allowing the opposite rating to be saved. Give icon-only feedback buttons accessible names, expose the feedback controls as a named group, and associate the disabled reason with that group for keyboard and screen-reader users. Gateway owner and permission checks remain final.

The thread history API returns feedback as row metadata. Keep it on `RunMessage`, and when flattening history expose it only on that run's last visible AI response (legacy Gateways with no `feedback` field remain supported). A live checkpoint can refresh message content without feedback metadata, so `mergeMessages` must preserve the persisted history value. The row synchronizes refreshed feedback props and invalidates `threadHistoryQueryKey(threadId)` after a successful save or removal; cover these history, merge, and cache behaviors when changing the feedback contract.

InputBox auxiliary model requests follow their own Gateway grants: follow-up suggestions read conversation content and require threads:read; pre-send polishing calls a model and requires runs:create. Do not issue suggestions without read access; clear displayed suggestions and discard late responses when access is revoked. Gate polishing on runs:create itself, not the general send flag: a first project-scoped send may also require threads:write. Disable model requests with localized guidance when runs:create is denied, abort in-flight requests on revocation, and keep the local undo action available because it makes no Gateway request.

频道目录按 channels:read/write/admin 控制可见性和 mutation；配置读取只返回凭据掩码。`GET /api/channels/providers` 返回当前账号的连接状态，`GET /api/channels/connections` 返回当前账号连接，所以两个 query key 都必须包含认证用户 ID。目录和连接撤权只清各自的 owner 缓存，停用都不清。GET 透传 AbortSignal。个人连接/断开只失效发起账号缓存；管理员更改部署级运行配置或全局断开 provider 时，需失效所有 owner 的 provider/connection 缓存。连接轮询跟随 owner 与读取权限，在切号、撤权或卸载时停止。Gateway 路由守卫仍是最终授权边界。

`core/workspace-changes/hooks.ts` 读取的 Gateway 路由要求 `runs:read` 和 thread owner 校验。query key 按认证用户 ID 分区，GET 消费 React Query 的 AbortSignal；明确撤权时首帧隐藏结果、取消请求并清理该 owner 的所有运行变更缓存。Gateway 仍是最终授权边界。

Delete preflight requires a fresh, user-scoped capability read; unknown/failure disables the action, and changed capability pauses an open confirmation. Export does not depend on delete capability; POST and worker still enforce owner and permissions.

自有数据任务历史按认证用户和当前权限快照分区缓存。撤销任一任务范围权限时要立即隐藏旧历史，取消并清除该账号旧权限快照下的所有分页；恢复授权后再读取 Gateway 的当前任务列表。任务详情、取消和制品下载仍由 Gateway 按当前 owner、scope 与 permission 再次授权。

- `src/app/layout.tsx` 挂载 `PublicProductBrandProvider`；它只在 `/`、`/login`、`/setup` 入口同步运行时品牌标题，并跟随文档 `lang` 属性切换中英文。工作台标题仍由 `product/document-title.tsx` 管理，文章和文档标题不能被公开品牌覆盖；服务端 metadata 保留源码默认名，保证 Gateway 未就绪时首屏可用。
- `src/components/workspace/model-picker-content.tsx` owns the compact model
  list, favorite grouping, and the anchored non-modal picker shared by the main
  composer and Side Chat. Each row keeps model selection and its inline
  favorite star as sibling buttons. The picker deliberately follows the
  pre-favorites two-line row density and does not add a search field. Favorites
  are stored by
  `core/models/favorites-store.ts` under a user-scoped browser key and only
  reorder derived display arrays: never sort `useModels().models`, promote a
  favorite to the default model, prune a temporarily unavailable favorite, or
  merge the main and Side Chat selection callbacks. Keep favorite buttons out
  of model-selection buttons; the two call sites continue to own their triggers
  and their distinct mode/reasoning-effort transitions.
- `core/models/hooks.ts` loads the Gateway-filtered catalog; Gateway remains
  the final authorization boundary for listing and use. Keep this user-scoped
  cache short-lived and refresh on focus so grants/revocations apply without a
  new sign-in. Include user ID in the query key, pass React Query's AbortSignal
  to Gateway, and never show/cache the prior account's models after a switch.
- `useAgents` and `useAgent` key the owner and pass AbortSignal. List `agents:read` denial clears that owner's list and details; detail denial clears details only. Disable clears neither. Writes invalidate only the initiating account. Direct Agent-chat routes must show the missing permission.
- `src/app/workspace/chats/[thread_id]/page.tsx` owns composer busy-state wiring.
- `src/app/workspace/chats/[thread_id]/page.tsx` owns branch-from-turn submission and navigation; sidecar `MessageList` instances do not receive the branch action. Branch failures use `t.conversation.branchFailed`; Gateway details remain diagnostic only.
- `core/threads/thread-branch-tree.ts` projects only loaded, same-pin branch lineage into Recent chats. Missing, malformed, cross-pin, self, or cyclic parents stay top-level; unpinned groups follow their freshest descendant while pinned root order stays stable. `recent-chat-list.tsx` caps visual indentation without changing the recursive order.
- `src/app/workspace/chats/[thread_id]/page.tsx` and `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` own edit-and-rerun submission wiring because the page must preserve normal/custom-agent run context; `MessageList` only detects the latest editable user turn and renders the inline editor.
- `src/app/workspace/chats/[thread_id]/page.tsx` gates the Workspace Browser trigger and browser right panel on `/api/features -> browser_control.enabled`; `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` applies the same capability gate and additionally requires the Custom Agent's tool groups to be unrestricted or include `browser`. Default/failed feature discovery hides the browser control so optional backend installs do not show a dead Live socket.
- `src/app/workspace/chats/[thread_id]/page.tsx` and `src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx` own active-goal display state for their composer overlays.
- `src/components/workspace/messages/message-list.tsx` owns human-input card answered/latest/pending gating; entry pages only translate a submitted card response into `sendMessage` calls.
- `src/components/workspace/sidecar/sidecar-panel.tsx` owns Side Chat send/delete failure feedback. Route failures through `core/sidecar/error-feedback.ts`: retain the original exception in diagnostics, show the operation's localized product message, and keep pending references when a send fails. Cover both operations in the sidecar feedback regression.
- `src/components/workspace/browser-view/browser-view-panel.tsx` forwards each physical pointer click as one `click` input; do not also emit `down`/`up` for the same gesture because the remote Playwright click would run twice.
- `src/components/workspace/browser-view/use-browser-stream.ts` requests binary JPEG
  frames with `frame_format=binary`; status, URL, tabs, and navigation rejection
  messages remain JSON. `LatestBrowserFrameBuffer` keeps only the newest pending
  frame, publishes through `useSyncExternalStore` at most once per animation
  frame, and owns object-URL revocation. Keep the Gateway's legacy JSON/base64
  frame path for older clients.
- `src/components/workspace/browser-view/browser-view-panel.tsx` maps direct and
  live navigation failures to `t.browserView.cannotOpen(url)`. Gateway rejection
  detail must stay out of user-facing toasts; keep the URL context and localized
  copy while the backend retains its own diagnostic logs.
- `src/core/threads/hooks.ts` owns pre-submit upload state and thread submission.
- `src/core/uploads/hooks.ts` owns thread upload-limit and uploaded-file reads. Callers must pass the current `threads:read` grant explicitly; reads consume React Query's `AbortSignal`, and a disabled hook cancels its exact request and removes its cached result. Upload creation separately requires `threads:write`.
- src/components/workspace/chats/chat-box.tsx owns desktop layout; artifacts, sidecar and browser share one ResizablePanelGroup so the artifact divider remains draggable. Open/close uses the panel imperative collapse()/resize() handle, not conditional rendering. Animate group flex-grow on direct [data-panel] elements only during open/close; keep content at final width and clipped during the transition to avoid scroll and composer reflow. A collapsible panel can reach 0% mid-drag: record positive sizes in onResize, but update owner open state only in onLayoutChanged after release. Keep the no-animated-scroll regression in tests/e2e/sidecar-chat.spec.ts.

Agent UI uses agents:read; creation requires agents:read/write plus runs:create, edits agents:write, delete agents:delete, and deployment-default SOUL changes agents:admin. Runtime permission snapshots must not enter client config or checkpointed configuration.

`app/workspace/agents/new/page.tsx` checks name availability through `GET /api/agents/check`, which requires `agents:read`. Pass an AbortSignal, cancel the request when the creation permission set changes or the page unmounts, and recheck the latest `agents:read + agents:write + runs:create` snapshot after the response before starting the bootstrap run. An aborted request is not a Gateway outage; route authorization remains authoritative.

Dirty settings sections share one confirmation flow; after continuing, restore the section still displayed. Permission revocation immediately unloads admin content and returns to an allowed section. Product-administration settings, account pages, and audit queries include the authenticated administrator ID in their cache keys; mutation callbacks must write or invalidate the actor scope captured when the request started.

`UserPreferencesBoundary` 按 `preferences:read` 和 `preferences:write` 分别启用远端 GET/PATCH。产品扩展 `/api/product/v1/settings` 共用相同权限：偏好读取按 `preferences:read`，保存和删除按 `preferences:write`；明确拒绝时停查、隐藏并清除该用户缓存，写操作禁用且 mutation 回调使用发起时的用户 ID。只读、只写或两项都没有时，不请求被拒绝的接口；当前用户的本地缓存仍可使用，写权限缺失时本地改动保存到用户分区缓存。权限字段缺失时继续兼容旧 Gateway。不要把本地成功提示描述成跨设备已同步。

Project/file UI mirrors projects:read/write/delete and thread permissions; explicit denial hides stale query data, destructive submit rechecks permission, and Gateway owner/data-scope remains final. `GET /api/projects/config` also requires `projects:read`: every `useProjectsConfig` caller must pass its current grant, and the hook cancels/removes the shared config query on denial while forwarding the query AbortSignal. The project page owns this permission-aware query so revocation is observed even when a child tab unmounts; keep the default server-limit fallback for older Gateways.

Scheduled tasks use threads:read/write/delete and runs:create/read/cancel according to the operation; a bound thread also requires threads:read and its owner/data-scope. `useScheduledTasks` and thread task lists key the owner, pass AbortSignal and clear only that owner on `threads:read` denial; disable does not clear them. Run history also requires `runs:read`, keys pages by owner, and clears that owner's pages when either grant is denied. Agent selectors reuse `useAgents(enabled)` so they inherit the same signal and `agents:read` cache-clearing contract. Revoke clears cached results and drafts; centralize the map in core/scheduled-tasks/permissions.ts.
