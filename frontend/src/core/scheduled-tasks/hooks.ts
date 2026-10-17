import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";

import {
  createScheduledTask,
  deleteScheduledTask,
  fetchScheduledTasks,
  fetchThreadScheduledTasks,
  pauseScheduledTask,
  resumeScheduledTask,
  triggerScheduledTask,
  updateScheduledTask,
  type ScheduledTaskPayload,
} from "./api";

export function scheduledTasksQueryKey(userId: string | null | undefined) {
  // owner 位于 scheduled-tasks 之后；["scheduled-tasks"] 仍能失效全部账号，含线程任务和运行历史。
  return ["scheduled-tasks", userId ?? null] as const;
}

export function isOwnerScheduledTasksQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 2 段才是 owner。thread 与 runs 不是账号 id，不能拿来按账号清理。
  return queryKey[0] === "scheduled-tasks" && queryKey[1] === userId;
}

export function useScheduledTasks({ enabled }: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/scheduled-tasks 要求 threads:read 与 threads:read data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !accessDenied;
  const queryKey = scheduledTasksQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的任务目录。调用方停用不能清空该账号缓存，也不能波及线程任务或运行历史。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerScheduledTasksQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchScheduledTasks(signal),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的任务目录。
  if (!callerEnabled || accessDenied) {
    return {
      ...query,
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
    };
  }
  return query;
}

export function threadScheduledTasksQueryKey(
  threadId: string | null | undefined,
  userId: string | null | undefined,
) {
  // owner 位于 thread 与 threadId 之后；["scheduled-tasks", "thread", threadId] 与 ["scheduled-tasks"] 仍能失效全部账号。
  return [
    "scheduled-tasks",
    "thread",
    threadId ?? null,
    userId ?? null,
  ] as const;
}

export function isOwnerThreadScheduledTasksQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 4 段才是 owner。目录第 2 段是账号，运行历史第 2 段是 runs。
  return (
    queryKey[0] === "scheduled-tasks" &&
    queryKey[1] === "thread" &&
    queryKey[3] === userId
  );
}

export function useThreadScheduledTasks(
  threadId: string | null | undefined,
  { enabled }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/threads/{id}/scheduled-tasks 要求 threads:read 与线程归属；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = Boolean(threadId) && (enabled ?? true) && !accessDenied;
  const queryKey = threadScheduledTasksQueryKey(threadId, userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的线程任务。调用方停用不能清空该账号缓存，也不能波及任务目录或运行历史。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerThreadScheduledTasksQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchThreadScheduledTasks(threadId!, signal),
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的线程任务。
  if (!callerEnabled || accessDenied) {
    return {
      ...query,
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
    };
  }
  return query;
}

export function useCreateScheduledTask() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (payload: ScheduledTaskPayload) => createScheduledTask(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
    },
    onError: (error: Error) => {
      console.error("Failed to create scheduled task:", error);
      toast.error(t.scheduledTasks.errors.create);
    },
  });
}

export function useUpdateScheduledTask(taskId: string) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (
      payload: Partial<
        Omit<ScheduledTaskPayload, "thread_id" | "schedule_type">
      >,
    ) => updateScheduledTask(taskId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      void queryClient.invalidateQueries({
        queryKey: ["scheduled-tasks", "thread"],
      });
    },
    onError: (error: Error) => {
      console.error("Failed to update scheduled task:", error);
      toast.error(t.scheduledTasks.errors.update);
    },
  });
}

export function usePauseScheduledTask() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (taskId: string) => pauseScheduledTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      void queryClient.invalidateQueries({
        queryKey: ["scheduled-tasks", "thread"],
      });
    },
    onError: (error: Error) => {
      console.error("Failed to pause scheduled task:", error);
      toast.error(t.scheduledTasks.errors.pause);
    },
  });
}

export function useResumeScheduledTask() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (taskId: string) => resumeScheduledTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      void queryClient.invalidateQueries({
        queryKey: ["scheduled-tasks", "thread"],
      });
    },
    onError: (error: Error) => {
      console.error("Failed to resume scheduled task:", error);
      toast.error(t.scheduledTasks.errors.resume);
    },
  });
}

export function useTriggerScheduledTask() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (taskId: string) => triggerScheduledTask(taskId),
    onSuccess: (_result, taskId) => {
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      void queryClient.invalidateQueries({
        queryKey: ["scheduled-tasks", "thread"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["scheduled-tasks", "runs", taskId],
      });
    },
    onError: (error: Error) => {
      console.error("Failed to trigger scheduled task:", error);
      toast.error(t.scheduledTasks.errors.trigger);
    },
  });
}

export function useDeleteScheduledTask() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (taskId: string) => deleteScheduledTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      void queryClient.invalidateQueries({
        queryKey: ["scheduled-tasks", "thread"],
      });
    },
    onError: (error: Error) => {
      console.error("Failed to delete scheduled task:", error);
      toast.error(t.scheduledTasks.errors.delete);
    },
  });
}
