// 在首屏 hydration 前应用用户主题，避免页面先闪现系统默认颜色。
(() => {
  const root = document.documentElement;
  let theme = "system";
  try {
    const storedTheme = localStorage.getItem("theme");
    if (storedTheme === "light" || storedTheme === "dark") theme = storedTheme;
  } catch {
    // 浏览器隐私策略可能禁用 localStorage，此时回退到系统主题。
  }

  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const forcedTheme = window.location.pathname === "/" ? "dark" : undefined;
  const resolvedTheme =
    forcedTheme || (theme === "system" ? systemTheme : theme);

  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;
})();
