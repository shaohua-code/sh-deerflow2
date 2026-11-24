import {
  BlocksIcon,
  BotIcon,
  CalendarClock,
  FilesIcon,
  LayoutDashboard,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

import type { ProductFeatureKey } from "./api";
import { isProductFeatureEnabled } from "./features";
import { isIamMenuGranted, type IamResourceControlState } from "./iam-resources";

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
  /** IAM 资源树中的菜单码；菜单显隐是唯一权限管控点（与 IAM 侧登记一致）。 */
  iamMenuCode: string;
};

/**
 * Flow Desk 自有导航目录。
 *
 * 如果 DeerFlow 调整工作台侧栏结构，应优先复核这份目录和产品 renderer，
 * 而不是把品牌路由继续写进上游导航组件；feature 仅控制展示，
 * 菜单显隐由 IAM 资源树（iamMenuCode）决定，其余能力不再做权限管控。
 */
export const productNavigation: readonly ProductNavigationItem[] = [
  {
    id: "overview",
    href: "/workspace",
    feature: "overview",
    icon: LayoutDashboard,
    activeMatch: "exact",
    iamMenuCode: "deerflow.overview",
  },
  {
    id: "chats",
    href: "/workspace/chats",
    feature: "chats",
    icon: MessagesSquare,
    activeMatch: "exact",
    iamMenuCode: "deerflow.chats",
  },
  {
    id: "agents",
    href: "/workspace/agents",
    feature: "agents",
    icon: BotIcon,
    activeMatch: "section",
    gatewayCapability: "agents",
    iamMenuCode: "deerflow.agents",
  },
  {
    id: "scheduledTasks",
    href: "/workspace/scheduled-tasks",
    feature: "scheduled_tasks",
    icon: CalendarClock,
    activeMatch: "section",
    iamMenuCode: "deerflow.scheduled-tasks",
  },
  {
    id: "files",
    href: "/workspace/files",
    feature: "files",
    icon: FilesIcon,
    activeMatch: "section",
    iamMenuCode: "deerflow.files",
  },
  {
    id: "capabilities",
    href: "/workspace/capabilities",
    feature: "capabilities",
    icon: BlocksIcon,
    activeMatch: "section",
    iamMenuCode: "deerflow.capabilities",
  },
];

/**
 * 依产品展示开关和 IAM 菜单码筛选导航，再计算当前路由状态。
 *
 * 菜单显隐是 IAM 的管控点之一，三态口径见 IamResourceControlState：
 * 未受控（null）时全量显示，避免 IAM 抖动吞掉侧栏；解析中（undefined）暂不显示，
 * 避免未授权菜单先闪现再收起；受控时只显示 IAM 资源树已授权的菜单。
 * Agent 功能能力仍由 renderer 单独检查。
 */
export function getVisibleProductNavigation(
  features: Partial<Record<ProductFeatureKey, boolean>> | undefined,
  pathname: string | null,
  iamControl: IamResourceControlState,
) {
  return productNavigation
    .filter(
      (item) =>
        isProductFeatureEnabled(features, item.feature) &&
        isIamMenuGranted(iamControl, item.iamMenuCode),
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
