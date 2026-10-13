import { afterEach, describe, expect, rs, test } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { BrowserViewPanel } from "@/components/workspace/browser-view/browser-view-panel";
import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";

const browserState = rs.hoisted(() => ({
  navigate: rs.fn(),
  onNavRejected: null as
    | ((url: string | undefined, message: string | undefined) => void)
    | null,
  toastError: rs.fn(),
  toastWarning: rs.fn(),
}));

rs.mock("@/components/workspace/browser-view/api", () => ({
  navigateBrowser: browserState.navigate,
  browserStreamURL: () => "ws://example.test/thread-1",
}));
rs.mock("@/components/workspace/browser-view/use-browser-stream", () => ({
  useBrowserStream: (
    _threadId: string,
    _enabled: boolean,
    _seedUrl: string | undefined,
    onNavRejected:
      | ((url: string | undefined, message: string | undefined) => void)
      | undefined,
  ) => {
    browserState.onNavRejected = onNavRejected ?? null;
    return {
      status: "idle",
      frameUrl: null,
      liveUrl: null,
      sendInput: rs.fn(),
    };
  },
}));
rs.mock("sonner", () => ({
  toast: {
    error: browserState.toastError,
    warning: browserState.toastWarning,
  },
}));

function renderPanel(locale: "en-US" | "zh-CN") {
  return render(
    <I18nContext.Provider
      value={{
        locale,
        setLocale: () => undefined,
        t: locale === "zh-CN" ? zhCN : enUS,
      }}
    >
      <BrowserViewPanel threadId="thread-1" />
    </I18nContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  browserState.navigate.mockReset();
  browserState.onNavRejected = null;
  browserState.toastError.mockReset();
  browserState.toastWarning.mockReset();
  rs.restoreAllMocks();
});

describe("BrowserViewPanel localization and accessibility", () => {
  test("renders Chinese browser controls and empty state", () => {
    renderPanel("zh-CN");

    expect(
      screen
        .getByRole("textbox", { name: "浏览器网址" })
        .getAttribute("placeholder"),
    ).toBe("输入网址并按回车");
    expect(screen.getByRole("button", { name: "后退" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "前进" })).toBeTruthy();
    expect(screen.getByText("正在连接实时浏览器…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "停止实时控制" }));
    expect(screen.getByRole("button", { name: "接管实时浏览器" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭浏览器面板" })).toBeTruthy();
  });

  test("renders English browser controls and empty state", () => {
    renderPanel("en-US");

    expect(
      screen
        .getByRole("textbox", { name: "Browser URL" })
        .getAttribute("placeholder"),
    ).toBe("Enter a URL and press Enter");
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Forward" })).toBeTruthy();
    expect(screen.getByText("Connecting to live browser…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop live control" }));
    expect(
      screen.getByRole("button", { name: "Take live control" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close browser panel" }),
    ).toBeTruthy();
  });

  test("does not show Gateway details when direct navigation fails", async () => {
    browserState.navigate.mockRejectedValue(new Error("private gateway path"));
    renderPanel("en-US");

    fireEvent.click(screen.getByRole("button", { name: "Stop live control" }));
    const input = screen.getByRole("textbox", { name: "Browser URL" });
    fireEvent.change(input, { target: { value: "https://example.test" } });
    const form = input.closest("form");
    if (!form) throw new Error("browser URL form not rendered");
    fireEvent.submit(form);

    await waitFor(() =>
      expect(browserState.toastError).toHaveBeenCalledWith(
        "Cannot open https://example.test",
      ),
    );
    expect(browserState.toastError).not.toHaveBeenCalledWith(
      "private gateway path",
    );
  });

  test("maps live navigation rejection details to localized copy", () => {
    renderPanel("zh-CN");

    browserState.onNavRejected?.(
      "https://example.test",
      "private gateway path",
    );

    expect(browserState.toastError).toHaveBeenCalledWith(
      "无法打开 https://example.test",
    );
    expect(browserState.toastError).not.toHaveBeenCalledWith(
      "private gateway path",
    );
  });
});
