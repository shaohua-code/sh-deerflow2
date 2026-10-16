import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

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
  const active = options.enabled && Boolean(threadId);
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => backgroundTasksQueryKey(threadId, options.cacheScope),
    [options.cacheScope, threadId],
  );

  useEffect(() => {
    if (active) return;

    // 线程读取权限撤销后按用户和线程清理列表及详情，防止响应继续回填。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [active, queryClient, queryKey]);

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
  const active = options.enabled && Boolean(threadId) && Boolean(taskId);
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => backgroundTaskQueryKey(threadId, taskId, options.cacheScope),
    [options.cacheScope, taskId, threadId],
  );

  useEffect(() => {
    if (active) return;

    // 详情只在展开时读取；关闭详情或失去读取权后取消并清除该详情。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [active, queryClient, queryKey]);

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
