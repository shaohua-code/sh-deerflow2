import { describe, expect, it } from "@rstest/core";

import {
  DEFAULT_LOCALE,
  detectLocale,
  getLocaleByLang,
  normalizeLocale,
} from "@/core/i18n/locale";

// 产品默认语言是中文（自有产品决策）：无 Cookie、空值和无法识别的 locale
// 一律回退 zh-CN；显式的 en-US / zh-CN 仍然按原样生效。
describe("product default locale", () => {
  it("keeps Chinese as the product default", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
  });

  it("falls back to Chinese for empty, unknown, and non-Chinese locales", () => {
    expect(normalizeLocale(undefined)).toBe("zh-CN");
    expect(normalizeLocale(null)).toBe("zh-CN");
    expect(normalizeLocale("")).toBe("zh-CN");
    expect(normalizeLocale("fr-FR")).toBe("zh-CN");
    expect(getLocaleByLang("de")).toBe("zh-CN");
    // node 环境没有 window，detectLocale 直接走默认值。
    expect(detectLocale()).toBe("zh-CN");
  });

  it("keeps explicit English and Chinese locales working", () => {
    expect(normalizeLocale("en-US")).toBe("en-US");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans")).toBe("zh-CN");
    expect(getLocaleByLang("en")).toBe("en-US");
    expect(getLocaleByLang("zh")).toBe("zh-CN");
  });
});
