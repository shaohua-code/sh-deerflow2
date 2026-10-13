import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { Welcome } from "@/components/workspace/welcome";
import { I18nProvider } from "@/core/i18n/context";

rs.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function renderWelcome(locale: "en-US" | "zh-CN") {
  // useI18n rehydrates from this same cookie used by the workspace.
  document.cookie = `locale=${locale}; path=/`;
  return render(
    <I18nProvider initialLocale={locale}>
      <Welcome />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  document.cookie = "locale=; Max-Age=0; path=/";
});

describe("Welcome workspace label", () => {
  it("uses the Chinese product label in the Chinese workspace", () => {
    renderWelcome("zh-CN");

    expect(screen.getByText("智能工作台")).toBeDefined();
  });

  it("preserves the English label in the English workspace", () => {
    renderWelcome("en-US");

    expect(screen.getByText("AI workspace")).toBeDefined();
  });
});
