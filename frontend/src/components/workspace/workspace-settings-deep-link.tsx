"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  openSettingsDialog,
  type SettingsSection,
  useSettingsDialog,
} from "./settings";

// URL 参数属于外部输入，只允许跳转到已注册的设置分区；新增设置分区时
// 需要同步更新这里和 settings-dialog 的 SettingsSection 联合类型。
const SETTINGS_SECTIONS = new Set<SettingsSection>([
  "account",
  "appearance",
  "channels",
  "memory",
  "subagents",
  "notification",
  "about",
]);

function asSettingsSection(value: string | null): SettingsSection | null {
  if (!value) return null;
  // 不把任意 query 值传入设置状态，避免无效链接打开空白或错误分区。
  return SETTINGS_SECTIONS.has(value as SettingsSection)
    ? (value as SettingsSection)
    : null;
}

/**
 * 把 `?settings=<section>` 深链接同步到共享设置弹窗状态。
 * 组件本身不创建弹窗：全局 `SettingsDialogHost` 只负责渲染一个实例，
 * 因此 URL、侧栏菜单和命令面板不会各自打开互相竞争的弹窗。
 */
export function WorkspaceSettingsDeepLink() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { open } = useSettingsDialog();
  const openedFromDeepLinkRef = useRef(false);
  const deepLinkDialogWasOpenRef = useRef(false);

  useEffect(() => {
    const nextSection = asSettingsSection(searchParams.get("settings"));
    if (nextSection) {
      // 先记录来源，再打开弹窗；关闭弹窗后第二个 effect 会清理 URL 参数。
      openedFromDeepLinkRef.current = true;
      openSettingsDialog(nextSection);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!openedFromDeepLinkRef.current) {
      return;
    }
    // 首次打开时两个 effect 会看到同一轮的旧状态；必须确认共享弹窗
    // 至少渲染过一次打开态，才把后续关闭解释为用户主动关闭。
    if (open) {
      deepLinkDialogWasOpenRef.current = true;
      return;
    }
    if (!deepLinkDialogWasOpenRef.current) {
      return;
    }

    openedFromDeepLinkRef.current = false;
    deepLinkDialogWasOpenRef.current = false;
    if (searchParams.has("settings")) {
      // 只移除本组件管理的参数，保留其他 query，并且不把页面滚动回顶部。
      const next = new URLSearchParams(searchParams);
      next.delete("settings");
      const suffix = next.toString();
      router.replace(suffix ? `${pathname}?${suffix}` : pathname, {
        scroll: false,
      });
    }
  }, [open, pathname, router, searchParams]);

  return null;
}
