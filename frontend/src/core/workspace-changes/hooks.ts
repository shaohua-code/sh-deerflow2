import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

import { fetchWorkspaceChanges } from "./api";
import type { WorkspaceChangesResponse } from "./types";

const WORKSPACE_CHANGES_QUERY_KEY = ["workspace-changes"] as const;

export function workspaceChangesQueryKey(
  userId: string | null | undefined,
  threadId: string | undefined,
  runId: string | undefined,
  includeFiles: boolean,
  includeDiff: boolean,
) {
  return [
    ...WORKSPACE_CHANGES_QUERY_KEY,
    userId ?? null,
    threadId,
    runId,
    includeFiles,
    includeDiff,
  ] as const;
}

export function useWorkspaceChanges({
  threadId,
  runId,
  includeFiles = true,
  includeDiff = true,
  enabled = true,
}: {
  threadId?: string;
  runId?: string;
  includeFiles?: boolean;
  includeDiff?: boolean;
  enabled?: boolean;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const accessDenied =
    getPermissionState(user, PERMISSIONS.RUNS_READ) === "denied";
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!accessDenied) return;

    const queryKey = [...WORKSPACE_CHANGES_QUERY_KEY, userId] as const;
    // runs:read 撤销后，立即终止该账号所有旧运行差异读取并清理缓存。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [accessDenied, queryClient, userId]);

  const query = useQuery<WorkspaceChangesResponse>({
    queryKey: workspaceChangesQueryKey(
      userId,
      threadId,
      runId,
      includeFiles,
      includeDiff,
    ),
    queryFn: ({ signal }) => {
      if (!threadId || !runId) {
        throw new Error("threadId and runId are required");
      }
      return fetchWorkspaceChanges({
        threadId,
        runId,
        includeFiles,
        includeDiff,
        signal,
      });
    },
    enabled: !accessDenied && enabled && Boolean(threadId) && Boolean(runId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return {
    ...query,
    // 明确失去 runs:read 时同一帧隐藏旧数据，不等待 effect 清缓存。
    data: accessDenied ? undefined : query.data,
    isLoading: !accessDenied && query.isLoading,
    error: accessDenied ? null : query.error,
  };
}
