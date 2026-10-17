import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";
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
  const { user } = useAuth();
  // 批次列表 GET 要求 threads:read；权限字段缺失时继续请求以兼容旧 Gateway。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  // 仓储不可用或调用方停用不是撤权，只隐藏结果，不清理该账号缓存。
  const active = options.enabled && Boolean(threadId) && !accessDenied;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => subagentBatchesKey(threadId, options.cacheScope),
    [options.cacheScope, threadId],
  );

  useEffect(() => {
    if (!accessDenied) return;

    // 明确撤权时取消并清理当前账号该线程的批次和已加载条目。其他账号与线程不动。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [accessDenied, queryClient, queryKey]);

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
  const { user } = useAuth();
  // 条目分页与批次列表同为 threads:read；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  // 收起条目或调用方停用不是撤权，只隐藏该批次条目，不清理列表或其他条目。
  const active =
    options.enabled && Boolean(threadId) && Boolean(batchId) && !accessDenied;
  const cacheScope = options.cacheScope;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => subagentBatchItemsKey(threadId, batchId, cacheScope),
    [batchId, cacheScope, threadId],
  );

  useEffect(() => {
    if (!accessDenied) return;

    // 明确撤权只取消并清理当前账号该线程的条目分页；列表由列表 hook 清理。
    const ownerItems = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === "subagent-batches" &&
        query.queryKey[1] === threadId &&
        query.queryKey[2] === cacheScope &&
        query.queryKey.length >= 4,
    };
    void queryClient.cancelQueries(ownerItems);
    queryClient.removeQueries(ownerItems);
  }, [accessDenied, cacheScope, queryClient, threadId]);

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
    }: {
      batchId: string;
      action: "pause" | "resume" | "cancel";
      // cacheScope 仅用于 onSuccess 的缓存失效（variables 透传），控制
      // 请求本身不需要它，故不在此解构。
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
