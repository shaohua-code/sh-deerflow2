import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

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

const SCHEDULED_TASKS_QUERY_KEY = ["scheduled-tasks"] as const;

export function useScheduledTasks({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (enabled) return;

    // 撤销 threads:read 后停止拉取并删除该账号可见的任务目录缓存。
    void queryClient.cancelQueries({
      queryKey: SCHEDULED_TASKS_QUERY_KEY,
      exact: true,
    });
    queryClient.removeQueries({
      queryKey: SCHEDULED_TASKS_QUERY_KEY,
      exact: true,
    });
  }, [enabled, queryClient]);

  const query = useQuery({
    queryKey: SCHEDULED_TASKS_QUERY_KEY,
    queryFn: ({ signal }) => fetchScheduledTasks(signal),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    enabled,
  });
  return enabled
    ? query
    : {
        ...query,
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
      };
}

export function useThreadScheduledTasks(
  threadId: string | null | undefined,
  { enabled }: { enabled: boolean },
) {
  const active = enabled && Boolean(threadId);
  const queryKey = useMemo(
    () => ["scheduled-tasks", "thread", threadId] as const,
    [threadId],
  );
  const queryClient = useQueryClient();
  useEffect(() => {
    if (active || !threadId) return;

    // 线程读取权限变化时取消该线程的任务列表，避免旧结果晚到后回填缓存。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [active, queryClient, queryKey, threadId]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchThreadScheduledTasks(threadId!, signal),
    enabled: active,
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
