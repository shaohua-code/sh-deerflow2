import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AuthShell } from "@/components/auth/auth-shell";
import { clientTranslations } from "@/core/i18n/client-translations";
import { I18nContext } from "@/core/i18n/context";
import type { Locale } from "@/core/i18n/locale";

afterEach(cleanup);

function renderShell(
  locale: Locale,
  formLabel: string,
  setLocale: (locale: Locale) => void = () => undefined,
) {
  return render(
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t: clientTranslations[locale],
      }}
    >
      <AuthShell>
        <form aria-label={formLabel} />
      </AuthShell>
    </I18nContext.Provider>,
  );
}

describe("AuthShell", () => {
  it("renders the localized product story and keeps the page content inside the shell", () => {
    renderShell("zh-CN", "登录表单");

    expect(
      screen.getByRole("heading", { level: 2, name: /让复杂工作/ }),
    ).toBeDefined();
    expect(screen.getByText("自主部署，掌控运行环境")).toBeDefined();
    expect(screen.getByRole("form", { name: "登录表单" })).toBeDefined();
  });

  it("provides a complete English label set for the same layout", () => {
    renderShell("en-US", "Sign-in form");

    expect(
      screen.getByRole("heading", { level: 2, name: /Move complex work/ }),
    ).toBeDefined();
    expect(screen.getByText("Deploy in your own environment")).toBeDefined();
    expect(screen.getByRole("form", { name: "Sign-in form" })).toBeDefined();
  });

  it("switches the shared authentication shell through its locale provider", () => {
    const setLocale = rs.fn();
    renderShell("zh-CN", "登录表单", setLocale);

    fireEvent.click(screen.getByRole("button", { name: "切换为英文" }));

    expect(setLocale).toHaveBeenCalledWith("en-US");
  });
});
