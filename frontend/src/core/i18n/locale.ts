export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
// 产品默认语言（自有决策）：无 locale Cookie 的服务端渲染、无法识别的
// 浏览器语言和空值一律回退中文；英文需要显式写入 locale Cookie。
// 固定回归见 tests/unit/core/i18n/locale.test.ts，修改默认值时同步该测试。
export const DEFAULT_LOCALE: Locale = "zh-CN";

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocaleByLang(lang: string): Locale {
  const normalizedLang = lang.toLowerCase();
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.startsWith(normalizedLang)) {
      return locale;
    }
  }
  return DEFAULT_LOCALE;
}

export function getLangByLocale(locale: Locale): string {
  const parts = locale.split("-");
  if (parts.length > 0 && typeof parts[0] === "string") {
    return parts[0];
  }
  return locale;
}

export function normalizeLocale(locale: string | null | undefined): Locale {
  if (!locale) {
    return DEFAULT_LOCALE;
  }

  if (isLocale(locale)) {
    return locale;
  }

  if (locale.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }

  return DEFAULT_LOCALE;
}

// Helper function to detect browser locale
export function detectLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }

  const browserLang =
    navigator.language ||
    (navigator as unknown as { userLanguage: string }).userLanguage;

  return normalizeLocale(browserLang);
}
