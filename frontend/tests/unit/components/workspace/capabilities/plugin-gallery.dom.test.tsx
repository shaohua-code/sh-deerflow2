import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = rs.hoisted(() => ({
  refetch: rs.fn(),
  statusResult: null as unknown,
}));

rs.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workspace/capabilities",
  useRouter: () => ({ replace: rs.fn() }),
}));
rs.mock("next/dynamic", () => ({
  default: () =>
    function MockLarkPluginSettings({
      onBusyChange,
    }: {
      onBusyChange?: (busy: boolean) => void;
    }) {
      return (
        <button onClick={() => onBusyChange?.(true)}>
          Start Lark operation
        </button>
      );
    },
}));
rs.mock("@/core/integrations/lark", () => ({
  useLarkIntegrationStatus: () => mocks.statusResult,
}));
rs.mock("@/components/workspace/capabilities/mcp-plugin-manager", () => ({
  MCPPluginManager: ({
    children,
    toolbar,
  }: {
    children: ReactNode;
    toolbar: ReactNode;
  }) => (
    <div>
      {toolbar}
      {children}
    </div>
  ),
}));

import { PluginGallery } from "@/components/workspace/capabilities/plugin-gallery";
import { I18nProvider } from "@/core/i18n/context";

beforeEach(() => {
  mocks.statusResult = {
    data: undefined,
    error: new Error("Gateway unavailable"),
    isLoading: false,
    refetch: mocks.refetch,
  };
});

afterEach(() => {
  cleanup();
  document.cookie = "locale=; Max-Age=0; path=/";
  mocks.refetch.mockClear();
});

describe("PluginGallery integration status errors", () => {
  it.each([
    ["zh-CN", "暂时无法读取集成状态。", "重试"],
    ["en-US", "Integration status is temporarily unavailable.", "Retry"],
  ] as const)(
    "explains and retries a failed status read in %s",
    (locale, status, retry) => {
      // 模拟真实请求中的语言持久化 Cookie，避免复用其他测试留下的默认语言。
      document.cookie = `locale=${locale}; path=/`;
      render(
        <I18nProvider initialLocale={locale}>
          <PluginGallery query="" />
        </I18nProvider>,
      );

      expect(screen.getByText(status)).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: retry }));
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: /Install|安装/ })).toBeNull();
    },
  );

  it("keeps Lark settings open while a Gateway mutation is pending", () => {
    mocks.statusResult = {
      data: {
        installed: false,
        auth: { status: "not_authenticated", verified: false },
      },
      error: null,
      isLoading: false,
      refetch: mocks.refetch,
    };
    document.cookie = "locale=en-US; path=/";
    render(
      <I18nProvider initialLocale="en-US">
        <PluginGallery query="" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Start Lark operation" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
