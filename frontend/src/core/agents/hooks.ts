import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { useAuth } from "@/core/auth/AuthProvider";

import {
  createAgent,
  deleteAgent,
  fetchAgentsApiEnabled,
  getAgent,
  listAgents,
  updateAgent,
} from "./api";
import {
  readCachedAgentsApiEnabled,
  resolveAgentsApiEnabled,
  subscribeCachedAgentsApiEnabled,
  writeCachedAgentsApiEnabled,
} from "./feature-cache";
import type { CreateAgentRequest, UpdateAgentRequest } from "./types";

export const AGENTS_QUERY_KEY = ["agents"] as const;

/** Gateway 按 owner 隔离自建 Agent，浏览器缓存也要按登录用户分区。 */
export function agentsQueryKey(userId: string | null | undefined) {
  return [...AGENTS_QUERY_KEY, userId ?? null] as const;
}

export function agentQueryKey(
  userId: string | null | undefined,
  name: string | null | undefined,
) {
  return [...agentsQueryKey(userId), name ?? null] as const;
}

export function useAgentsApiEnabled() {
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["features", "agents_api"],
    queryFn: () => fetchAgentsApiEnabled(),
    // Re-check on every mount so flipping config.yaml + revisiting the
    // agents section auto-enables the feature without a rebuild.
    staleTime: 0,
    refetchOnMount: true,
    retry: false,
  });

  // 服务端快照固定为 undefined，避免 SSR 与 hydration 首屏读取 localStorage
  // 产生不一致；水合完成后 useSyncExternalStore 再读取浏览器中的 sticky 值。
  const cached = useSyncExternalStore(
    subscribeCachedAgentsApiEnabled,
    readCachedAgentsApiEnabled,
    () => undefined,
  );

  // Persist every definitive answer so a cold start during an /api/features
  // outage can fall back to it instead of failing open and re-introducing the
  // 403 storm (#3757).
  useEffect(() => {
    if (data !== undefined) {
      writeCachedAgentsApiEnabled(data);
    }
  }, [data]);

  // A live answer wins; otherwise stay on the last-known value (sticky) and
  // only fail open when nothing has ever been observed.
  return {
    enabled: resolveAgentsApiEnabled(data, cached),
    isLoading: isPending,
    // 已有本次会话成功读取的能力值时，后台刷新失败不能遮住仍可用的智能体页。
    // 仅浏览器的跨会话缓存不足以证明当前状态，首次探测失败需给出重试入口。
    isError: isError && data === undefined,
    isFetching,
    refetch,
  };
}

export function useAgents(enabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (enabled) return;
    const queryKey = agentsQueryKey(userId);
    // React Query 默认会保留禁用查询的成功结果；撤销 agents:read 时，
    // 清除当前账号的目录和详情缓存，避免后续重新挂载时复用旧数据。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [enabled, queryClient, userId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: agentsQueryKey(userId),
    queryFn: ({ signal }) => listAgents({ signal }),
    enabled,
  });
  return {
    agents: enabled ? (data ?? []) : [],
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useAgent(name: string | null | undefined, enabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (enabled) return;
    const queryKey = agentsQueryKey(userId);
    // 详情页也负责清理当前账号的目录缓存，避免列表数据在其它入口残留。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [enabled, queryClient, userId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: agentQueryKey(userId, name),
    queryFn: ({ signal }) => getAgent(name!, { signal }),
    enabled: Boolean(name) && enabled,
  });
  return {
    agent: enabled ? (data ?? null) : null,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useCreateAgent() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateAgentRequest) => createAgent(request),
    // 保存请求开始时的账号，避免切号后的迟到响应使新账号缓存失效。
    onMutate: () => ({ userId }),
    onSuccess: (_data, _request, mutationContext) => {
      void queryClient.invalidateQueries({
        queryKey: agentsQueryKey(mutationContext?.userId),
      });
    },
  });
}

export function useUpdateAgent() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      request,
    }: {
      name: string;
      request: UpdateAgentRequest;
    }) => updateAgent(name, request),
    // 保存请求开始时的账号，避免切号后的迟到响应使新账号缓存失效。
    onMutate: () => ({ userId }),
    onSuccess: (_data, _variables, mutationContext) => {
      void queryClient.invalidateQueries({
        queryKey: agentsQueryKey(mutationContext?.userId),
      });
    },
  });
}

export function useDeleteAgent() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteAgent(name),
    // 保存请求开始时的账号，避免切号后的迟到响应使新账号缓存失效。
    onMutate: () => ({ userId }),
    onSuccess: (_data, _name, mutationContext) => {
      void queryClient.invalidateQueries({
        queryKey: agentsQueryKey(mutationContext?.userId),
      });
    },
  });
}
