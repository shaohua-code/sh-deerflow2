"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import { normalizeLocale } from "@/core/i18n/locale";

import { fetchPublicProductBrand } from "./api";
import { getBrandName } from "./brand";

type PublicBrandNames = { name: string; name_zh: string };

const PublicBrandContext = createContext<PublicBrandNames | null>(null);
const PUBLIC_BRAND_UPDATED_EVENT = "flowdesk:public-brand-updated";

/**
 * 为公开首页、登录和初始化页提供运行时产品名。
 * 初始渲染始终使用源码品牌；Gateway/扩展不可用时不影响访问，也不重定向登录。
 */
export function PublicProductBrandProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [brand, setBrand] = useState<PublicBrandNames | null>(null);

  useEffect(() => {
    let mounted = true;
    let activeRequest: AbortController | null = null;

    const refresh = () => {
      activeRequest?.abort();
      activeRequest = new AbortController();
      void fetchPublicProductBrand(activeRequest.signal)
        .then((response) => {
          if (mounted) setBrand(response.product);
        })
        .catch(() => {
          // 公开品牌只是展示增强，保留源码默认值作为始终可用的回退。
        });
    };

    const onBrandUpdated = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const nextBrand = readBrandNames(detail);
      if (nextBrand) setBrand(nextBrand);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(PUBLIC_BRAND_UPDATED_EVENT, onBrandUpdated);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mounted = false;
      activeRequest?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener(PUBLIC_BRAND_UPDATED_EVENT, onBrandUpdated);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <PublicBrandContext.Provider value={brand}>
      {children}
    </PublicBrandContext.Provider>
  );
}

/**
 * 公开首页和认证入口优先使用运行时品牌名；Gateway 不可用时按当前语言
 * 回退到源码品牌，避免中文页面的标签标题仍显示英文。Next metadata 保持稳定回退。
 */
export function PublicProductBrandDocumentTitle() {
  const pathname = usePathname();
  const brand = useContext(PublicBrandContext);

  useEffect(() => {
    if (!isPublicBrandTitleRoute(pathname)) return;

    const updateTitle = () => {
      const locale = normalizeLocale(document.documentElement.lang);
      // 本地品牌回退让公开页在 Gateway 离线时仍与当前界面语言一致。
      const names = brand ?? {
        name: getBrandName("en-US"),
        name_zh: getBrandName("zh-CN"),
      };
      const nextTitle = locale === "zh-CN" ? names.name_zh : names.name;
      if (document.title !== nextTitle) document.title = nextTitle;
    };

    updateTitle();
    const languageObserver = new MutationObserver(updateTitle);
    languageObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
    // App Router 可能在客户端 effect 之后重新写入根 metadata；只观察 head，
    // 让产品标题在 metadata 改写时恢复，同时避免订阅整个页面的高频 DOM 更新。
    const metadataObserver = new MutationObserver(updateTitle);
    metadataObserver.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      languageObserver.disconnect();
      metadataObserver.disconnect();
    };
  }, [brand, pathname]);

  return null;
}

/**
 * 已登录管理员保存配置后同步公开页面品牌，避免 SPA 登出后暂时显示旧名称。
 * 事件仅更新当前标签页的展示状态，不负责持久化或授权。
 */
export function publishPublicProductBrandUpdate(brand: PublicBrandNames) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PUBLIC_BRAND_UPDATED_EVENT, { detail: brand }),
  );
}

export function usePublicProductBrandName(locale: string) {
  const brand = useContext(PublicBrandContext);
  if (!brand) return getBrandName(locale);
  return locale === "zh-CN" ? brand.name_zh : brand.name;
}

export function PublicProductBrandName({
  locale,
  className,
}: {
  locale: string;
  className?: string;
}) {
  const name = usePublicProductBrandName(locale);
  return (
    <span className={className} title={name}>
      {name}
    </span>
  );
}

function readBrandNames(value: unknown): PublicBrandNames | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== "string" ||
    typeof record.name_zh !== "string" ||
    !record.name.trim() ||
    !record.name_zh.trim() ||
    record.name.length > 80 ||
    record.name_zh.length > 80
  ) {
    return null;
  }
  return { name: record.name, name_zh: record.name_zh };
}

function isPublicBrandTitleRoute(pathname: string | null) {
  return pathname === "/" || pathname === "/login" || pathname === "/setup";
}
