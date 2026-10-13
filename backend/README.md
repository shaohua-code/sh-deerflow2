# DeerFlow Backend

**2026-10-12 Central IAM Provider-path audit:** Static review of in-repository built-in production Python sources found shared-factory `BaseChatModel` calls, Gateway one-shot calls, and DeerMem's direct `init_chat_model()` covered by usage callback scopes. The custom Codex Responses model is also created through the shared factory and returns usage metadata. Dynamically loaded third-party extension providers were not exhaustively enumerated. Codex internal HTTP retries remain one invocation-level reservation/settlement; attempt-level billing semantics are unverified. Read-only audit only; no tests or live calls ran.

**2026-10-13 Central IAM B04 focused verification:** The latest full Windows Python 3.12 offline result remains the pre-fix 17,004 passed / 186 failed / 349 skipped / 3 deselected / 5 errors snapshot. Independent focused results: migration/bootstrap five modules 62; Studio 6; Gateway startup/checkpoint/regenerate 45; FastCRW/thread routes 142; PAT auth/repository/vault 63; extension task runtime 15; context compaction + Gateway services 212 passed. Legacy migration fixtures now create only `_BASELINE_TABLE_NAMES`; Ruff check/format passed. This turn changed test fixtures/docs only; production runtime behavior is unchanged. Full suite not rerun; `uv`, `WinError 10106`, and remaining failures stay open. No target migration/live IAM/provider/quota checks ran.

**2026-10-12 Central IAM memory usage:** DeerMem's timer-driven model path now creates one usage callback per invocation from the current user and OIDC vault session, binds the server-configured model profile, and closes the callback after the terminal LangChain result. Enabled metering fails closed before Provider dispatch when admission is unavailable; the queue contains no credentials or capabilities. Focused existing tests passed 20/20, the Harness boundary check passed 1/1, and Ruff check/format passed on the six changed Python files; full-suite/live IAM/Provider validation was not run.

**2026-10-12 Central IAM model-call authorization:** Each configured profile used inside a Gateway run is checked for exact `model:use` before every provider dispatch, including title/summary/evaluator/subagent calls. DeerMem's background model path uses Gateway-injected Harness callbacks to reload the active user/vault session and require memory read/write owner scopes plus that profile's use permission. Errors and denials fail closed before provider egress; Harness does not import `app.*`. Focused authorization regressions passed 28/28 and the Harness boundary test passed 1/1. The Python readability fallback now preserves safe article links and image destinations; the existing web-fetch regression passes 50/50 and Ruff passes. A Windows isolated full backend snapshot before the fix had 16,750 passed, 442 failed, 345 skipped, and 3 deselected; blocking-I/O had 116 passed, 26 failed, and 1 skipped. The full suite has not been rerun; remaining failures are not fully triaged. Temporary tests and pytest artifacts were removed. Live IAM/Provider E2E remains open.

**2026-10-11 webhook production guard:** The explicit unverified-webhook opt-in is ignored in production. If no webhook secret is configured, the route is not mounted and direct handler calls reject unsigned requests. Full focused browser/webhook regressions passed 76/76, including fail-closed data-scope and authorization-service cases; the public URL SSRF test uses deterministic DNS results. Ruff passed. No live webhook or IAM environment was contacted.

**2026-10-11 Central IAM browser live stream:** The WebSocket requires `threads:read` and `threads:write` plus matching owner/self scopes for the requested thread before lookup or retained browser-session access. It carries the signed local `sid` into the Central IAM resolver and retains local owner/origin checks. Browser and webhook regressions passed 76/76; Ruff passed. No migration or role grant was added; live IAM/WebSocket E2E remains open.

**2026-10-11 Central IAM personal preferences:** `GET/PATCH /api/v1/auth/preferences` require separate `preferences:read/write` route grants and matching verified owner/self data scopes before repository access. The local browser-session and account-owner checks remain mandatory. IAM migration `0030_deerflow_preference_permissions` registers codes only, with no automatic role grants. Regression: 19/19; Ruff check/format passed. Live IAM grants, database migrations, and browser E2E remain open.

**2026-10-11 runtime image status:** The dev image exists and its uv environment imports deerflow.authz.iam_deerflow. The default runtime image was not produced: Docker Hub Python manifest and GHCR uv anonymous-token requests returned EOF, even with pull disabled. A uv locked dry-run passes and backend/uv.lock remains unchanged. Retry runtime build after registry access or mirror configuration; no app service or database was started.

