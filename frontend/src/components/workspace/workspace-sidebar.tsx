"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useProductFeature } from "@/product/hooks";
import { WorkspaceSidebarRail } from "@/product/workspace-sidebar-trigger";

import { WorkspaceChannelsList } from "./channels/workspace-channels-list";
import { ProjectsSection } from "./projects-section";
import { RecentChatList } from "./recent-chat-list";
import { ThreadDeleteDialogProvider } from "./thread-delete-dialog";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNavChatList } from "./workspace-nav-chat-list";
import { WorkspaceNavMenu } from "./workspace-nav-menu";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { open: isSidebarOpen } = useSidebar();
  const chatsEnabled = useProductFeature("chats");
  return (
    <ThreadDeleteDialogProvider>
      <Sidebar variant="sidebar" collapsible="icon" {...props}>
        <SidebarHeader className="py-0">
          <WorkspaceHeader />
        </SidebarHeader>
        {/* 长会话标题和项目操作不能把导航撑出横向滚动条。 */}
        <SidebarContent className="overflow-x-hidden">
          <WorkspaceNavChatList />
          <WorkspaceChannelsList />
          {isSidebarOpen && (
            <>
              <ProjectsSection />
              {chatsEnabled && <RecentChatList />}
            </>
          )}
        </SidebarContent>
        <SidebarFooter>
          <WorkspaceNavMenu />
        </SidebarFooter>
        <WorkspaceSidebarRail />
      </Sidebar>
    </ThreadDeleteDialogProvider>
  );
}
