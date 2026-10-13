import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchScheduledTaskRuns } from "./api";

export const RUN_HISTORY_PAGE_SIZE = 50;

export function useScheduledTaskRunHistory(
  taskId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const client = useQueryClient();
  const [position, setPosition] = useState({ taskId, page: 0 });
  const page = position.taskId === taskId ? position.page : 0;
  if (position.taskId !== taskId) {
    setPosition({ taskId, page: 0 });
  }
  const active = enabled && Boolean(taskId);
  const query = useQuery({
    queryKey: ["scheduled-tasks", "runs", taskId, page],
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
  // A disabled query can retain a prior user's run history in TanStack Query.
  const data = active ? query.data : undefined;
  return {
    ...query,
    data: data?.slice(0, RUN_HISTORY_PAGE_SIZE),
    page,
    hasOlder: (data?.length ?? 0) > RUN_HISTORY_PAGE_SIZE,
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
        queryKey: ["scheduled-tasks", "runs", taskId, 0],
        exact: true,
      });
    },
  };
}
