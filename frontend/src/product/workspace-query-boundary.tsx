"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { QueryClientProvider } from "@/components/query-client-provider";
import { useAuth } from "@/core/auth/AuthProvider";
import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";
import { PROJECTS_QUERY_KEY } from "@/core/projects/api";
import { TRASH_QUERY_KEY } from "@/core/trash/api";

function WorkspaceProjectPermissionBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canReadProjects = hasPermission(user, PERMISSIONS.PROJECTS_READ);

  useEffect(() => {
    if (canReadProjects) return;

    // 项目权限是整个工作台共享的：按前缀清缓存，覆盖列表、详情、资料和配置。
    void queryClient.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
    queryClient.removeQueries({ queryKey: PROJECTS_QUERY_KEY });
    void queryClient.cancelQueries({ queryKey: TRASH_QUERY_KEY, exact: true });
    queryClient.removeQueries({ queryKey: TRASH_QUERY_KEY, exact: true });
  }, [canReadProjects, queryClient]);

  return <>{children}</>;
}

/**
 * 工作台当前登录账号是 TanStack Query 缓存的所有者。
 * 身份切换时重建 Provider 和整个工作台子树，旧账号查询结果及未完成表单不会
 * 短暂出现在新账号页面；其他公开预览页各自仍保有独立的查询缓存实例。
 */
export function WorkspaceQueryBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <QueryClientProvider key={user?.id ?? "anonymous"}>
      <WorkspaceProjectPermissionBoundary>
        {children}
      </WorkspaceProjectPermissionBoundary>
    </QueryClientProvider>
  );
}
