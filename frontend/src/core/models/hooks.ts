import { useQuery } from "@tanstack/react-query";

import { UnauthorizedError } from "@/core/api/errors";

import { loadModels } from "./api";

export const MODELS_QUERY_KEY = ["models"] as const;
const MODELS_STALE_TIME_MS = 60_000;

export function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: MODELS_QUERY_KEY,
    queryFn: () => loadModels(),
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
