import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

import {
  completeLarkAuthorization,
  completeLarkConfiguration,
  installLarkIntegration,
  loadLarkIntegrationStatus,
  setLarkAppCredentials,
  startLarkAuthorization,
  startLarkConfiguration,
} from "./api";

export function larkIntegrationQueryKey(userId?: string | null) {
  // owner 位于 lark 之后；没有更长的状态键。
  return ["integrations", "lark", userId ?? null] as const;
}

export function isOwnerLarkStatusQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 3 段才是 owner。只清理当前账号的飞书状态。
  return (
    queryKey[0] === "integrations" &&
    queryKey[1] === "lark" &&
    queryKey[2] === userId
  );
}

function hiddenLarkStatus(
  query: UseQueryResult<
    Awaited<ReturnType<typeof loadLarkIntegrationStatus>>,
    Error
  >,
) {
  return {
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
  >;
}

export function useLarkIntegrationStatus(
  enabled?: boolean,
): UseQueryResult<
  Awaited<ReturnType<typeof loadLarkIntegrationStatus>>,
  Error
> {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/integrations/lark/status 要求 integrations:read 与 data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.INTEGRATIONS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !accessDenied;
  const queryKey = larkIntegrationQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的飞书状态。调用方停用不能清空该账号缓存。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerLarkStatusQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadLarkIntegrationStatus(signal),
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled,
  });

  if (!callerEnabled || accessDenied) {
    return hiddenLarkStatus(query);
  }
  return query;
}

export function useInstallLarkIntegration() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (_variables: { cacheScope: string | undefined }) =>
      installLarkIntegration(),
    onSuccess: async () => {
      // 只失效发起安装的当前账号。迟到响应不能直接写回状态缓存。
      await queryClient.invalidateQueries({
        queryKey: larkIntegrationQueryKey(userId),
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