**2026-10-11 Docker build-context security:** Runtime config.yaml, extensions_config.json, their backup copies, and all .env* variants are excluded from the Docker context because local runtime files may contain provider/MCP credentials. The Docker daemon completed image iam-deerflow-package-check:20261011 (sha256:f2203cacf14d7a324dadcaa4d803145fcd9fd48129a9e9f15751e4beb4947456) after the CLI clients exited; a one-off container using uv run imported deerflow.authz.iam_deerflow successfully. The full Gateway service and database were not started.

**Central IAM model usage reconciliation (2026-10-11):** With metering enabled, IAM persists a per-call reservation before Provider dispatch even when quota blocking is off. After 10 minutes, unresolved reservations appear in the admin review queue and keep holding conservative TPM; IAM does not auto-charge the reserved maximum or auto-release. A platform admin records actual/estimated usage from Provider evidence or releases only after confirming no call occurred; every decision is audited. The fd_0028 SQL outbox retries locally committed events, but cannot reconstruct an event lost between Provider completion and outbox commit. IAM migration `0031_model_usage_reconciliation` is source-only and unverified; keep quota enforcement disabled until migration and live IAM/Provider E2E pass.

**Language:** English | [简体中文](README_zh.md)

**Central IAM console reports (2026-10-11):** `/api/console/stats` checks `runs:read`, `threads:read`, and `agents:read` plus their owner/self data scopes before SQL access; `/api/console/runs` checks run and thread read scopes because it includes thread titles; `/api/console/usage` checks run read. Keep local `user_id` filters in every query. Console router regressions passed 25/25 and Ruff passed for both changed Python files. This server-side slice adds no migration or automatic role grant; live IAM role mapping and browser checks remain open.

**Central IAM model quota status (2026-10-11):** `model.invoke` uses the server-mapped IAM model UUID; the run-scoped LangChain callback reserves before Provider dispatch and persists settle/report events to the SQL outbox. Delivery is idempotent by request ID with a 120-second lease and bounded retry; delivered-row retention defaults to 30 days. Explicit output caps and a server-only `IAM_MODEL_USAGE_API_KEY` are required; the feature remains opt-in. If the outbox commit is lost after Provider completion, IAM retains the reservation for admin reconciliation rather than guessing the charge. Custom Providers and live IAM/Provider acceptance remain open; keep quota enforcement disabled until verified.

DeerFlow is a LangGraph-based AI super agent with sandbox execution, persistent memory, and extensible tool integration. The backend enables AI agents to execute code, browse the web, manage files, delegate tasks to subagents, and retain context across conversations - all in isolated, per-thread environments.

**Central IAM memory scope (2026-10-11):** Prompt injection and `memory_search` check `memory:read`; add/update check read+write; delete checks read+delete; passive queue admission checks read+write. Before each background `apply_changes/save` commit and every revision retry, the default Gateway callback reloads the active local user and exact-identity OIDC vault session on the serving loop, then rechecks read+write owner/self scopes. Queue state carries no IAM token/capability; missing scope/session/loop, provider errors, and timeout deny persistence. Updater, data-scope and commit callback tests passed 109/109; Ruff check/format passed for 6 changed Python files. Live IAM/OIDC and browser acceptance remain open.

**OIDC logout revocation status (2026-10-11):** OIDC discovery retains optional `revocation_endpoint` metadata and the backend RFC 7009 client validates HTTPS, supports the configured client-auth methods, and redacts provider errors. `POST /api/v1/auth/logout` remains local-only; it deletes the matching vault row and does not transmit stored access/refresh tokens to the issuer pending explicit deployment approval. Mocked OIDC/vault regressions passed 41/41; no live IAM call was made.

### OIDC account provisioning

Scheduled-task routes enforce Central IAM self data scopes before repository access: `threads:read` for task reads; `threads:write` plus `runs:create` for creation; `threads:write` for updates/pauses; `threads:write` plus `runs:create` for resume/manual trigger; `threads:delete` for deletion; and `threads:read` plus `runs:read` for task-run history. Reused threads receive a separate `threads:read` scope check. The scheduler revalidates current user, grants and data scopes before admitting an occurrence and again before launching it from the durable queue. In Central IAM mode it uses an existing encrypted OIDC vault session for the exact local user/provider/issuer/subject identity; no session key or token is stored with the schedule. A revoked/unavailable grant pauses the task and cancels queued occurrences. Local owner filtering remains mandatory.

