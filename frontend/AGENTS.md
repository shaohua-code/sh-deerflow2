# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, and others) when working with the DeerFlow frontend. It is the source of truth; the sibling `CLAUDE.md` imports it via `@AGENTS.md`.

## Project Overview

DeerFlow Frontend is a Next.js 16 web interface for an AI agent system. It communicates with a LangGraph-based backend to provide thread-based AI conversations with streaming responses, artifacts, and a skills/tools system.

**Stack**: Next.js 16, React 19, TypeScript 5.8, Tailwind CSS 4, pnpm 10.26.2. Requires Node.js 22+ and pnpm 10.26.2+.

### Core dependencies

- **LangGraph SDK** (`@langchain/langgraph-sdk` ^1.5.3) — Agent orchestration and streaming
- **LangChain Core** (`@langchain/core` ^1.1.15) — Fundamental AI building blocks
- **TanStack Query** (`@tanstack/react-query` ^5.90.17) — Server state management
- **UI**: Shadcn UI, MagicUI, React Bits, and Vercel AI SDK elements (generated from registries — see Code Style)

`pnpm-workspace.yaml` overrides vulnerable `@xmldom/xmldom` 0.9.x releases to
0.9.12 for GHSA-965w-775f-mr7g. Nextra pulls it in through MathJax and
`speech-rule-engine@4.1.2`, which pins 0.9.8. Keep the override until the
upstream dependency chain resolves a patched version without it; regenerate
`pnpm-lock.yaml` and verify the docs build when changing this constraint.

## Commands

| Command          | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `pnpm dev`       | Start the development server with Webpack     |
| `pnpm build`     | Production build                              |
| `pnpm check`     | Lint + type check (run before committing)     |
| `pnpm lint`      | ESLint only                                   |
| `pnpm lint:fix`  | ESLint with auto-fix                          |
| `pnpm format`    | Prettier check (`pnpm format:write` to apply) |
| `pnpm test`      | Run unit tests with Rstest                    |
| `pnpm test:e2e`  | Run E2E tests with Playwright (Chromium)      |
| `pnpm typecheck` | TypeScript type check (`tsc --noEmit`)        |
| `pnpm start`     | Start production server                       |

Unit tests live under `tests/unit/` and mirror the `src/` layout (e.g., `tests/unit/core/api/stream-mode.test.ts` tests `src/core/api/stream-mode.ts`). Powered by Rstest; import source modules via the `@/` path alias.

Webpack is the default development bundler. Use `DEER_FLOW_DEV_BUNDLER=turbo` with `pnpm dev` to opt in to Turbopack when diagnosing a local Next.js bundler issue.

Rstest runs them as two projects (`rstest.config.ts`). `*.test.ts` / `*.test.tsx` run in a plain **node** environment — that is nearly the whole suite, and it is the default for anything that is pure logic. `*.dom.test.ts` / `*.dom.test.tsx` run in **happy-dom**, for tests that need a document: hooks driven through `renderHook` from `@testing-library/react`, and components. Keep the split — a DOM environment costs roughly 3x the runtime of the node suite, so tests that do not render should not opt into it. A hook whose behavior only exists under real React (effect ordering, cleanup on unmount, re-render on store change) belongs in a `.dom.test.*` file rather than a node test that mocks `react` itself.

E2E tests use Playwright/Chromium, mock APIs through page.route, and cover real interactions. Configuration is playwright.config.ts; Windows server startup gets five minutes. Set PLAYWRIGHT_SKIP_WEB_SERVER=1 only for an existing server. Update tests/e2e-real-backend/auth-disabled-contract.spec.ts and backend/tests/test_auth_me_permissions.py whenever route permissions change.

The dedicated `run-history.ts` hook replaces the unpaged runs hook. Show counts
only after a successful history read, never during initial loading or errors.
Scheduled run history uses task/page query keys and the existing live offset API.
Fetch 51 rows to display 50 plus a next-page sentinel; never append pages. Only
page zero polls or refreshes on focus/reconnect. Task switches reset to page zero,
and consumed AbortSignals cancel obsolete reads. Live offsets are not snapshots;
explicit mutations or navigation may observe newly inserted runs.

## Architecture

