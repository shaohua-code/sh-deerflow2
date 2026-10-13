"use client";

import { type ComponentProps } from "react";

import {
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

/**
 * 工作台的侧栏入口统一经过产品接入层，避免上游基础组件的英文兜底标签
 * 泄漏到中文界面。桌面读取收起状态，移动端读取抽屉自己的开合状态。
 */
function useWorkspaceSidebarToggleLabel() {
  const { t } = useI18n();
  const { state, isMobile, openMobile } = useSidebar();
  const isOpen = isMobile ? openMobile : state === "expanded";
  return isOpen ? t.sidebar.collapseSidebar : t.sidebar.expandSidebar;
}

export function WorkspaceSidebarTrigger(
  props: ComponentProps<typeof SidebarTrigger>,
) {
  const label = useWorkspaceSidebarToggleLabel();

  return <SidebarTrigger {...props} aria-label={label} title={label} />;
}

/** 生成的拖拽轨道也带按钮语义，因此需要复用触发器的本地化标签。 */
export function WorkspaceSidebarRail(
  props: ComponentProps<typeof SidebarRail>,
) {
  const label = useWorkspaceSidebarToggleLabel();

  return <SidebarRail {...props} aria-label={label} title={label} />;
}
