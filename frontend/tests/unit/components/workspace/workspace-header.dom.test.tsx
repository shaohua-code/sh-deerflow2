import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = rs.hoisted(() => ({ pathname: "/workspace" }));

rs.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
rs.mock("@/product/hooks", () => ({
  useProductBrandName: () => "Flow Desk",
  useProductFeature: () => true,
}));

import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceHeader as WorkspacePageHeader } from "@/components/workspace/workspace-container";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { I18nProvider } from "@/core/i18n/context";
import { WorkspaceSidebarRail } from "@/product/workspace-sidebar-trigger";

const originalMatchMedia = window.matchMedia;

function setMobileViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) =>
      ({
        matches: query === "(max-width: 767px)",
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

function renderHeader(locale: "zh-CN" | "en-US", defaultOpen: boolean) {
  // 页面会从持久化 Cookie 恢复语言；测试也要模拟真实的首次渲染状态。
  document.cookie = `locale=${locale}; path=/`;
  return render(
    <I18nProvider initialLocale={locale}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <WorkspaceHeader />
      </SidebarProvider>
    </I18nProvider>,
  );
}

function renderPageHeader(locale: "zh-CN" | "en-US", defaultOpen: boolean) {
  document.cookie = `locale=${locale}; path=/`;
  return render(
    <I18nProvider initialLocale={locale}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <WorkspacePageHeader />
        <WorkspaceSidebarRail />
      </SidebarProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.pathname = "/workspace";
  document.cookie = "locale=; Max-Age=0; path=/";
  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
  rs.clearAllMocks();
});

describe("WorkspaceHeader sidebar toggle", () => {
  it("localizes the project breadcrumb", () => {
    mocks.pathname = "/workspace/projects/project-1";
    renderPageHeader("zh-CN", true);

    expect(screen.getByRole("link", { name: "项目" })).toBeDefined();
  });

  it("localizes the collapsed sidebar label in Chinese", () => {
    renderHeader("zh-CN", false);

    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeDefined();
  });

  it("announces the expanded sidebar state in English", () => {
    renderHeader("en-US", true);

    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeDefined();
  });

  it("localizes the page-header trigger and the generated sidebar rail", () => {
    renderPageHeader("zh-CN", true);

    expect(screen.getAllByRole("button", { name: "收起侧边栏" })).toHaveLength(
      2,
    );
  });

  it("uses the mobile drawer state to name open and close actions", () => {
    setMobileViewport();
    renderPageHeader("zh-CN", true);

    const expandButtons = screen.getAllByRole("button", {
      name: "展开侧边栏",
    });
    expect(expandButtons).toHaveLength(2);
    const [expandButton] = expandButtons;
    if (!expandButton) {
      throw new Error("The workspace should expose its mobile sidebar button.");
    }
    fireEvent.click(expandButton);
    expect(screen.getAllByRole("button", { name: "收起侧边栏" })).toHaveLength(
      2,
    );
  });
});
