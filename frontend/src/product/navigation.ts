import {
  BlocksIcon,
  BotIcon,
  CalendarClock,
  FilesIcon,
  LayoutDashboard,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

import {
  getPermissionState,
  PERMISSIONS,
  type RoutePermission,
} from "@/core/auth/permissions";
import type { User } from "@/core/auth/types";

import type { ProductFeatureKey } from "./api";
import { isProductFeatureEnabled } from "./features";

/** 产品导航使用稳定 ID 做本地化映射，不把展示文字或路由散落在工作台组件里。 */
export type ProductNavigationId =
  | "overview"
  | "chats"
  | "agents"
  | "scheduledTasks"
  | "files"
  | "capabilities";

type ProductNavigationItem = {
  id: ProductNavigationId;
  href: string;
  feature: ProductFeatureKey;
  icon: LucideIcon;
  /** 当前页面精确匹配或匹配该功能下的详情路由。 */
  activeMatch: "exact" | "section";
  /** 智能体页还要检查 Gateway 能力；不可用时保留入口并解释原因。 */
  gatewayCapability?: "agents";
  /** 页面入口的一组 Gateway 权限，组内全部满足时即可显示。 */
  permissions?: readonly RoutePermission[];
  /** 任一权限组完整满足即可显示，例如仅可创建的用户也能进入任务页。 */
  permissionAlternatives?: readonly (readonly RoutePermission[])[];
};

/**
 * Flow Desk 自有导航目录。
 *
 * 如果 DeerFlow 调整工作台侧栏结构，应优先复核这份目录和产品 renderer，
 * 而不是把品牌路由继续写进上游导航组件；feature 仅控制展示，授权仍由 Gateway 校验。
 */
export const productNavigation: readonly ProductNavigationItem[] = [
  {
    id: "overview",
    href: "/workspace",
    feature: "overview",
    icon: LayoutDashboard,
    activeMatch: "exact",
  },
  {
    id: "chats",
    href: "/workspace/chats",
    feature: "chats",
    icon: MessagesSquare,
    activeMatch: "exact",
    permissions: [PERMISSIONS.THREADS_READ],
  },
  {
    id: "agents",
    href: "/workspace/agents",
    feature: "agents",
    icon: BotIcon,
    activeMatch: "section",
    gatewayCapability: "agents",
    permissions: [PERMISSIONS.AGENTS_READ],
  },
  {
    id: "scheduledTasks",
    href: "/workspace/scheduled-tasks",
    feature: "scheduled_tasks",
    icon: CalendarClock,
    activeMatch: "section",
    permissions: [PERMISSIONS.THREADS_READ],
    permissionAlternatives: [
      [PERMISSIONS.THREADS_WRITE, PERMISSIONS.RUNS_CREATE],
    ],
  },
  {
    id: "files",
    href: "/workspace/files",
    feature: "files",
    icon: FilesIcon,
    activeMatch: "section",
    permissions: [PERMISSIONS.THREADS_READ, PERMISSIONS.PROJECTS_READ],
  },
  {
    id: "capabilities",
    href: "/workspace/capabilities",
    feature: "capabilities",
    icon: BlocksIcon,
    activeMatch: "section",
  },
];

/**
 * 依产品展示开关和已核实的路由权限筛选导航，再计算当前路由状态。
 * 会话列表由 threads:read 保护；定时任务支持读取，或 threads:write + runs:create 的创建组合；Agent 列表由 agents:read 保护，文件中心需要 threads:read 和 projects:read；
 * 权限未解析时兼容显示。Agent 功能能力仍由 renderer 单独检查，避免混淆 IAM 与部署开关。
 */
export function getVisibleProductNavigation(
  features: Partial<Record<ProductFeatureKey, boolean>> | undefined,
  pathname: string | null,
  user?: Pick<User, "permissions"> | null,
) {
  return productNavigation
    .filter(
      (item) =>
        isProductFeatureEnabled(features, item.feature) &&
        ((!item.permissions && !item.permissionAlternatives) ||
          item.permissions?.every(
            (permission) => getPermissionState(user, permission) !== "denied",
          ) === true ||
          item.permissionAlternatives?.some((group) =>
            group.every(
              (permission) => getPermissionState(user, permission) !== "denied",
            ),
          ) === true),
    )
    .map((item) => ({
      ...item,
      isActive:
        item.activeMatch === "exact"
          ? pathname === item.href
          : pathname === item.href ||
            pathname?.startsWith(`${item.href}/`) === true,
    }));
}
