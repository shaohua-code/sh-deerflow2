"use client";

import { Languages } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { setLocaleInCookie } from "@/core/i18n/cookies";
import type { Locale } from "@/core/i18n/locale";
import { getProductCopy } from "@/product/copy";

/**
 * 公开页面和认证页共用的语言切换入口。
 * 中文说明：没有客户端翻译上下文的服务端页面写入 locale Cookie 后刷新，
 * 认证页则传入回调，直接更新现有 I18nProvider，避免重载表单状态。
 */
export function LocaleSwitcher({
  locale,
  onLocaleChange,
  className,
}: {
  locale: Locale;
  onLocaleChange?: (locale: Locale) => void;
  className?: string;
}) {
  // 公开页不会包在 workspace 的 I18nProvider 中，因此此入口同步文档语言属性。
  // Next 根布局水合时可能重新写入默认 lang；观察该属性并恢复当前页面语言，
  // 让屏幕阅读器、浏览器标题和当前文案保持一致。
  useEffect(() => {
    const syncDocumentLanguage = () => {
      if (document.documentElement.lang !== locale) {
        document.documentElement.lang = locale;
      }
    };

    syncDocumentLanguage();
    const observer = new MutationObserver(syncDocumentLanguage);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });

    return () => observer.disconnect();
  }, [locale]);

  const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
  const copy = getProductCopy(locale);
  const label =
    nextLocale === "zh-CN" ? copy.switchToChinese : copy.switchToEnglish;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      aria-label={label}
      title={label}
      onClick={() => {
        if (onLocaleChange) {
          onLocaleChange(nextLocale);
          return;
        }

        setLocaleInCookie(nextLocale);
        window.location.reload();
      }}
    >
      <Languages aria-hidden="true" className="size-4" />
      <span>{nextLocale === "zh-CN" ? "中文" : "EN"}</span>
    </Button>
  );
}
