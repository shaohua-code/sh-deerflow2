import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  options: { enabled?: boolean; cacheScope?: string } = {},
) {
  const active = options.enabled !== false && Boolean(threadId);
  const query = useQuery({
    queryKey: backgroundTasksQueryKey(threadId, options.cacheScope),
    queryFn: () => fetchBackgroundTasks(threadId),
    enabled: active,
    refetchInterval: (query) =>
      query.state.data?.some(isActiveBackgroundTask) ? 3000 : 15000,
    refetchIntervalInBackground: false,
  });
  // TanStack Query retains data while disabled; never expose it after access
  // is revoked or the consumer changes to another account.
  return active ? query : { ...query, data: undefined };
}

export function useBackgroundTask(
  threadId: string,
  taskId: string,
  options: { enabled?: boolean; cacheScope?: string } = {},
) {
  const active =
    options.enabled !== false && Boolean(threadId) && Boolean(taskId);
  const query = useQuery({
    queryKey: backgroundTaskQueryKey(threadId, taskId, options.cacheScope),
    queryFn: () => fetchBackgroundTask(threadId, taskId),
    enabled: active,
    refetchInterval: (query) =>
      query.state.data && shouldPollBackgroundTaskDetail(query.state.data)
        ? 3000
        : false,
    refetchIntervalInBackground: false,
  });
  return active ? query : { ...query, data: undefined };
}

export function useCancelBackgroundTask(
  threadId: string,
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation<
    BackgroundTaskDetail,
    Error,
    CancelBackgroundTaskVariables
  >({
    mutationFn: (variables) => {
      if (
        options.enabled === false ||
        !variables.enabled ||
        !variables.threadId
      ) {
        throw new Error("Task cancellation is not permitted.");
      }
      return cancelBackgroundTask(variables.threadId, variables.taskId);
    },
    onSuccess: (task, variables) => {
      queryClient.setQueryData(
        backgroundTaskQueryKey(
          variables.threadId,
          task.task_id,
          variables.cacheScope,
        ),
        task,
      );
      queryClient.setQueryData(
        backgroundTasksQueryKey(variables.threadId, variables.cacheScope),
        (current: unknown) =>
          Array.isArray(current)
            ? current.map((item) =>
                typeof item === "object" &&
                item !== null &&
                "task_id" in item &&
                item.task_id === task.task_id
                  ? task
                  : item,
              )
            : current,
      );
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
