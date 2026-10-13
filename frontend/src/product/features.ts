import type { ProductFeatureKey } from "./api";

/**
 * 前端产品页的默认开关集中在这里，便于按产品版本调整导航和入口。
 *
 * 这些值只控制“是否展示 UI”，不能替代 Gateway 的认证、授权或服务端校验。
 * 即使把一项设为 false，后端也必须继续验证每个 API 请求的身份和资源归属。
 */
export const productFeatures = {
  overview: true,
  chats: true,
  agents: true,
  scheduledTasks: true,
  capabilities: true,
  files: false,
  dataPrivacy: false,
  administration: false,
} as const;

export type ProductFeature = keyof typeof productFeatures;

/**
 * API 使用 snake_case，界面代码可以继续保留现有 camelCase 默认值。
 * 该函数只决定是否呈现入口；路由和 Gateway API 仍须各自验证访问权限。
 */
const productFeatureDefaults: Record<ProductFeatureKey, boolean> = {
  overview: productFeatures.overview,
  chats: productFeatures.chats,
  agents: productFeatures.agents,
  scheduled_tasks: productFeatures.scheduledTasks,
  capabilities: productFeatures.capabilities,
  files: productFeatures.files,
  data_privacy: productFeatures.dataPrivacy,
  administration: productFeatures.administration,
};

export function isProductFeatureEnabled(
  features: Partial<Record<ProductFeatureKey, boolean>> | undefined,
  feature: ProductFeatureKey,
) {
  return features?.[feature] ?? productFeatureDefaults[feature];
}