```
Frontend (Next.js) ──▶ LangGraph SDK ──▶ LangGraph Backend (lead_agent)
                                              ├── Sub-Agents
                                              └── Tools & Skills
```

The frontend is a stateful chat application. Users create **threads** (conversations), send messages, set thread-scoped `/goal` completion conditions, and receive streamed AI responses. The backend orchestrates agents that can produce **artifacts** (files/code), **todos**, and goal state updates.

### Source Layout (`src/`)

- **`app/`** — Next.js App Router. Routes include `/` (landing), `/showcase/[thread_id]` (allowlisted public read-only demos), `/workspace/chats/[thread_id]` (authenticated chat), `/workspace/agents/[agent_name]` and `/workspace/agents/new` (custom agents), `/artifacts/view` (chrome-free window that renders Markdown or CSV/TSV artifacts with the panel's own renderer), `/blog/…`, the `(auth)/{login,setup,auth/callback}` flow, `/[lang]/docs/…`, and `/api/…` route handlers (e.g. `/api/memory`).
- **`components/`** — React components:
  - `ui/` — Shadcn UI primitives (auto-generated, ESLint-ignored)
  - `ai-elements/` — Vercel AI SDK elements (auto-generated, ESLint-ignored)
  - `workspace/` — Chat page components (messages, artifacts, settings)
  - `auth/` — Product-owned responsive authentication shell. Keep visual branding here while login, registration, SSO, and first-admin setup continue to call the existing Gateway auth APIs.
  - `landing/` — Landing page sections
  - `docs/` — Docs / MDX rendering components
- **`core/`** — Business logic, the heart of the app. Domains include `threads/` (creation, streaming, state), `api/` (LangGraph client singleton), `agents/` (custom agents), `subagents/` (runtime worker catalog and administrator mutations), `auth/` (authentication), `artifacts/`, `channels/` (IM connections), `integrations/` (managed third-party integration status/install clients such as Lark CLI), `i18n/` (en-US, zh-CN), `settings/`, `memory/`, `skills/`, `messages/`, `mcp/`, `models/`, `input-polish/` (pre-send draft rewrite API), `voice-input/` (browser speech-recognition helpers), `suggestions/`, `tasks/`, `todos/`, `tools/`, `workspace-changes/` (run-scoped changed-file summaries and diff fetching), `config/`, `notification/`, `blog/`, plus rendering helpers (`rehype/`, `streamdown/`) and `utils/`.
- **`hooks/`** — Shared React hooks
- **`lib/`** — Utilities (`cn()` from clsx + tailwind-merge)
- **`content/`** — MDX content (blog posts, docs) rendered by the app
- **`product/`** — this checkout's self-owned brand, copy, feature display flags, and page compositions; see [`src/product/README.md`](src/product/README.md)
- **`styles/`** — Global CSS with Tailwind v4 `@import` syntax and CSS variables for theming
- **`typings/`** — Ambient TypeScript declarations
- Root files: `env.js` (env validation), `mdx-components.ts` (MDX component map)

More specific `AGENTS.md` files under `src/` contain the frontend sections split from this file.

## Code Style

Custom Agent `display_name` is an optional Unicode UI label, edited in
`AgentSettingsDialog`. Use it with a fallback to `name` for gallery/chat text;
keep `name` for React identity, URLs, requests, and runtime `agent_name`.
The 100-code-point budget uses `[...value.trim()].length`, matching Pydantic;
do not use HTML `maxLength`, which counts UTF-16 code units instead.

- **Imports**: Enforced ordering (builtin → external → internal → parent → sibling), alphabetized, newlines between groups. Use inline type imports: `import { type Foo }`.
- **Unused variables**: Prefix with `_`.
- **Class names**: Use `cn()` from `@/lib/utils` for conditional Tailwind classes.
- **Path alias**: `@/*` maps to `src/*`.
- **Components**: `ui/` and `ai-elements/` are generated from registries (Shadcn, MagicUI, React Bits, Vercel AI SDK) — don't manually edit these.
- **ESLint + PNPM**: Next.js 16 uses native Flat Config from `eslint-config-next/core-web-vitals`; keep `eslint-config-next` aligned with the installed Next.js major/minor line and combine the exported config array directly. Do not reintroduce `FlatCompat`, resolve private plugin files manually, pin a `.pnpm` virtual-store path, or add a hoisting requirement. If the local dependency tree does not match the lockfile, avoid repairing it by deleting/recreating `node_modules`; report that runtime lint validation needs a safe dependency sync.
- **Product boundary**: keep brand/product pages in src/product and compose core flows. Feature flags never authorize. Admin account status uses the session-aware Gateway API; disabled accounts invalidate cached browser credentials. Keep the status DTO, validator, locales and alerts aligned with stopped, cross-Gateway-pending and unconfirmed-run states.
- **Theme ownership**: `src/components/theme-provider.tsx` owns the product theme context, `theme` localStorage preference, system preference listener, and the root `dark` class. `src/app/layout.tsx` runs the small `next/script` `beforeInteractive` bootstrap from the Server Component so the initial paint is correct; do not reintroduce `next-themes`' client-rendered script. Theme consumers import `useTheme` from the local provider. The public homepage remains forced dark while the saved preference is preserved for other routes.

- **工作台查询缓存隔离**：`product/workspace-query-boundary.tsx` 按当前认证用户 ID 重挂载工作台 QueryClient；`components/query-client-provider.tsx` 每个 Provider 实例单独创建缓存。新增 owner 数据查询仍应把用户 ID 放入 key；切换账号时旧缓存、在途页面和未提交草稿必须先卸载，不能依赖只清空可见列表。公开预览与独立文件查看器保持各自的 Provider 实例。
- **产物面板浏览器状态**：`components/workspace/artifacts/context.tsx` 的 v2 sessionStorage 键包含用户 ID 和路径。旧 v1 键没有账号归属，不自动迁移或读取；切换账号/路径时须避免旧一帧状态写入新键。文件正文和编辑草稿仍不得写入浏览器持久存储。
- **项目资料附加暂存**：`core/projects/composer-attach.ts` 的 v2 sessionStorage 键包含用户 ID 与 thread ID。项目资料附加成功时用当前已认证 owner 暂存，输入框只读取同一 owner 的键；旧版仅含 thread ID 的键保留但不读取或迁移。账号/会话切换期间不得把旧附件显示或写入新作用域。

## Environment

Scheduled-task interval forms preserve the initial `every_seconds` on mount,
timezone changes, and untouched blur. The backend's configurable interval minimum
can be lower than the UI's default 60-second floor. Apply that UI floor only after
an explicit amount/unit edit so editing metadata or duplicating a task cannot
silently change its cadence. Component regressions live in
`tests/unit/components/workspace/scheduled-task-schedule-input.dom.test.tsx`.

Backend API URLs are optional; an nginx proxy is used by default:

```
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8001
NEXT_PUBLIC_LANGGRAPH_BASE_URL=http://localhost:8001/api
```

Leave these unset for the standard `make dev` / Docker flow, where nginx serves the public `/api/langgraph/*` prefix and rewrites it to Gateway's native `/api/*` routes.

`make build-static` creates a standalone read-only demo and copies `.next/static`
and `public` into the output. In static mode, `core/api/static-response.ts`
resolves Gateway REST reads with empty capability/catalog responses or existing
same-origin `/mock/api` fixtures; writes and unknown API routes fail locally.
The `/github-stars` dynamic route is kept for the standalone demo even though
the legacy landing star counter that called it was removed with the old landing
blocks. It reads the server-only `GITHUB_OAUTH_TOKEN` at runtime, caches
GitHub data for one hour, and returns 204 when the count is unavailable. Start
the standalone server from `frontend/` with `node --env-file=.env
.next/standalone/server.js` to load the current credentials.

To reach a dev server on anything other than localhost — a LAN address, or a proxied hostname — list the host in `DEER_FLOW_DEV_ALLOWED_ORIGINS` (comma-separated; a full URL is reduced to its host). It feeds Next's `allowedDevOrigins`, which gates `/_next/*`, fonts, and HMR. Without it those requests get a 403 and the page renders server-side but never hydrates, so nothing on it — including the login form — responds. Development only; production builds ignore it.

For an isolated Next or Playwright run, set `DEER_FLOW_NEXT_DIST_DIR` to a new repo-local build directory named `.next-codex-*` and set `PORT` / `PLAYWRIGHT_BASE_URL` to a free loopback port when the Playwright config owns the server. These generated directories are excluded from Git, TypeScript, Tailwind source scanning, and ESLint so build output cannot be committed or treated as application code. The Playwright config passes the directory and port to its server process and adds loopback hosts to `NO_PROXY` / `no_proxy` in the test process only. The Next config defaults to `.next`; do not point two Next processes at the same build directory.

## Resources

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [LangChain Core Concepts](https://js.langchain.com/docs/concepts)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [Next.js App Router](https://nextjs.org/docs/app)

## Contributing

When adding features:

1. Follow the established `src/` structure
2. Add TypeScript types and proper error handling
3. Write unit tests under `tests/unit/` (`pnpm test`) and E2E tests under `tests/e2e/` (`pnpm test:e2e`)
4. Run `pnpm check` before committing
5. Update this `AGENTS.md` when architecture, commands, or conventions change

Route asset budgets are enforced with `pnpm perf:check`. The command measures
`/login` from a normal production build, then builds in static-demo mode for the
fixture-backed workspace routes. It starts the production server on temporary local
ports, measures the unique JavaScript and CSS files referenced by representative
routes, writes the detailed result to `.next/performance-results.json`, and compares
totals with `performance-budgets.json`. Fix route ownership or split points when a
budget fails; do not raise a ceiling without documenting and reviewing the measured
regression.

Chat archive is a thread metadata flag (`deerflow_archived === true`), independent
of run status. Sidebar and Chats explicitly request the Gateway's optional
`archived` filter through `searchThreadsByArchive`; the SDK drops this extension,
so use the authenticated REST fetcher. Static demos retain SDK fixture queries.
`core/threads/archive.ts` waits for the write, cancels stale reads, merges only the
owned flag into metadata snapshots, then restarts metadata reads and resets list
pagination. Keep both default and Custom Agent header restore controls in sync.
Pin/archive responses must not merge unrelated metadata flags: out-of-order
organization requests can otherwise roll back each other's confirmed state.
Run-created optimistic snapshots have no archive flag: refresh archive-filtered
lists from the server instead of inserting those snapshots into either view.

### Delimited artifact preview

CSV/TSV previews share `artifact-table-preview.tsx` between the panel and standalone viewer. Papa Parse runs only inside `delimited-preview.worker.ts`; `use-delimited-preview.ts` bounds input before transfer, cancels stale work, and enforces a five-second timeout. The parser detects the first record separator outside quoted fields and passes it explicitly to Papa Parse, so embedded newlines in an incomplete quoted field cannot corrupt newline detection. It retains at most 202 logical records and 50 columns, discarding an incomplete final record from truncated input. UI pagination displays at most 200 data rows in pages of 50. Keep the table mounted but inactive when switching to source so header/pagination state survives; changing file identity resets it. Pending `write_file` content stays in source mode until success.

Custom skill export is admin-only and disabled in static demos. The lazy
`skill-export-dialog.tsx` must abort requests and ignore stale callbacks on close
or user/skill changes. `core/skills/export.ts` owns the revision-bound Blob download;
HTTP 409 requires explicit preview refresh. Keep file lists paginated and diagnostics
localized. Browser handoff does not prove the file was saved to disk.

Sidebar rows request deletion through `ThreadDeleteDialogProvider`, hosted in
`WorkspaceSidebar` outside the virtualized flat/project lists. Keep the selected
thread snapshot and retry UI alive when a partial deletion removes its row.
Focus Cancel on open and after a failed deletion has re-enabled the actions;
block dismissal while deletion is pending. Show the error message when available,
with a localized fallback, and log the rejection for debugging. The shared
delete helper accepts remote 404 (not 403) before retrying local cleanup, and
`onDeleted` runs only after both deletion steps succeed.

产品文件中心、管理审计动作映射及能力中心的详细约束见 [产品数据与能力界面边界](docs/产品数据与能力界面边界.md)。调整这些页面时，先核对 Gateway owner 校验、部分结果提示、双语错误文案和运行时 Skill ID；前端展示不能替代服务端授权。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