### Owner-scoped read data scopes

Project list/detail/project-thread reads check `projects:read`; global `POST /api/threads/search` checks `threads:read`; every owner-checked thread/run read checks `threads:read` / `runs:read` after local ownership and before the handler. Project document listing/content, project thread-file aggregation, and trash listing also check data scope before storage/query access. Memory routes require `memory:read/write/delete/admin`; because mutation responses return the full memory document, every route returning memory also checks `memory:read` scope before manager access. Custom Agent routes now require `agents:read/write/delete` plus owner/self data scope, intersected with the local user owner. Their write responses contain the full definition and therefore also require read permission/scope. Deployment-wide `/api/user-profile` reads/writes use `agents:admin` and are excluded from PAT routes. PAT memory and Agent routes are method/path allowlisted. Agent authz/PAT/`/auth/me` tests passed 82/82 and Ruff check/format passed for seven Python files. Memory/authz/PAT regressions passed 118/118. Document/promotion/trash regressions passed 72 with 2 skipped using a short Windows temp path; one maximum-length filename test remains blocked by Windows `WinError 3`. Tenant/organization sharing, formal IAM mappings, real IAM/browser acceptance, and target DB acceptance remain open.

Project create/update/archive/restore and document upload/thread-file promotion/trash restore now check `projects:write` (`action=write`) and `projects:read` scopes before mutation because the responses contain project/document rows. Promotion also checks `threads:read`; attaching a shelf document to a thread checks project `read` and thread `write`. Document soft-delete, single/batch purge, and opportunistic retention purge check `projects:delete` (`action=delete`) before touching files or rows. When list-time retention cleanup cannot obtain delete scope, it skips cleanup and still returns the authorized trash listing. Owner-filtered row reads supply resource IDs where required. Every mutation passes the authenticated local `user_id`. Project/document/trash router tests pass 92/92 in the network-disabled gateway container; Ruff passes.
Owner-checked thread/run mutations additionally call Central IAM data-scope authorization after the local owner check and before the handler: `threads:write/delete` and `runs:create/cancel`. Thread operations use `thread_id`; run cancellation binds the existing `run_id`; run creation is checked before any ID exists. Auth decorator tests pass 101/101; the broader offline route selection passes 532 with one public-DNS case deselected. Owner-bound write routes outside this decorator remain under audit.

New OIDC-provisioned accounts always start with `system_role=user`; `admin_emails` is accepted only for config compatibility and never grants admin access. Explicit IAM providers persist encrypted access/refresh tokens per local session; the signed local JWT carries only its random `sid`. Configure `DEERFLOW_IAM_TOKEN_ENCRYPTION_KEY` (Base64 for 32 random bytes), request `offline_access`, and apply DeerFlow migration `0026_iam_oidc_token_vault`. The Central IAM Python client and DeerFlow provider are vendored under `deerflow.authz` and included in the API image build context; target image build/deployment still needs acceptance. Request-level authorization and Agent model/tool checks use the vault capability and refresh near expiry. Owner-scoped Gateway reads now include project documents, project thread files, trash, memory, and custom Agent management in addition to projects, threads, and runs. Local `user_id` ownership remains an additional filter; tenant/organization scopes fail closed until DeerFlow can represent those ownership relationships. Commit-time background memory reauthorization is implemented but not yet verified in this worktree; upstream token revocation, target image deployment, real IAM/browser interoperability, and product DB acceptance remain open.

---

## Architecture

```
                        ┌──────────────────────────────────────┐
                        │          Nginx (Port 2026)           │
                        │      Unified reverse proxy           │
                        └───────┬──────────────────┬───────────┘
                                │
            /api/langgraph/*    │    /api/* (other)
            rewritten to /api/* │
                                ▼
               ┌────────────────────────────────────────┐
               │        Gateway API (8001)              │
               │        FastAPI REST + agent runtime    │
               │                                        │
               │ Models, MCP, Skills, Memory, Uploads,  │
               │ Artifacts, Threads, Runs, Streaming    │
               │                                        │
               │ ┌────────────────────────────────────┐ │
               │ │ Lead Agent                         │ │
               │ │ Middleware Chain, Tools, Subagents │ │
               │ └────────────────────────────────────┘ │
               └────────────────────────────────────────┘
```

