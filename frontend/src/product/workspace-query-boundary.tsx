"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { QueryClientProvider } from "@/components/query-client-provider";
import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";
import {
  isOwnerProjectConfigQuery,
  isOwnerProjectDetailQuery,
  isOwnerProjectDocumentsQuery,
  isOwnerProjectListQuery,
  isOwnerProjectThreadFilesQuery,
  isOwnerProjectThreadsQuery,
} from "@/core/projects/api";
import { isOwnerTrashDocumentsQuery } from "@/core/trash/api";

function WorkspaceProjectPermissionBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  // 只在 projects:read 被明确拒绝时清理；权限字段缺失时保留缓存并允许继续读取。
  const projectsReadDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied";

  useEffect(() => {
    if (!projectsReadDenied) return;

    // 项目列表已按 owner 分区，只取消并清理当前账号。不能再用 ["projects"] 前缀删掉其他账号。
    const ownerLists = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectListQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerLists);
    queryClient.removeQueries(ownerLists);
    // 项目详情已按 owner 分区，只取消并清理当前账号。不能再用 detail 前缀删掉其他账号。
    const ownerDetails = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectDetailQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerDetails);
    queryClient.removeQueries(ownerDetails);
    // 项目会话已按 owner 分区，只取消并清理当前账号。不能再用 threads 前缀删掉其他账号。
    const ownerThreads = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectThreadsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerThreads);
    queryClient.removeQueries(ownerThreads);
    // 项目资料已按 owner 分区，只取消并清理当前账号。不能再用 documents 前缀删掉其他账号。
    const ownerDocuments = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectDocumentsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerDocuments);
    queryClient.removeQueries(ownerDocuments);
    // 会话文件已按 owner 分区，只取消并清理当前账号。不能再用 thread-files 前缀删掉其他账号。
    const ownerThreadFiles = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectThreadFilesQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerThreadFiles);
    queryClient.removeQueries(ownerThreadFiles);
    // 项目配置已按 owner 分区，只取消并清理当前账号。不能再用 config 前缀删掉其他账号。
    const ownerConfig = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectConfigQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerConfig);
    queryClient.removeQueries(ownerConfig);
    // 回收站已按 owner 分区，只取消并清理当前账号。不能再用 ["trash", "documents"] 删掉其他账号。
    const ownerTrash = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerTrashDocumentsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerTrash);
    queryClient.removeQueries(ownerTrash);
  }, [projectsReadDenied, queryClient, userId]);

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
