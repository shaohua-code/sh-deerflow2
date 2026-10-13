"use client";

import type { ReactNode } from "react";

import { QueryClientProvider } from "@/components/query-client-provider";
import { useAuth } from "@/core/auth/AuthProvider";

/**
 * 工作台当前登录账号是 TanStack Query 缓存的所有者。
 * 身份切换时重建 Provider 和整个工作台子树，旧账号查询结果及未完成表单不会
 * 短暂出现在新账号页面；其他公开预览页各自仍保有独立的查询缓存实例。
 */
export function WorkspaceQueryBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <QueryClientProvider key={user?.id ?? "anonymous"}>
      {children}
    </QueryClientProvider>
  );
}