**Request Routing** (via Nginx):
- `/api/langgraph/*` → Gateway LangGraph-compatible API - agent interactions, threads, streaming
- `/api/*` (other) → Gateway API - models, MCP, skills, memory, artifacts, uploads, thread-local cleanup
- `/` (non-API) → Frontend - Next.js web interface

---

## Core Components

### Lead Agent

The single LangGraph agent (`lead_agent`) is the runtime entry point, created via `make_lead_agent(config)`. It combines:

- **Dynamic model selection** with thinking and vision support
- **Middleware chain** for cross-cutting concerns (9 middlewares)
- **Tool system** with sandbox, MCP, community, and built-in tools
- **Subagent delegation** for parallel task execution
- **System prompt** with skills injection, memory context, and working directory guidance

### Middleware Chain

Middlewares execute in strict order, each handling a specific concern:

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | **ThreadDataMiddleware** | Creates per-thread isolated directories (workspace, uploads, outputs) |
| 2 | **UploadsMiddleware** | Injects newly uploaded files into conversation context |
| 3 | **SandboxMiddleware** | Acquires sandbox environment for code execution |
| 4 | **SummarizationMiddleware** | Reduces context when approaching token limits (optional) |
| 5 | **TodoListMiddleware** | Tracks multi-step tasks in plan mode (optional) |
| 6 | **TitleMiddleware** | Auto-generates conversation titles from the original user request after first exchange; attachment-only messages use a sanitized file name (or `N files uploaded` for multiple attachments) |
| 7 | **MemoryMiddleware** | Queues conversations for async memory extraction |
| 8 | **ViewImageMiddleware** | Injects image data for vision-capable models (conditional) |
| 9 | **ClarificationMiddleware** | Intercepts clarification requests and interrupts execution (must be last) |

When `loop_detection.enabled` is set, loop detection checks both repeated
tool-call sets and per-tool frequency. Warnings do not skip the rest of a
tool-call batch: any hard limit reached takes precedence and stops the entire
batch before tool execution. Warning-only batches remain fully counted and
receive a transient hint on the next model request.

### Sandbox System

Per-thread isolated execution with virtual path translation:

- **Abstract interface**: `execute_command`, `read_file`, `write_file`, `list_dir`
- **Providers**: `LocalSandboxProvider` (filesystem) and `AioSandboxProvider` (Docker, in community/). Async runtime paths use async sandbox lifecycle hooks so startup, readiness polling, and release do not block the event loop. `AioSandboxProvider` validates active-cache and warm-pool containers during acquire/reuse, dropping definitively dead entries so a thread can provision a fresh sandbox after an unexpected container exit while keeping `get()` as an in-memory lookup. Backend health-check failures are treated as unknown, not dead, and a container that cannot be verified during discovery is simply not adopted (acquire falls through to create instead of failing).
- **Virtual paths**: `/mnt/user-data/{workspace,uploads,outputs}` → thread-specific physical directories
- **Skills path**: `/mnt/skills` → `deer-flow/skills/` directory
- **Skills loading**: Recursively discovers nested `SKILL.md` files under `skills/{public,custom}` and preserves nested container paths
- **SkillScan**: Native offline deterministic scanning runs before the LLM skill scanner on installs and agent-managed skill writes; `CRITICAL` findings block and warning findings become LLM context
- **File-write safety**: `str_replace` serializes read-modify-write per `(sandbox.id, path)` so isolated sandboxes keep concurrency even when virtual paths match
- **Tools**: `bash`, `ls`, `read_file`, `write_file`, `str_replace` (`write_file` overwrites by default and exposes `append` for end-of-file writes; `bash` is disabled by default when using `LocalSandboxProvider`; use `AioSandboxProvider` for isolated shell access)

### Subagent System

Async task delegation with concurrent execution:

- **Built-in agents**: `general-purpose` (full toolset) and `bash` (command specialist, exposed only when shell access is available)
- **Concurrency**: Max 3 subagents per turn, 15-minute timeout
- **Execution**: Background thread pools with status tracking and SSE events
- **Flow**: Agent calls `task()` tool → executor runs subagent in background → polls for completion → returns result

### Memory System

LLM-powered persistent context retention across conversations:

