import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";

import {
  cancelBackgroundTask,
  fetchBackgroundTask,
  fetchBackgroundTasks,
} from "./api";
import type { BackgroundTaskDetail } from "./types";
import {
  isActiveBackgroundTask,
  shouldPollBackgroundTaskDetail,
} from "./types";

export const backgroundTasksQueryKey = (
  threadId: string,
  cacheScope?: string,
) => ["background-tasks", threadId, cacheScope] as const;

export const backgroundTaskQueryKey = (
  threadId: string,
  taskId: string,
  cacheScope?: string,
) => [...backgroundTasksQueryKey(threadId, cacheScope), taskId] as const;

type CancelBackgroundTaskVariables = {
  threadId: string;
  taskId: string;
  cacheScope?: string;
  enabled: boolean;
};

export function useBackgroundTasks(
  threadId: string,
  options: { enabled: boolean; cacheScope?: string },
) {
  const { user } = useAuth();
  // 列表 GET 要求 threads:read；权限字段缺失时继续请求以兼容旧 Gateway。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  // 功能开关关闭或调用方停用不是撤权，只隐藏结果，不清理该账号缓存。
  const active = options.enabled && Boolean(threadId) && !accessDenied;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => backgroundTasksQueryKey(threadId, options.cacheScope),
    [options.cacheScope, threadId],
  );

  useEffect(() => {
    if (!accessDenied) return;

    // 明确撤权时取消并清理当前账号该线程的列表和详情。其他线程与账号保持不动。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [accessDenied, queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchBackgroundTasks(threadId, signal),
    enabled: active,
    refetchInterval: (query) =>
      query.state.data?.some(isActiveBackgroundTask) ? 3000 : 15000,
    refetchIntervalInBackground: false,
  });
  // TanStack Query retains data while disabled; never expose it after access
  // is revoked or the consumer changes to another account.
  return active
    ? query
    : {
        ...query,
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
      };
}

export function useBackgroundTask(
  threadId: string,
  taskId: string,
  options: { enabled: boolean; cacheScope?: string },
) {
  const { user } = useAuth();
  // 详情 GET 与列表同为 threads:read；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  // 收起详情或调用方停用不是撤权，只隐藏该详情，不清理列表或其他详情。
  const active =
    options.enabled && Boolean(threadId) && Boolean(taskId) && !accessDenied;
  const cacheScope = options.cacheScope;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => backgroundTaskQueryKey(threadId, taskId, cacheScope),
    [cacheScope, taskId, threadId],
  );

  useEffect(() => {
    if (!accessDenied) return;

    // 明确撤权只取消并清理当前账号该线程的详情；列表由列表 hook 清理。
    const ownerDetails = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === "background-tasks" &&
        query.queryKey[1] === threadId &&
        query.queryKey[2] === cacheScope &&
        query.queryKey.length >= 4,
    };
    void queryClient.cancelQueries(ownerDetails);
    queryClient.removeQueries(ownerDetails);
  }, [accessDenied, cacheScope, queryClient, threadId]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchBackgroundTask(threadId, taskId, signal),
    enabled: active,
    refetchInterval: (query) =>
      query.state.data && shouldPollBackgroundTaskDetail(query.state.data)
        ? 3000
        : false,
    refetchIntervalInBackground: false,
  });
  return active
    ? query
    : {
        ...query,
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
      };
}

export function useCancelBackgroundTask(
  threadId: string,
  options: { enabled: boolean },
) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation<
    BackgroundTaskDetail,
    Error,
    CancelBackgroundTaskVariables
  >({
    mutationFn: (variables) => {
      if (!options.enabled || !variables.enabled || !variables.threadId) {
        throw new Error("Task cancellation is not permitted.");
      }
      return cancelBackgroundTask(variables.threadId, variables.taskId);
    },
    onSuccess: (_task, variables) => {
      // 只让仍启用的读取 hook 刷新；不能在权限撤销后写回旧 task detail。
      void queryClient.invalidateQueries({
        queryKey: backgroundTasksQueryKey(
          variables.threadId,
          variables.cacheScope,
        ),
      });
    },
    onError: (error: Error) => {
      // 原始 API 异常保留在 mutation 状态中，用户提示使用本地化安全文案。
      console.error("Failed to cancel background task:", error);
      toast.error(t.backgroundTasks.cancelFailed);
    },
  });
}
