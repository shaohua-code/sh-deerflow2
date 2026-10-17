import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

import {
  configureChannelProvider,
  connectChannelProvider,
  disconnectChannelConnection,
  disconnectChannelProvider,
  listChannelConnections,
  listChannelProviders,
} from "./api";
import { startConnectionPoll, type ConnectPollHandle } from "./connect-poll";
import type { ChannelProviderId, ChannelRuntimeConfigValues } from "./types";

const CHANNEL_PROVIDERS_QUERY_KEY = ["channelProviders"] as const;
const CHANNEL_CONNECTIONS_QUERY_KEY = ["channelConnections"] as const;

/** 渠道响应会带当前用户的连接状态，因此缓存必须按 owner 分区。 */
export function channelProviderQueryKey(userId: string | null | undefined) {
  return [...CHANNEL_PROVIDERS_QUERY_KEY, userId ?? null] as const;
}

export function channelConnectionsQueryKey(userId: string | null | undefined) {
  return [...CHANNEL_CONNECTIONS_QUERY_KEY, userId ?? null] as const;
}

function invalidateOwnerChannelState(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | null | undefined,
) {
  void queryClient.invalidateQueries({
    queryKey: channelProviderQueryKey(userId),
  });
  void queryClient.invalidateQueries({
    queryKey: channelConnectionsQueryKey(userId),
  });
}

/** 管理员运行时设置影响部署中的所有账号，需刷新所有 owner 快照。 */
function invalidateAllChannelState(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: CHANNEL_PROVIDERS_QUERY_KEY });
  void queryClient.invalidateQueries({
    queryKey: CHANNEL_CONNECTIONS_QUERY_KEY,
  });
}

export function useChannelProviders(queryEnabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/channels/providers 要求 channels:read 与 data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.CHANNELS_READ) === "denied";
  const queryClient = useQueryClient();
  // 调用方停用不是撤权，不能拿来清空该账号的渠道目录。
  const callerEnabled = queryEnabled && !accessDenied;
  const queryKey = channelProviderQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的渠道目录。连接缓存和其他账号保持不动。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [accessDenied, queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => listChannelProviders(signal),
    enabled: callerEnabled,
  });
  return {
    enabled: callerEnabled ? (query.data?.enabled ?? false) : false,
    providers: callerEnabled ? (query.data?.providers ?? []) : [],
    isLoading: callerEnabled && query.isLoading,
    isFetching: callerEnabled && query.isFetching,
    hasData: callerEnabled && query.data !== undefined,
    error: callerEnabled ? query.error : null,
    refetch: query.refetch,
  };
}

export function useChannelConnections(queryEnabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/channels/connections 要求 channels:read 与 data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.CHANNELS_READ) === "denied";
  const queryClient = useQueryClient();
  // 调用方停用不是撤权，不能清空该账号的连接或渠道目录。
  const callerEnabled = queryEnabled && !accessDenied;
  const queryKey = channelConnectionsQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的连接。渠道目录和其他账号保持不动。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [accessDenied, queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => listChannelConnections(signal),
    enabled: callerEnabled,
  });
  return {
    connections: callerEnabled ? (query.data ?? []) : [],
    isLoading: callerEnabled && query.isLoading,
    isFetching: callerEnabled && query.isFetching,
    hasData: callerEnabled && query.data !== undefined,
    error: callerEnabled ? query.error : null,
    refetch: query.refetch,
  };
}

export function useConnectChannelProvider(readEnabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const pollersRef = useRef<Map<ChannelProviderId, ConnectPollHandle>>(
    new Map(),
  );

  // Permission loss, account changes, and unmounts all stop owner-bound polls.
  useEffect(() => {
    const pollers = pollersRef.current;
    if (!readEnabled) {
      pollers.forEach((handle) => handle.cancel());
      pollers.clear();
    }
    return () => {
      pollers.forEach((handle) => handle.cancel());
      pollers.clear();
      void queryClient.cancelQueries({
        queryKey: channelConnectionsQueryKey(userId),
      });
    };
  }, [queryClient, readEnabled, userId]);

  return useMutation({
    mutationFn: (provider: ChannelProviderId) =>
      connectChannelProvider(provider),
    onMutate: () => ({ userId }),
    onSuccess: (result, provider, mutationContext) => {
      const ownerId = mutationContext?.userId;
      invalidateOwnerChannelState(queryClient, ownerId);
      const connectionsKey = channelConnectionsQueryKey(ownerId);

      // Replace any existing poll for this provider so repeated Connect clicks
      // don't spawn parallel polling chains racing on the same query keys.
      pollersRef.current.get(provider)?.cancel();
      pollersRef.current.set(
        provider,
        startConnectionPoll({
          provider,
          expiresInSeconds: result.expires_in,
          fetchConnections: () =>
            queryClient.fetchQuery({
              queryKey: connectionsKey,
              queryFn: ({ signal }) => listChannelConnections(signal),
            }),
          onConnected: () => {
            // Refresh derived provider state exactly once when the bind lands.
            void queryClient.invalidateQueries({
              queryKey: channelProviderQueryKey(ownerId),
            });
          },
        }),
      );
    },
  });
}

export function useConfigureChannelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      values,
    }: {
      provider: ChannelProviderId;
      values: ChannelRuntimeConfigValues;
    }) => configureChannelProvider(provider, values),
    onSuccess: () => {
      invalidateAllChannelState(queryClient);
    },
  });
}

export function useDisconnectChannelConnection() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      disconnectChannelConnection(connectionId),
    onMutate: () => ({ userId }),
    onSuccess: (_data, _connectionId, mutationContext) => {
      invalidateOwnerChannelState(queryClient, mutationContext?.userId);
    },
  });
}

export function useDisconnectChannelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: ChannelProviderId) =>
      disconnectChannelProvider(provider),
    onSuccess: () => {
      invalidateAllChannelState(queryClient);
    },
  });
}
