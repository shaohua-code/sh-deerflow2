# DeerFlow Frontend

**2026-10-14 Central IAM B04 update:** This pass changed backend notification timeout handling and backend test prerequisites only; no frontend source or API contract changed. Backend lifecycle/extension-manager/API-pin focused regressions passed **126** with **40** uv-dependent skips. The latest second 104-file slice had **2,368 passed, 2 failed, 86 skipped** before the timeout fix; frontend typecheck, lint, build, and browser acceptance were not run. IAM database migration remains pending per the user-reported UI message.

**2026-10-14 Central IAM B04 follow-up:** Only backend test harnesses changed in this pass; no frontend source or API contract changed. Backend shell/tool-gate tests passed **44** and skipped **13** for missing GNU make/`uv`. No frontend typecheck, lint, build, or browser acceptance was run; see the [project handoff](../docs/改造进度与后续计划.md).

**2026-10-11 IAM pilot backend update:** No DeerFlow frontend source changed in this slice. Backend usage callbacks now persist terminal events in the fd_0028 SQL outbox and retry delivery; focused backend regressions passed 118 tests with one existing warning. The live IAM/Provider flow, deployment migration, and browser acceptance remain open, so quota enforcement stays disabled.

Central IAM-protected console reports now require resource-aligned grants: stats needs run/thread/agent read, run history needs run/thread read, and usage needs run read. The Gateway also checks matching self data scopes and continues filtering rows by local user. This update changed the backend API contract only; the frontend source, build, and browser flow were not changed or revalidated. Configure IAM roles explicitly before enabling the console for users. Backend console route regressions passed 25/25.

Like the original DeerFlow 1.0, we would love to give the community a minimalistic and easy-to-use web interface with a more modern and flexible architecture.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with [App Router](https://nextjs.org/docs/app)
- **UI**: [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/), [MagicUI](https://magicui.design/) and [React Bits](https://reactbits.dev/)
- **AI Integration**: [LangGraph SDK](https://www.npmjs.com/package/@langchain/langgraph-sdk) and [Vercel AI Elements](https://vercel.com/ai-sdk/ai-elements)

### IAM OIDC session boundary

The frontend does not receive IAM access or refresh tokens. When an IAM OIDC Provider opts into Gateway token vaulting, the browser continues to use only the local HttpOnly session cookie; its signed `sid` is an opaque local session identifier. Gateway request-level route, model-catalog, and sandbox-sync checks resolve this session against central IAM. Authenticated Agent runs receive a short-lived server-side capability that enables online model/tool permission checks without adding credentials to graph context or checkpoints. The frontend never receives the token or central permission decision payload. Agent runs now revalidate the local vault session at admission and at most every 2 seconds while active, and refresh near-expiry access tokens. Gateway data-scope checks now cover projects, threads/runs, project documents/files, trash, and personal memory reads; they still enforce local owner filters and reject tenant/organization sharing until supported ownership fields exist. Background memory writes now reauthorize at commit and passed 109/109 focused regressions. OIDC logout still deletes only the local vault row; although the backend has a tested RFC 7009 client primitive, upstream token revocation stays disabled until explicit deployment approval. Deployment packaging and live IAM interoperability remain open.

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10.26.2+

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Development

```bash
# Start development server
pnpm dev

# The app will be available at http://localhost:3000
```

### Build & Test

```bash
# Type check
pnpm typecheck

# Check formatting
pnpm format

# Apply formatting
pnpm format:write

# Lint
pnpm lint

# Run unit tests
pnpm test

# One-time setup: install Playwright Chromium browser
pnpm exec playwright install chromium

# Run E2E tests (builds and starts production server automatically)
pnpm test:e2e

# Build for production
pnpm build

# Start production server
pnpm start
```

## Site Map

```
├── /                    # Landing page
├── /chats               # Chat list
├── /chats/new           # New chat page
└── /chats/[thread_id]   # A specific chat page
```

## Configuration

### Environment Variables

Key environment variables (see `.env.example` for full list):

```bash
# Backend API URL (optional, uses local Next.js/nginx proxy by default)
NEXT_PUBLIC_BACKEND_BASE_URL="http://localhost:8001"
# LangGraph-compatible API URL (optional, uses local Next.js/nginx proxy by default)
NEXT_PUBLIC_LANGGRAPH_BASE_URL="http://localhost:8001/api"
```

## Project Structure

```
tests/
├── e2e/                    # E2E tests (Playwright, Chromium, mocked backend)
└── unit/                   # Unit tests (mirrors src/ layout)
src/
├── app/                    # Next.js App Router pages
│   ├── api/                # API routes
│   ├── showcase/           # Allowlisted public read-only demos
│   ├── workspace/          # Main workspace pages
│   └── mock/               # Mock/demo pages
├── components/             # React components
│   ├── ui/                 # Reusable UI components
│   ├── workspace/          # Workspace-specific components
│   ├── landing/            # Landing page components
│   └── ai-elements/        # AI-related UI elements
├── core/                   # Core business logic
│   ├── api/                # API client & data fetching
│   ├── artifacts/          # Artifact management
│   ├── config/              # App configuration
│   ├── i18n/               # Internationalization
│   ├── mcp/                # MCP integration
│   ├── messages/           # Message handling
│   ├── models/             # Data models & types
│   ├── settings/           # User settings
│   ├── skills/             # Skills system
│   ├── threads/            # Thread management
│   ├── todos/              # Todo system
│   └── utils/              # Utility functions
├── hooks/                  # Custom React hooks
├── lib/                    # Shared libraries & utilities
├── server/                 # Server-side code
│   └── better-auth/        # Authentication setup and session helpers
└── styles/                 # Global styles
```

## Scripts

| Command             | Description                           |
| ------------------- | ------------------------------------- |
| `pnpm dev`          | Start development server with Webpack |
| `pnpm build`        | Build for production                  |
| `pnpm start`        | Start production server               |
| `pnpm test`         | Run unit tests with Rstest            |
| `pnpm test:e2e`     | Run E2E tests with Playwright         |
| `pnpm format`       | Check formatting with Prettier        |
| `pnpm format:write` | Apply formatting with Prettier        |
| `pnpm lint`         | Run ESLint                            |
| `pnpm lint:fix`     | Fix ESLint issues                     |
| `pnpm typecheck`    | Run TypeScript type checking          |
| `pnpm check`        | Run both lint and typecheck           |

## Development Notes

飞书插件连接支持失败恢复：连接前必须成功读取当前状态，状态请求失败会关闭预开的空白页并保留重试入口。等待浏览器授权期间可点击“重新开始连接”；旧流程被服务端取代或本地自动检查期限结束后也会恢复入口。自动检查结束只表示尚未确认结果，服务端权限与授权状态仍以 Gateway 为准。

- Uses pnpm workspaces (see `packageManager` in package.json)
- Webpack is the default development bundler until the upstream Turbopack PostCSS worker leak is fixed in a stable Next.js release (#5132). Set `DEER_FLOW_DEV_BUNDLER=turbo` to opt in to Turbopack for local diagnosis, or `DEER_FLOW_DEV_BUNDLER=webpack` to select Webpack explicitly. Reconsider the default after the stable fix is verified on macOS arm64 and Linux.
- The public homepage uses a small anonymous brand API client in the root layout. Keep it separate from the authenticated product API so opening `/` does not compile workspace API dependencies.
- Environment validation can be skipped with `SKIP_ENV_VALIDATION=1` (useful for Docker)
- Backend API URLs are optional; nginx proxy is used by default in development

## License

MIT License. See [LICENSE](../LICENSE) for details.
