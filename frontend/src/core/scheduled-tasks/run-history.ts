import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

import { fetchScheduledTaskRuns } from "./api";

export const RUN_HISTORY_PAGE_SIZE = 50;

export function scheduledTaskRunHistoryQueryKey(
  userId: string | null | undefined,
  taskId: string | undefined,
  page: number,
) {
  return ["scheduled-tasks", "runs", taskId, userId ?? null, page] as const;
}

function isOwnerRunHistoryQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  return (
    queryKey[0] === "scheduled-tasks" &&
    queryKey[1] === "runs" &&
    queryKey[3] === userId
  );
}

export function useScheduledTaskRunHistory(
  taskId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // 运行历史同时要求 threads:read 与 runs:read；权限字段缺失时保持旧 Gateway 兼容。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied" ||
    getPermissionState(user, PERMISSIONS.RUNS_READ) === "denied";
  const client = useQueryClient();
  useEffect(() => {
    if (!accessDenied) return;
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerRunHistoryQuery(query.queryKey, userId),
    };
    void client.cancelQueries(ownerQueries);
    client.removeQueries(ownerQueries);
  }, [accessDenied, client, userId]);
  const [position, setPosition] = useState({ taskId, page: 0 });
  const page = position.taskId === taskId ? position.page : 0;
  if (position.taskId !== taskId) {
    setPosition({ taskId, page: 0 });
  }
  const active = enabled && !accessDenied && Boolean(taskId);
  const query = useQuery({
    queryKey: scheduledTaskRunHistoryQueryKey(userId, taskId, page),
    queryFn: ({ signal }) =>
      fetchScheduledTaskRuns(taskId ?? "", {
        limit: RUN_HISTORY_PAGE_SIZE + 1,
        offset: page * RUN_HISTORY_PAGE_SIZE,
        signal,
      }),
    enabled: active,
    refetchInterval: page === 0 ? 15000 : false,
    refetchIntervalInBackground: false,
    refetchOnMount: page === 0,
    refetchOnWindowFocus: page === 0,
    refetchOnReconnect: page === 0,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的运行记录。
  const data = active ? query.data : undefined;
  return {
    ...query,
    data: data?.slice(0, RUN_HISTORY_PAGE_SIZE),
    page,
    hasOlder: (data?.length ?? 0) > RUN_HISTORY_PAGE_SIZE,
    accessDenied,
    older: () => {
      if (active) setPosition({ taskId, page: page + 1 });
    },
    newer: () => {
      if (active) setPosition({ taskId, page: Math.max(0, page - 1) });
    },
    latest: () => {
      if (!active) return;
      setPosition({ taskId, page: 0 });
      void client.invalidateQueries({
        queryKey: scheduledTaskRunHistoryQueryKey(userId, taskId, 0),
        exact: true,
      });
    },
  };
}