- **Automatic extraction**: Analyzes conversations for user context, facts, and preferences
- **Scope-safe writes**: Middleware extraction stores only durable, descriptive user-level facts; global summaries also require descriptive authority, while contradiction removals and consolidated facts fail closed when scope metadata is missing or task/project-local
- **Atomic replacements**: A contradiction removal linked to a replacement runs only after the replacement survives scope/confidence gates, deduplication, and fact-limit trimming
- **Structured storage**: User context (work, personal, top-of-mind), history, and confidence-scored facts
- **Debounced updates**: Batches updates to minimize LLM calls (configurable wait time)
- **System prompt injection**: Top facts + context injected into agent prompts
- **Run-level memory identity**: `GET /api/threads/{thread_id}/runs/{run_id}/events?event_types=context:memory` returns the SHA-256 identity of the effective hidden memory block without copying memory text into the event store
- **Read failures**: Strict backend policies (including legacy `fail_closed`) stop the turn, including at the 5-second async injection deadline. Fail-open reads continue without new context. Timeout handling does not wait for a free worker; a timed-out read may still occupy its worker until the backend returns.
- **Storage**: JSON file with mtime-based cache invalidation

### Tool Ecosystem

| Category | Tools |
|----------|-------|
| **Sandbox** | `bash`, `ls`, `read_file`, `write_file`, `str_replace` |
| **Built-in** | `present_files`, `ask_clarification`, `view_image`, `task` (subagent) |
| **Community** | Tavily (web search), Jina AI (web fetch), Crawl4AI (web fetch), Firecrawl (scraping), fastCRW (scraping), DuckDuckGo (image search) |
| **MCP** | Any Model Context Protocol server (stdio, SSE, HTTP transports) |
| **Skills** | Domain-specific workflows injected via system prompt |

### Gateway API

FastAPI application providing REST endpoints for frontend integration:

| Route | Purpose |
|-------|---------|
| `GET /api/models` | List available LLM models |
| `GET/PUT /api/mcp/config` | Manage MCP server configurations |
| `POST /api/mcp/cache/reset` | Reset cached MCP tools so they reload on next use |
| `GET/PUT /api/skills` | List and manage skills |
| `POST /api/skills/install` | Install skill from `.skill` archive |
| `GET /api/memory` | Retrieve memory data |
| `POST /api/memory/reload` | Force memory reload |
| `GET /api/memory/config` | Memory configuration |
| `GET /api/memory/status` | Admin-only combined backend config + personal data; requires `memory:admin` and `memory:read` |
| `GET /api/threads/{id}/runs/{run_id}/events` | Debug/audit events for one run; filter `event_types=context:memory` for effective memory identity |
| `POST /api/threads/{id}/uploads` | Upload files (auto-converts PDF/PPT/Excel/Word to Markdown, rejects directory paths, auto-renames duplicate filenames in one request) |
| `GET /api/threads/{id}/uploads/list` | List uploaded files |
| `DELETE /api/threads/{id}` | Delete DeerFlow-managed local thread data after LangGraph thread deletion; unexpected failures are logged server-side and return a generic 500 detail |
| `GET /api/threads/{id}/artifacts/{path}` | Serve generated artifacts |

Browser memory requests may include `X-Expected-User-Id` as a stale-tab
account-switch fence. A mismatch returns `409` before memory access; the header
is optional for older API clients and does not replace route or IAM checks.

### IM Channels

The IM bridge supports Feishu, Slack, and Telegram. Slack and Telegram still use the final `runs.wait()` response path, while Feishu now streams through `runs.stream(["messages-tuple", "values"])`, serializes rapid same-thread turns inside the channel manager, and updates a single in-thread card per source message in place.

Discord registers each typing-indicator loop before inbound message handling yields and refuses to start new typing work after the channel stops. Typing tasks are owned by the dedicated Discord event loop, so normal shutdown schedules bounded cancellation, awaiting, and map cleanup on that loop before closing the client. The Discord worker also drains the tasks in its `finally` block while its loop is still usable, covering disconnect and exception exits; if `stop()` encounters an already-stopped foreign loop, it never awaits those loop-bound tasks from the main loop. This serializes registration and cleanup across the main and Discord threads while preventing shutdown hangs and cross-loop `RuntimeError`s.

For Feishu card updates, DeerFlow stores the running card's `message_id` per inbound message and patches that same card until the run finishes, preserving the existing `OK` / `DONE` reaction flow. When a follow-up arrives inside an existing Feishu topic while another turn is still running, the later message now waits on the mapped DeerFlow `thread_id`, receives a queued/running card on that exact source message, and keeps a compact source-message blockquote in subsequent patches so rapid consecutive questions remain distinguishable.

