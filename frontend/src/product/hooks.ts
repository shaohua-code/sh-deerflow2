"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/AuthProvider";
import { isStaticWebsiteOnly } from "@/core/static-mode";

import {
  fetchProductBootstrap,
  fetchProductDataCapabilities,
  fetchIamResources,
  type IamResourcesResponse,
  type ProductFeatureKey,
} from "./api";
import { getBrandName } from "./brand";
import { isProductFeatureEnabled } from "./features";
import {
  type IamButtonCode,
  type IamResourceControl,
  type IamResourceControlState,
  isIamButtonGranted,
} from "./iam-resources";

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

export const IAM_RESOURCES_QUERY_KEY = ["iam", "resources"] as const;

/** 把接口响应折叠为「已授权码表」；未受控（controlled=false）统一折叠为 null。 */
function selectIamResourceControl(
  data: IamResourcesResponse,
): IamResourceControl | null {
  return data.controlled ? { menus: data.menus, buttons: data.buttons } : null;
}

/**
 * IAM 资源管控的唯一数据源（菜单 + 按钮），返回三态见 IamResourceControlState。
 * 按账号分区缓存，身份切换后不复用上一用户的授权结果。
 */
export function useIamResourceControl(): IamResourceControlState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = userId !== null && !isStaticWebsiteOnly();
  const query = useQuery({
    queryKey: [...IAM_RESOURCES_QUERY_KEY, userId],
    queryFn: ({ signal }) => fetchIamResources(signal),
    enabled,
    retry: false,
    staleTime: 60 * 1000,
    select: selectIamResourceControl,
  });
  // 未登录，或从未成功且请求出错：按未受控降级（全量显示），下次刷新自动恢复管控。
  // 已有成功快照时沿用它——后台刷新失败不能放宽权限。
  if (!enabled || (query.isError && query.data === undefined)) return null;
  return query.data;
}

/** 单个按钮是否可用（IAM 按钮码显隐），三态口径同 useIamResourceControl。 */
export function useIamButton(code: IamButtonCode): boolean {
  return isIamButtonGranted(useIamResourceControl(), code);
}
