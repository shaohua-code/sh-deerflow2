import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1";

// 本地 E2E 必须绕过系统代理；只调整当前 Playwright 进程，不写入系统设置。
const localLoopbackHosts = ["localhost", "127.0.0.1", "::1"];
for (const name of ["NO_PROXY", "no_proxy"]) {
  const existing = (process.env[name] ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const existingSet = new Set(existing.map((host) => host.toLowerCase()));
  process.env[name] = [
    ...existing,
    ...localLoopbackHosts.filter((host) => !existingSet.has(host)),
  ].join(",");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,

  use: {
    baseURL,
    locale: "en-US",
    trace: "on-first-retry",
    // 产品默认语言是中文（core/i18n/locale.ts 的 DEFAULT_LOCALE）；无 Cookie
    // 时服务端一律渲染中文。绝大多数 E2E 断言英文文案，这里通过全局注入
    // en-US locale Cookie 维持原语义；个别用例自设 zh-CN Cookie 会覆盖它，
    // 默认中文路径由 landing.spec.ts 的清 Cookie 用例单独覆盖。
    storageState: {
      cookies: [
        {
          name: "locale",
          value: "en-US",
          domain: "localhost",
          path: "/",
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
        {
          name: "locale",
          value: "en-US",
          domain: "127.0.0.1",
          path: "/",
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: skipWebServer
    ? undefined
    : {
        command: "pnpm exec next build && pnpm exec next start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        // Windows 本地生产构建包含编译和类型检查，实测可能超过两分钟。
        timeout: 300_000,
        env: {
          SKIP_ENV_VALIDATION: "1",
          DEER_FLOW_AUTH_DISABLED: "1",
          // E2E 隔离运行时，确保 build 和 start 使用调用方设置的独立端口与产物目录。
          PORT: process.env.PORT ?? "3000",
          DEER_FLOW_NEXT_DIST_DIR:
            process.env.DEER_FLOW_NEXT_DIST_DIR?.trim() ?? ".next",
          NO_PROXY: process.env.NO_PROXY ?? "",
          no_proxy: process.env.no_proxy ?? "",
        },
      },
});
