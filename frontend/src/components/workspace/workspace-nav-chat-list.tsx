"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentsApiEnabled } from "@/core/agents";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import { getProductCopy } from "@/product/copy";
import { useProductBootstrap } from "@/product/hooks";
import {
  getVisibleProductNavigation,
  type ProductNavigationId,
} from "@/product/navigation";

export function WorkspaceNavChatList() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const productCopy = getProductCopy(locale);
  const pathname = usePathname();
  const { enabled: agentsEnabled, isError: agentsCapabilityError } =
    useAgentsApiEnabled();
  const { data: product } = useProductBootstrap();
  const items = getVisibleProductNavigation(product?.features, pathname, user);
  const labels: Record<ProductNavigationId, string> = {
    overview: productCopy.overview,
    chats: t.sidebar.chats,
    agents: t.sidebar.agents,
    scheduledTasks: t.sidebar.scheduledTasks,
    files: productCopy.filesTitle,
    capabilities: t.capabilities.title,
  };

  return (
    <SidebarGroup className="pt-1">
      <SidebarMenu>
        {items.map((item) => {
          const Icon = item.icon;
          const label = labels[item.id];

          return (
            <SidebarMenuItem key={item.id}>
              {item.gatewayCapability === "agents" &&
              !agentsEnabled &&
              !agentsCapabilityError ? (
                <>
                  {/* 按钮禁用后基础侧栏会拦截鼠标事件，因此由外层 span 承载悬停说明。 */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* 键盘仍可聚焦禁用项，并通过 aria-describedby 读到原因。 */}
                      <span className="block w-full cursor-not-allowed">
                        <SidebarMenuButton
                          className="text-muted-foreground/50"
                          aria-disabled
                          aria-describedby="agents-disabled-reason"
                        >
                          <Icon />
                          <span>{label}</span>
                        </SidebarMenuButton>
                        <span id="agents-disabled-reason" className="sr-only">
                          {t.sidebar.agentsDisabledTooltip}
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {t.sidebar.agentsDisabledTooltip}
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <SidebarMenuButton isActive={item.isActive} asChild>
                  <Link className="text-muted-foreground" href={item.href}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
