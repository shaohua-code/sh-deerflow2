import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  fetchSetupStatus: rs.fn(),
  router: { push: rs.fn() },
}));

rs.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(),
}));
rs.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
rs.mock("@/components/auth/remember-session-option", () => ({
  RememberSessionOption: () => null,
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));
rs.mock("@/core/auth/remember-login", () => ({
  loadRememberLoginPreference: () => ({ email: "", rememberMe: false }),
  saveRememberLoginPreference: rs.fn(),
}));
rs.mock("@/core/auth/setup", () => ({
  canCreateRegularAccount: () => false,
  fetchSetupStatus: mocks.fetchSetupStatus,
}));
rs.mock("@/product/brand-mark", () => ({ BrandMark: () => null }));

import LoginPage from "@/app/(auth)/login/page";
import { I18nProvider } from "@/core/i18n/context";

function renderLogin(locale: "en-US" | "zh-CN") {
  // 和 SetupPage 测试一致，让挂载后的语言恢复模拟真实 locale cookie。
  document.cookie = `locale=${locale}; path=/; SameSite=Lax`;
  return render(
    <I18nProvider initialLocale={locale}>
      <LoginPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.fetchSetupStatus.mockRejectedValue(new Error("Gateway unavailable"));
  mocks.router.push.mockReset();
  rs.stubGlobal(
    "fetch",
    rs.fn().mockResolvedValue({ json: async () => ({ providers: [] }) }),
  );
});

afterEach(() => {
  cleanup();
  document.cookie = "locale=; path=/; max-age=0";
  rs.clearAllMocks();
  rs.unstubAllGlobals();
});

describe("LoginPage localized empty-field guidance", () => {
  it("does not make the empty Chinese password field look prefilled", async () => {
    renderLogin("zh-CN");

    const email = await screen.findByLabelText("邮箱");
    const password = screen.getByLabelText("密码");

    expect(email.getAttribute("placeholder")).toBe("请输入邮箱");
    expect(password.getAttribute("placeholder")).toBe("请输入密码");
    expect(await screen.findByText("服务暂时不可用")).toBeDefined();
    expect(
      screen.getByText("暂时无法连接网关。请检查服务状态，然后重试。"),
    ).toBeDefined();
  });

  it("shows clear English guidance without masking dots in an empty field", async () => {
    renderLogin("en-US");

    const email = await screen.findByLabelText("Email");
    const password = screen.getByLabelText("Password");

    expect(email.getAttribute("placeholder")).toBe("you@example.com");
    expect(password.getAttribute("placeholder")).toBe("Enter your password");
    expect(
      await screen.findByText("Service temporarily unavailable"),
    ).toBeDefined();
    expect(
      screen.getByText(
        "The Gateway is unavailable right now. Check that the service is running, then try again.",
      ),
    ).toBeDefined();
  });
});