---

## Quick Start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager
- API keys for your chosen LLM provider

### Installation

```bash
cd deer-flow

# Copy configuration files
cp config.example.yaml config.yaml

# Install backend dependencies
cd backend
make install
```

### Configuration

Edit `config.yaml` in the project root:

```yaml
models:
  - name: gpt-4o
    display_name: GPT-4o
    use: langchain_openai:ChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY
    supports_thinking: false
    supports_vision: true

  - name: gpt-5-responses
    display_name: GPT-5 (Responses API)
    use: langchain_openai:ChatOpenAI
    model: gpt-5
    api_key: $OPENAI_API_KEY
    use_responses_api: true
    output_version: responses/v1
    supports_vision: true
```

Set your API keys:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

### Running

**Full Application** (from project root):

```bash
make dev  # Starts Gateway + Frontend + Nginx
```

Access at: http://localhost:2026

**Backend Only** (from backend directory):

```bash
# Gateway API + embedded agent runtime
make dev
```

Direct access: Gateway at http://localhost:8001

**Terminal Workbench (TUI)** — a terminal-native UI over the embedded harness,
no services required:

```bash
uv pip install 'deerflow-harness[tui]'   # optional 'textual' dependency
deerflow                                 # launch the TUI
deerflow --print "summarize this repo"   # headless one-shot
deerflow --recursion-limit 250 --print "run a longer task"
```

Sessions opened in the TUI appear in the Web UI sidebar (it writes the shared
`threads_meta` store under the local default user). See [docs/TUI.md](docs/TUI.md).

---

## Project Structure

```
backend/
├── packages/harness/           # deerflow-harness package (import: deerflow.*)
│   └── deerflow/
│       ├── agents/             # Agent system
│       │   ├── lead_agent/     # Main agent (factory, prompts)
│       │   ├── middlewares/    # Middleware components
│       │   ├── memory/         # Memory extraction & storage
│       │   └── thread_state.py # ThreadState schema
│       ├── sandbox/            # Sandbox execution
│       │   ├── local/          # Local filesystem provider
│       │   ├── sandbox.py      # Abstract interface
│       │   ├── tools.py        # bash, ls, read/write/str_replace
│       │   └── middleware.py   # Sandbox lifecycle
│       ├── subagents/          # Subagent delegation
│       │   ├── builtins/       # general-purpose, bash agents
│       │   ├── executor.py     # Background execution engine
│       │   └── registry.py     # Agent registry
│       ├── tools/builtins/     # Built-in tools
│       ├── mcp/                # MCP protocol integration
│       ├── models/             # Model factory
│       ├── skills/             # Skill discovery & loading
│       ├── config/             # Configuration system
│       ├── runtime/            # Embedded run execution (RunManager, StreamBridge)
│       ├── persistence/        # Checkpointer/store engines & schema migrations
│       ├── guardrails/         # Pre-tool-call authorization providers
│       ├── tracing/            # Tracer factory & trace metadata
│       ├── uploads/            # Uploads manager
│       ├── tui/                # Terminal UI (`deerflow` console script)
│       ├── community/          # Community tools & providers
│       ├── reflection/         # Dynamic module loading
│       └── utils/              # Utilities
├── app/                        # FastAPI Gateway + IM channels (import: app.*)
│   ├── gateway/                # Gateway API
│   │   ├── app.py              # Application setup
│   │   └── routers/            # Route modules
│   └── channels/               # IM channel integrations
├── docs/                       # Documentation
├── tests/                      # Test suite
├── langgraph.json              # LangGraph graph registry for tooling/Studio compatibility
├── pyproject.toml              # Python dependencies
├── Makefile                    # Development commands
└── Dockerfile                  # Container build
```

`langgraph.json` is not the default service entrypoint.  The scripts and Docker
deployments run the Gateway embedded runtime; the file is kept for LangGraph
tooling, Studio, or direct LangGraph Server compatibility.

To start the optional standalone development server and open its Studio URL:

```bash
cd backend
uv run langgraph dev --allow-blocking
```

