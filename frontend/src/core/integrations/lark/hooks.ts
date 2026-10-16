import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import {
  completeLarkAuthorization,
  completeLarkConfiguration,
  installLarkIntegration,
  loadLarkIntegrationStatus,
  setLarkAppCredentials,
  startLarkAuthorization,
  startLarkConfiguration,
} from "./api";

export const larkIntegrationQueryKey = (cacheScope?: string) =>
  ["integrations", "lark", cacheScope] as const;

export function useLarkIntegrationStatus(
  enabled = true,
  cacheScope?: string,
): UseQueryResult<
  Awaited<ReturnType<typeof loadLarkIntegrationStatus>>,
  Error
> {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => larkIntegrationQueryKey(cacheScope),
    [cacheScope],
  );

  useEffect(() => {
    if (enabled) return;

    // 用户失去 integrations:read 后，停止请求并清除其状态快照。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [enabled, queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadLarkIntegrationStatus(signal),
    enabled,
  });

  return enabled
    ? query
    : ({
        ...query,
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
        isError: false,
        isLoadingError: false,
        isRefetchError: false,
        isSuccess: false,
        isPending: true,
        isPlaceholderData: false,
        status: "pending",
        fetchStatus: "idle",
      } as UseQueryResult<
        Awaited<ReturnType<typeof loadLarkIntegrationStatus>>,
        Error
      >);
}

export function useInstallLarkIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (_variables: { cacheScope: string | undefined }) =>
      installLarkIntegration(),
    onSuccess: async (_result, variables) => {
      const queryKey = larkIntegrationQueryKey(variables.cacheScope);
      // Refetch the initiating account only; a late install response must not
      // repopulate a status cache after that account lost read access.
      await queryClient.invalidateQueries({
        queryKey,
      });
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useStartLarkAuthorization() {
  return useMutation({
    mutationFn: startLarkAuthorization,
  });
}

export function useStartLarkConfiguration() {
  return useMutation({
    mutationFn: startLarkConfiguration,
  });
}

export function useCompleteLarkConfiguration() {
  return useMutation({
    mutationFn: completeLarkConfiguration,
  });
}

export function useSetLarkAppCredentials() {
  return useMutation({
    mutationFn: setLarkAppCredentials,
  });
}

export function useCompleteLarkAuthorization() {
  return useMutation({
    mutationFn: completeLarkAuthorization,
  });
}
