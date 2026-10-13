import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  fetchSetupStatus: rs.fn(),
  useAuth: rs.fn(),
  push: rs.fn(),
  replace: rs.fn(),
  router: {} as { push: () => void; replace: () => void },
}));
mocks.router = { push: mocks.push, replace: mocks.replace };

rs.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => mocks.useAuth(),
}));
rs.mock("@/core/auth/setup", () => ({
  fetchSetupStatus: mocks.fetchSetupStatus,
  isSystemAlreadyInitializedError: () => false,
}));
rs.mock("@/core/auth/remember-login", () => ({
  loadRememberLoginPreference: () => ({ rememberMe: true }),
}));
rs.mock("@/components/ui/flickering-grid", () => ({
  FlickeringGrid: () => null,
}));
rs.mock("@/product/brand-mark", () => ({ BrandMark: () => null }));

import SetupPage from "@/app/(auth)/setup/page";
import { I18nProvider } from "@/core/i18n/context";

function renderSetup(initialLocale: "en-US" | "zh-CN") {
  // SetupPage's shared locale hook prefers the persisted browser choice after
  // mount. Keep that choice aligned with the server-provided initial locale so
  // this test models a real request with a locale cookie.
  document.cookie = `locale=${initialLocale}; path=/; SameSite=Lax`;

  return render(
    <I18nProvider initialLocale={initialLocale}>
      <SetupPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.fetchSetupStatus.mockReset();
  mocks.fetchSetupStatus.mockResolvedValue({ needs_setup: true });
  mocks.useAuth.mockReset();
  mocks.useAuth.mockReturnValue({ user: null, isAuthenticated: false });
  mocks.push.mockReset();
  mocks.replace.mockReset();
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("SetupPage localized forms", () => {
  it("shows Chinese labels for creating the first administrator", async () => {
    renderSetup("zh-CN");

    expect(await screen.findByText("创建首个管理员账号")).toBeDefined();
    expect(screen.getByLabelText("邮箱")).toBeDefined();
    expect(screen.getByLabelText("密码")).toBeDefined();
    expect(screen.getByLabelText("确认密码")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "创建管理员账号" }),
    ).toBeDefined();

    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-one" },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "password-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建管理员账号" }));
    expect(await screen.findByText("两次输入的新密码不一致")).toBeDefined();
  });

  it("shows English copy for creating the first administrator", async () => {
    renderSetup("en-US");

    expect(
      await screen.findByText("Create the first administrator"),
    ).toBeDefined();
    expect(screen.getByLabelText("Email")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByLabelText("Confirm password")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password-one" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "password-two" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create admin account" }),
    );
    expect(await screen.findByText("New passwords do not match")).toBeDefined();
  });

  it("labels every field in the Chinese first-login password form", async () => {
    mocks.useAuth.mockReturnValue({
      user: { needs_setup: true },
      isAuthenticated: true,
    });
    renderSetup("zh-CN");

    expect(await screen.findByText("完成管理员初始化")).toBeDefined();
    expect(screen.getByLabelText("邮箱")).toBeDefined();
    expect(screen.getByLabelText("当前密码")).toBeDefined();
    expect(screen.getByLabelText("新密码")).toBeDefined();
    expect(screen.getByLabelText("确认新密码")).toBeDefined();
    expect(screen.getByRole("button", { name: "完成初始化" })).toBeDefined();
  });
});
