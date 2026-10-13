"use client";

import { MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/product/brand-mark";
import { useProductBrandName, useProductFeature } from "@/product/hooks";
import { WorkspaceSidebarTrigger } from "@/product/workspace-sidebar-trigger";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const { state } = useSidebar();
  const brandName = useProductBrandName(locale);
  const chatsEnabled = useProductFeature("chats");
  const pathname = usePathname();
  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-12 flex-col justify-center",
          className,
        )}
      >
        {state === "collapsed" ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full items-center justify-center">
            <Link
              href={
                env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
                  ? "/"
                  : "/workspace"
              }
              aria-label={brandName}
              className="group-hover/workspace-header:hidden"
            >
              <BrandMark className="size-8 rounded-[10px]" />
            </Link>
            <WorkspaceSidebarTrigger className="hidden pl-2 group-hover/workspace-header:block" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Link
              href={
                env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
                  ? "/"
                  : "/workspace"
              }
              className="ml-1 inline-flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition-opacity hover:opacity-80"
            >
              <BrandMark className="size-7 rounded-[9px]" />
              <span className="text-foreground text-sm font-semibold tracking-tight">
                {brandName}
              </span>
            </Link>
            <WorkspaceSidebarTrigger />
          </div>
        )}
      </div>
      {chatsEnabled && (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/workspace/chats/new"}
              asChild
            >
              <Link
                className="text-muted-foreground"
                href="/workspace/chats/new"
              >
                <MessageSquarePlus size={16} />
                <span>{t.sidebar.newChat}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
    </>
  );
}
