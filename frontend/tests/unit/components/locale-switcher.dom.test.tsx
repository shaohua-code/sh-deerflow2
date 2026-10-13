import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { LocaleSwitcher } from "@/components/locale-switcher";

afterEach(cleanup);

describe("LocaleSwitcher", () => {
  it("offers the other supported language with a localized accessible name", () => {
    const onLocaleChange = rs.fn();
    render(<LocaleSwitcher locale="zh-CN" onLocaleChange={onLocaleChange} />);

    fireEvent.click(screen.getByRole("button", { name: "切换为英文" }));

    expect(onLocaleChange).toHaveBeenCalledWith("en-US");
  });

  it("labels the Chinese option for English users", () => {
    render(<LocaleSwitcher locale="en-US" onLocaleChange={() => undefined} />);

    expect(
      screen.getByRole("button", { name: "Switch language to Chinese" }),
    ).toBeDefined();
  });

  it("sets the document language for server-rendered public pages", () => {
    render(<LocaleSwitcher locale="zh-CN" onLocaleChange={() => undefined} />);

    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("restores the active language if the root layout rewrites the lang attribute", async () => {
    render(<LocaleSwitcher locale="zh-CN" onLocaleChange={() => undefined} />);

    act(() => {
      document.documentElement.lang = "en-US";
    });

    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));
  });
});
