"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/AuthProvider";
import { isStaticWebsiteOnly } from "@/core/static-mode";

import {
  fetchProductBootstrap,
  fetchProductDataCapabilities,
  type ProductFeatureKey,
} from "./api";
import { getBrandName } from "./brand";
import { isProductFeatureEnabled } from "./features";

export const PRODUCT_DATA_CAPABILITIES_QUERY_KEY = [
  "product",
  "data-capabilities",
] as const;

/**
 * 能力也按已认证账号分区，不能在身份切换后复用上一用户的成功快照。
 * 静态演示和未登录页面不发请求；失败或刷新中由页面阻止新的删除意图。
 */
export function useProductDataCapabilities() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = userId !== null && !isStaticWebsiteOnly();
  const query = useQuery({
    queryKey: [...PRODUCT_DATA_CAPABILITIES_QUERY_KEY, userId],
    queryFn: ({ signal }) => fetchProductDataCapabilities(signal),
    enabled,
    retry: false,
  });
  return { ...query, capabilitiesEnabled: enabled };
}

/**
 * 同一个 Query key 让页头与工作台共享一次 bootstrap 请求。
 * 扩展尚未安装或请求失败时保留编译期默认体验，不能把功能显隐当成授权。
 */
export function useProductBootstrap() {
  return useQuery({
    queryKey: ["product", "bootstrap"],
    // 响应身份用于校验产品 API 的可信来源，但只缓存展示配置，避免把上一账号
    // 的用户标识留在共享 QueryClient 中。
    queryFn: async ({ signal }) =>
      (await fetchProductBootstrap(signal)).product,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * 仅在服务端配置成功时覆盖品牌名；本地化默认值确保 API 暂不可用时
 * 工作台仍然可用。登录身份不从这个显示配置推断。
 */
export function useProductBrandName(locale: string) {
  const { data } = useProductBootstrap();
  if (!data) return getBrandName(locale);
  return locale === "zh-CN" ? data.name_zh : data.name;
}

/**
 * UI 开关是展示提示，不是安全边界。传入 key 与产品 API 的 snake_case
 * 字段一致；组件隐藏入口后，Gateway 仍必须独立拒绝越权 API 请求。
 */
export function useProductFeature(feature: ProductFeatureKey) {
  const { data } = useProductBootstrap();
  return isProductFeatureEnabled(data?.features, feature);
}
