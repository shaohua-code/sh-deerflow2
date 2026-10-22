"use client";

import { useSyncExternalStore, type ComponentProps } from "react";

import {
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

// 水合标记无外部 store，无需真实订阅；与 command-palette 的 subscribeNoop 一致。
function subscribeHydrationNoop() {
  return () => undefined;
}

/** 水合完成前返回 false，避免窄屏下 isMobile 与 SSR 快照不一致。 */
function useClientHydrated() {
  return useSyncExternalStore(
    subscribeHydrationNoop,
    () => true,
    () => false,
  );
}

/**
 * 工作台的侧栏入口统一经过产品接入层，避免上游基础组件的英文兜底标签
 * 泄漏到中文界面。桌面读取收起状态，移动端读取抽屉自己的开合状态。
 */
function useWorkspaceSidebarToggleLabel() {
  const { t } = useI18n();
  const { state, isMobile, openMobile } = useSidebar();
  const hydrated = useClientHydrated();
  // SSR/水合首帧只按桌面侧栏 state 算文案，与 useIsMobile 的 server snapshot 对齐
  if (!hydrated) {
    const isOpenDesktop = state === "expanded";
    return isOpenDesktop
      ? t.sidebar.collapseSidebar
      : t.sidebar.expandSidebar;
  }
  const isOpen = isMobile ? openMobile : state === "expanded";
  return isOpen ? t.sidebar.collapseSidebar : t.sidebar.expandSidebar;
}

export function WorkspaceSidebarTrigger(
  props: ComponentProps<typeof SidebarTrigger>,
) {
  const label = useWorkspaceSidebarToggleLabel();

  return (
    <SidebarTrigger
      {...props}
      aria-label={label}
      title={label}
      suppressHydrationWarning
    />
  );
}

/** 生成的拖拽轨道也带按钮语义，因此需要复用触发器的本地化标签。 */
export function WorkspaceSidebarRail(
  props: ComponentProps<typeof SidebarRail>,
) {
  const label = useWorkspaceSidebarToggleLabel();

  return (
    <SidebarRail
      {...props}
      aria-label={label}
      title={label}
      suppressHydrationWarning
    />
  );
}
