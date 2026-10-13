import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

rs.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workspace/capabilities",
  useRouter: () => ({ replace: rs.fn() }),
}));
rs.mock("next/dynamic", () => ({
  default: (_loader: unknown, options?: { loading?: () => ReactNode }) => {
    const Loading = options?.loading;
    return function MockDynamicCapability() {
      return Loading ? <Loading /> : null;
    };
  },
}));
rs.mock("@/product/workspace-sidebar-trigger", () => ({
  WorkspaceSidebarTrigger: () => <button>Open sidebar</button>,
}));

import {
  CapabilityCenter,
  CapabilityCenterLoading,
} from "@/components/workspace/capabilities/capability-center";
import { I18nProvider } from "@/core/i18n/context";

function renderWithLocale(node: ReactNode, locale: "en-US" | "zh-CN") {
  document.cookie = `locale=${locale}; path=/`;
  return render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
}

afterEach(() => {
  cleanup();
  document.cookie = "locale=; Max-Age=0; path=/";
});

describe("CapabilityCenter loading states", () => {
  it("shows a localized gallery placeholder while a dynamic tab loads", () => {
    renderWithLocale(<CapabilityCenter />, "zh-CN");

    const status = screen.getByRole("status", { name: "加载中..." });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(9);
  });

  it("keeps the page shell visible while search params suspend", () => {
    renderWithLocale(<CapabilityCenterLoading />, "en-US");

    expect(screen.getByRole("status", { name: "Loading..." })).toBeDefined();
    expect(screen.getByText("Capability Center")).toBeDefined();
    expect(screen.getByRole("button", { name: "Open sidebar" })).toBeDefined();
  });
});
