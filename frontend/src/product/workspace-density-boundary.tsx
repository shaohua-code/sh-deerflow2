"use client";

import type { ReactNode } from "react";

import { useProductSettings } from "@/product/settings-hooks";

/**
 * 把已登录用户的密度偏好作用到整个 `/workspace` 路由树。
 *
 * `display: contents` 只提供 CSS 选择器边界，不额外创建布局盒子；这样主聊天、
 * Agent 详情等没有使用 WorkspaceContainer 的页面，也能和总览页采用相同密度。
 */
export function WorkspaceDensityBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const settings = useProductSettings();
  const savedDensity = settings.data?.settings.find(
    (setting) => setting.key === "workspace.display",
  )?.value;
  // 未设置、服务不可用或新版本保存了未知值时均安全退回默认布局。
  const density = savedDensity === "compact" ? "compact" : "comfortable";

  return (
    <div className="contents" data-workspace-density={density}>
      {children}
    </div>
  );
}
