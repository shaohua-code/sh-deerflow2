/**
 * 自有产品身份的单一配置入口。
 *
 * 这里是源码默认值和服务端首屏回退。登录、公开首页和认证工作台可以读取
 * 扩展公开的运行时名称；Next metadata 仍用这些默认值。sourceUrl 只用于开源声明。
 */
export const productBrand = {
  name: "Flow Desk",
  nameZh: "智能工作台",
  shortName: "Flow",
  description: "A calm workspace for research, analysis, and AI-assisted work.",
  descriptionZh: "让研究、分析与智能协作，在一个清晰的工作空间里完成。",
  sourceUrl: "https://github.com/bytedance/deer-flow",
} as const;

export function getBrandName(locale: string) {
  return locale === "zh-CN" ? productBrand.nameZh : productBrand.name;
}

export function getBrandDescription(locale: string) {
  return locale === "zh-CN"
    ? productBrand.descriptionZh
    : productBrand.description;
}
