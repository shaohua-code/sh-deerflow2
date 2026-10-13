"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  systemTheme?: ResolvedTheme;
  resolvedTheme?: ResolvedTheme;
};

const THEME_STORAGE_KEY = "theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Owns the product's browser theme preference without rendering a script from
 * a Client Component. The early bootstrap lives in the Server Component root
 * layout so the first paint already has the right `dark` class.
 */
export function ThemeProvider({
  children,
  disableTransitionOnChange = false,
}: {
  children: ReactNode;
  disableTransitionOnChange?: boolean;
}) {
  const pathname = usePathname();
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>();
  const forcedTheme = pathname === "/" ? "dark" : undefined;

  useEffect(() => {
    // Keep the server and first client render identical. Browser-only preference
    // reads happen after hydration; the layout bootstrap prevents a flash.
    setThemeState(readStoredTheme());

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };
    const updateStoredTheme = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        setThemeState(readStoredTheme());
      }
    };

    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);
    window.addEventListener("storage", updateStoredTheme);
    return () => {
      mediaQuery.removeEventListener("change", updateSystemTheme);
      window.removeEventListener("storage", updateStoredTheme);
    };
  }, []);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The current tab still follows the selection when storage is unavailable.
    }
  }, []);

  const resolvedTheme =
    forcedTheme ?? (theme === "system" ? systemTheme : theme);

  useEffect(() => {
    if (!resolvedTheme) return;

    const root = document.documentElement;
    const previousTheme: ResolvedTheme = root.classList.contains("dark")
      ? "dark"
      : "light";
    let transitionStyle: HTMLStyleElement | undefined;

    if (disableTransitionOnChange && previousTheme !== resolvedTheme) {
      transitionStyle = document.createElement("style");
      transitionStyle.textContent =
        "*, *::before, *::after { transition: none !important; }";
      document.head.appendChild(transitionStyle);
    }

    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;

    if (transitionStyle) {
      const removeTransitionStyle = () => transitionStyle?.remove();
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(removeTransitionStyle),
        );
      } else {
        window.setTimeout(removeTransitionStyle, 0);
      }
    }
  }, [disableTransitionOnChange, resolvedTheme]);

  const context = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, systemTheme, resolvedTheme }),
    [resolvedTheme, setTheme, systemTheme, theme],
  );

  return (
    <ThemeContext.Provider value={context}>{children}</ThemeContext.Provider>
  );
}

/** Return the selected theme and its currently resolved light/dark value. */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside the product ThemeProvider");
  }
  return context;
}

function readStoredTheme(): Theme {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  } catch {
    // Private browsing or browser policy can make localStorage unavailable.
  }
  return "system";
}
