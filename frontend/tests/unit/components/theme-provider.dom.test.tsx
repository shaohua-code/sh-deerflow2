import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({ pathname: "/workspace" }));

rs.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

import { ThemeProvider, useTheme } from "@/components/theme-provider";

function ThemeProbe() {
  const { theme, setTheme, resolvedTheme, systemTheme } = useTheme();

  return (
    <div>
      <span data-testid="theme-values">
        {`${theme}|${resolvedTheme ?? "pending"}|${systemTheme ?? "pending"}`}
      </span>
      <button type="button" onClick={() => setTheme("dark")}>
        使用深色
      </button>
    </div>
  );
}

let systemThemeMatches = false;
let systemThemeListener: (() => void) | undefined;

beforeEach(() => {
  mocks.pathname = "/workspace";
  systemThemeMatches = false;
  systemThemeListener = undefined;
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return systemThemeMatches;
      },
      addEventListener: (_type: string, listener: () => void) => {
        systemThemeListener = listener;
      },
      removeEventListener: () => {
        systemThemeListener = undefined;
      },
    }),
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("product theme provider", () => {
  it("tracks system theme changes without rendering a client script", async () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme-values").textContent).toBe(
        "system|light|light",
      );
    });
    expect(container.querySelector("script")).toBeNull();

    systemThemeMatches = true;
    systemThemeListener?.();

    await waitFor(() => {
      expect(screen.getByTestId("theme-values").textContent).toBe(
        "system|dark|dark",
      );
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  it("keeps the saved preference while forcing the public homepage dark", async () => {
    mocks.pathname = "/";
    window.localStorage.setItem("theme", "light");

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme-values").textContent).toBe(
        "light|dark|light",
      );
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "使用深色" }));
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
