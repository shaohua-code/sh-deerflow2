import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useScheduledTasks({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: fetchScheduledTasks,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    enabled,
  });
  return enabled ? query : { ...query, data: undefined };
}

export function useThreadScheduledTasks(
  threadId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const active = enabled && Boolean(threadId);
  const query = useQuery({
    queryKey: ["scheduled-tasks", "thread", threadId],
    queryFn: () => fetchThreadScheduledTasks(threadId ?? ""),
    enabled: active,
  });
  return active ? query : { ...query, data: undefined };
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
