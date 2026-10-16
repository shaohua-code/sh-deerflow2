import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";

import {
  controlSubagentBatch,
  fetchSubagentBatchItems,
  fetchSubagentBatches,
  retrySubagentBatchItem,
} from "./api";
import { isActiveSubagentBatch } from "./types";

export const subagentBatchesKey = (threadId: string, cacheScope?: string) =>
  ["subagent-batches", threadId, cacheScope] as const;
export const subagentBatchItemsKey = (
  threadId: string,
  batchId: string,
  cacheScope?: string,
) => [...subagentBatchesKey(threadId, cacheScope), batchId, "items"] as const;
const SUBAGENT_BATCH_ITEMS_PAGE_SIZE = 100;

export function useSubagentBatches(
  threadId: string,
  options: { enabled: boolean; polling?: boolean; cacheScope?: string },
) {
  const queryClient = useQueryClient();
  const active = options.enabled && Boolean(threadId);
  const queryKey = useMemo(
    () => subagentBatchesKey(threadId, options.cacheScope),
    [options.cacheScope, threadId],
  );

  useEffect(() => {
    if (active) return;

    // 失去 threads:read 或仓储不可用时清除该线程的批次和已加载条目。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [active, queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchSubagentBatches(threadId, signal),
    enabled: active,
    refetchInterval: (query) => {
      if (options.polling === false) return false;
      return query.state.data?.some(isActiveSubagentBatch) ? 2000 : 15000;
    },
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

export function useSubagentBatchItems(
  threadId: string,
  batchId: string,
  options: { enabled: boolean; polling?: boolean; cacheScope?: string },
) {
  const queryClient = useQueryClient();
  const active = options.enabled && Boolean(threadId) && Boolean(batchId);
  const queryKey = useMemo(
    () => subagentBatchItemsKey(threadId, batchId, options.cacheScope),
    [batchId, options.cacheScope, threadId],
  );

  useEffect(() => {
    if (active) return;

    // 关闭条目或撤销读取权限后，不保留上一轮分页快照。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [active, queryClient, queryKey]);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      fetchSubagentBatchItems(threadId, batchId, {
        offset: pageParam,
        limit: SUBAGENT_BATCH_ITEMS_PAGE_SIZE,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === SUBAGENT_BATCH_ITEMS_PAGE_SIZE
        ? allPages.reduce((total, page) => total + page.length, 0)
        : undefined,
    enabled: active,
    // React Query refetches every loaded infinite page. Keep live polling for
    // the bounded first page, then stop automatic fan-out after the user loads
    // more; window-focus/manual invalidation still refreshes the loaded pages.
    refetchInterval: (query) => {
      if (options.polling === false) return false;
      return (query.state.data?.pages.length ?? 0) <= 1 ? 3000 : false;
    },
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

export function useControlSubagentBatch(
  threadId: string,
  { enabled }: { enabled: boolean },
) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: ({
      batchId,
      action,
      cacheScope,
    }: {
      batchId: string;
      action: "pause" | "resume" | "cancel";
      cacheScope: string | undefined;
    }) => {
      if (!enabled || !threadId) {
        throw new Error("Thread write permission is required.");
      }
      return controlSubagentBatch(threadId, batchId, action);
    },
    onSuccess: (_batch, variables) =>
      queryClient.invalidateQueries({
        queryKey: subagentBatchesKey(threadId, variables.cacheScope),
      }),
    onError: (error: Error) => {
      console.error("Failed to update subagent batch:", error);
      toast.error(t.subagentBatches.controlFailed);
    },
  });
}

export function useRetrySubagentBatchItem(
  threadId: string,
  batchId: string,
  { enabled }: { enabled: boolean },
) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation({
    mutationFn: ({
      itemId,
    }: {
      itemId: string;
      cacheScope: string | undefined;
    }) => {
      if (!enabled || !threadId || !batchId) {
        throw new Error("Thread write permission is required.");
      }
      return retrySubagentBatchItem(threadId, batchId, itemId);
    },
    onSuccess: (_item, variables) => {
      void queryClient.invalidateQueries({
        queryKey: subagentBatchesKey(threadId, variables.cacheScope),
      });
      void queryClient.invalidateQueries({
        queryKey: subagentBatchItemsKey(
          threadId,
          batchId,
          variables.cacheScope,
        ),
      });
    },
    onError: (error: Error) => {
      console.error("Failed to retry subagent batch item:", error);
      toast.error(t.subagentBatches.retryFailed);
    },
  });
}
