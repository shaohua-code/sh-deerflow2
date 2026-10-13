import type { Locale } from "@/core/i18n/locale";
import { productBrand } from "@/product/brand";
import { APP_VERSION } from "@/version";

/**
 * 关于页的产品说明使用双语模板，避免中文工作台显示英文产品文案。
 * 两种语言都保留 DeerFlow 来源链接和 MIT 许可说明。
 */
export function getAboutMarkdown(locale: Locale) {
  if (locale === "zh-CN") {
    return `# 关于 ${productBrand.nameZh} ${APP_VERSION}

${productBrand.descriptionZh}

## 开源基础

本产品基于 [DeerFlow](${productBrand.sourceUrl}) 构建，并遵循 MIT 许可证分发。源码发行包保留上游版权声明和许可证文件。

## 产品支持

账号、部署或产品使用问题，请联系当前实例的管理员。
`;
  }

  return `# About ${productBrand.name} ${APP_VERSION}

${productBrand.description}

## Open-source foundation

This product is based on [DeerFlow](${productBrand.sourceUrl}) and is distributed under the MIT License. The upstream copyright and license notices are retained in the source distribution.

## Product support

For account, deployment, or product questions, contact the administrator of this installation.
`;
}