Run it from `backend/` so the CLI discovers `langgraph.json`. The in-memory
server is intended for development and testing, not production deployment. The
flag permits DeerFlow's synchronous configuration and graph-factory setup
during local Studio requests; it is not a production-server setting. Its local
Studio authentication and registered graph discovery are handled automatically;
no custom connection headers are required. Assistant ownership/provenance is
stamped by the server, and normal assistant-version selection remains available.
Before the locked local runtime loads its persisted development store, DeerFlow
repairs legacy assistant rows and version history so older metadata cannot
reactivate server-only privileges or be discarded by runtime startup cleanup.
Run `uv sync` after dependency changes; this compatibility path requires the
declared LangGraph runtime versions and warns when the persisted-store contract
does not match its expectations.
The same file-based custom-app loading path used by this command is covered by
the backend regression suite.

---

## Configuration

### Main Configuration (`config.yaml`)

Place in project root. Config values starting with `$` resolve as environment variables.

Key sections:
- `models` - LLM configurations with class paths, API keys, thinking/vision flags
- `tools` - Tool definitions with module paths and groups
- `tool_groups` - Logical tool groupings
- `sandbox` - Execution environment provider
- `skills` - Skills directory paths
- `title` - Auto-title generation settings
- `summarization` - Context summarization settings
- `subagents` - Subagent system (enabled/disabled)
- `memory` - Memory system settings (enabled, storage, debounce, facts limits)

Provider note:
- `models[*].use` references provider classes by module path (for example `langchain_openai:ChatOpenAI`).
- If a provider module is missing, DeerFlow now returns an actionable error with install guidance (for example `uv add langchain-google-genai`).

### Extensions Configuration (`extensions_config.json`)

MCP servers and skill states in a single file:

```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}
    },
    "secure-http": {
      "enabled": true,
      "type": "http",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "enabled": true,
        "token_url": "https://auth.example.com/oauth/token",
        "grant_type": "client_credentials",
        "client_id": "$MCP_OAUTH_CLIENT_ID",
        "client_secret": "$MCP_OAUTH_CLIENT_SECRET"
      }
    },
    "postgres": {
      "enabled": false,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
      "description": "PostgreSQL database access",
      "routing": {
        "mode": "prefer",
        "priority": 50,
        "keywords": ["orders", "users", "SQL", "database", "table"]
      },
      "tools": {
        "query": {
          "routing": {
            "priority": 100,
            "keywords": ["query database", "orders table", "metrics"]
          }
        }
      }
    }
  },
  "skills": {
    "pdf-processing": {"enabled": true}
  }
}
```

`routing` adds soft MCP preference hints to the agent prompt. It helps the
model prefer a configured MCP tool for matching requests without forbidding
other tools. When `tool_search.enabled=true` defers MCP schemas, matching
routing metadata can auto-promote up to `tool_search.auto_promote_top_k`
deferred schemas before the model call.

### Environment Variables

- `DEER_FLOW_CONFIG_PATH` - Override config.yaml location
- `DEER_FLOW_EXTENSIONS_CONFIG_PATH` - Override extensions_config.json location
- Model API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, etc.
- Tool API keys: `TAVILY_API_KEY`, `GITHUB_TOKEN`, etc.

### LangSmith Tracing

