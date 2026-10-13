"use client";

import { useEffect } from "react";

import { useI18n } from "@/core/i18n/hooks";

import { getBrandName } from "./brand";
import { useProductBrandName } from "./hooks";

/**
 * 让登录后的工作台标签页跟随管理员当前配置的产品名称。
 * 根 metadata 仍从 brand.ts 服务端渲染，负责首屏显示和未登录时的稳定回退。
 */
export function ProductDocumentTitle() {
  const { locale } = useI18n();
  const brandName = useProductBrandName(locale);

  useEffect(() => {
    document.title = brandName;

    return () => {
      // 离开工作台时恢复源码默认品牌；若目标路由已设置自己的标题，则不覆盖它。
      if (document.title === brandName) {
        document.title = getBrandName(locale);
      }
    };
  }, [brandName, locale]);

  return null;
}
