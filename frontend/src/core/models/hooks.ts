import { useQuery } from "@tanstack/react-query";

import { UnauthorizedError } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";

import { loadModels } from "./api";

export const MODELS_QUERY_KEY = ["models"] as const;
const MODELS_STALE_TIME_MS = 60_000;

/** Gateway 按当前用户的模型授权过滤目录，因此浏览器缓存也按同一 owner 隔离。 */
export function modelsQueryKey(userId: string | null | undefined) {
  return [...MODELS_QUERY_KEY, userId ?? null] as const;
}

export function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: modelsQueryKey(userId),
    // 账号 ID 变化时会更换 query key；传递 signal 使 React Query 取消旧账号请求。
    queryFn: ({ signal }) => loadModels(signal),
    enabled,
    // Surface persistent gateway failures promptly while retaining one retry
    // for transient startup or network errors.
    retry: (failureCount, queryError) =>
      !(queryError instanceof UnauthorizedError) && failureCount < 1,
    refetchOnWindowFocus: true,
    // Multiple Agent/subtask cards share one cached list. Keep it fresh for a
    // short window to avoid duplicate requests, then recheck authorization on
    // remount or window focus so IAM model grants can take effect in-session.
    staleTime: MODELS_STALE_TIME_MS,
  });
  return {
    models: data?.models ?? [],
    tokenUsageEnabled: data?.token_usage.enabled ?? false,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}