DeerFlow has built-in [LangSmith](https://smith.langchain.com) integration for observability. When enabled, all LLM calls, agent runs, tool executions, and middleware processing are traced and visible in the LangSmith dashboard.

**Setup:**

1. Sign up at [smith.langchain.com](https://smith.langchain.com) and create a project.
2. Add the following to your `.env` file in the project root:

```bash
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGSMITH_PROJECT=xxx
```

**Legacy variables:** The `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`, and `LANGCHAIN_ENDPOINT` variables are also supported for backward compatibility. `LANGSMITH_*` variables take precedence when both are set.

### Langfuse Tracing

DeerFlow also supports [Langfuse](https://langfuse.com) observability for LangChain-compatible runs.

Add the following to your `.env` file:

```bash
LANGFUSE_TRACING=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

If you are using a self-hosted Langfuse deployment, set `LANGFUSE_BASE_URL` to your Langfuse host.

### Dual Provider Behavior

If both LangSmith and Langfuse are enabled, DeerFlow initializes and attaches both callbacks so the same run data is reported to both systems.

If a provider is explicitly enabled but required credentials are missing, or the provider callback cannot be initialized, DeerFlow raises an error when tracing is initialized during model creation instead of silently disabling tracing.

**Docker:** In `docker-compose.yaml`, tracing is disabled by default (`LANGSMITH_TRACING=false`). Set `LANGSMITH_TRACING=true` and/or `LANGFUSE_TRACING=true` in your `.env`, together with the required credentials, to enable tracing in containerized deployments.

---

## Development

### Commands

```bash
make install    # Install dependencies
make dev        # Run Gateway API + embedded agent runtime with safe reload (port 8001)
make gateway    # Run Gateway API without reload (port 8001)
make lint       # Run linter (ruff)
make format     # Format code (ruff)
make detect-blocking-io  # Inventory blocking IO that may block the backend event loop
make migrate-rev MSG="..."  # Autogenerate a new alembic revision against the live ORM models
```

`make dev` pre-creates and excludes `DEER_FLOW_HOME` (by default
`backend/.deer-flow`) and `backend/sandbox` from Uvicorn's reload watcher. Use
this target instead of a bare `uvicorn --reload`: agent tasks write Python and
other runtime files under `DEER_FLOW_HOME`, and watching that directory can
restart the Gateway during an active run.

### Schema Migrations

DeerFlow's application tables (`runs`, `threads_meta`, `feedback`, `users`,
`run_events`, and the `channel_*` tables) are owned by alembic. The Gateway
runs `alembic upgrade head` automatically on startup via
`bootstrap_schema(engine, backend=...)`, so operators do not run `alembic`
manually in production. Bootstrap is concurrency-safe (Postgres advisory lock
across processes; per-engine `asyncio.Lock` inside one SQLite process) and
idempotent against pre-existing schemas (empty / legacy / versioned).

When you add or change an ORM model, ship the change as a new revision under
`packages/harness/deerflow/persistence/migrations/versions/`:

```bash
make migrate-rev MSG="add foo column to runs"
```

The target invokes `scripts/_autogen_revision.py`, which builds a fresh temp
SQLite at `head` and diffs the live models against it — so a clean checkout
does not need a pre-existing `./data/deerflow.db`. Review the generated file
and switch raw `op.add_column` / `op.drop_column` calls to the idempotent
helpers in `migrations/_helpers.py` before committing. There is no
`make migrate` / `make migrate-stamp` target on purpose — Gateway startup is
the only execution path, which keeps operational mistakes off the table. See
`backend/CLAUDE.md` (Schema Migrations) for the full design.

### Code Style

- **Linter/Formatter**: `ruff`
- **Line length**: 240 characters
- **Python**: 3.12+ with type hints
- **Quotes**: Double quotes
- **Indentation**: 4 spaces

### Testing

```bash
# Default offline backend suite (live external-API and blocking-I/O tests are excluded)
make test

# Strict blocking-I/O suite
make test-blocking-io

# Explicit real-API DeerFlowClient integration suite
make test-live
```

The live suite requires a valid root `config.yaml` and API credentials. It may
incur API costs or create local sandboxes, artifacts, and files, so it is not
part of default test runs or CI. Direct pytest invocation of
`tests/test_client_live.py` also requires
`DEER_FLOW_RUN_LIVE_TESTS=1`.

`make detect-blocking-io` statically scans backend business code for blocking
IO that may run on the backend event loop and is not test-coverage-bound. It
prints a concise summary for human review and writes complete JSON findings to
`.deer-flow/blocking-io-findings.json` at the repository root (regardless of
whether the target is invoked from the repo root or from `backend/`). JSON
findings include both broad IO category and review-oriented fields such as
`priority`, `location`, `blocking_call`, `event_loop_exposure`, `reason`, and
`code`. `priority` is a deterministic review ordering from the operation type,
not proof of a bug. Bare-name same-file calls are resolved by function name,
so duplicate helper names in one file can conservatively over-report async
reachability.

---

## Technology Stack

- **LangGraph** (1.0.6+) - Agent framework and multi-agent orchestration
- **LangChain** (1.2.3+) - LLM abstractions and tool system
- **FastAPI** (0.115.0+) - Gateway REST API
- **langchain-mcp-adapters** - Model Context Protocol support
- **agent-sandbox** - Sandboxed code execution
- **markitdown** - Multi-format document conversion
- **tavily-python** / **firecrawl-py** - Web search and scraping

---

## Documentation

- [Configuration Guide](docs/CONFIGURATION.md)
- [Architecture Details](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [File Upload](docs/FILE_UPLOAD.md)
- [Path Examples](docs/PATH_EXAMPLES.md)
- [Context Summarization](docs/summarization.md)
- [Plan Mode](docs/plan_mode_usage.md)
- [Setup Guide](docs/SETUP.md)

---

## License

See the [LICENSE](../LICENSE) file in the project root.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
