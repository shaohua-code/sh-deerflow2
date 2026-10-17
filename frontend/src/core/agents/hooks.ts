import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

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

function isOwnerAgentDetailQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 3 段才是详情名称。目录只有两段，不能按目录前缀一起删掉。
  return (
    queryKey[0] === AGENTS_QUERY_KEY[0] &&
    queryKey[1] === userId &&
    queryKey.length >= 3
  );
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
  // GET /api/agents 要求 agents:read 与 data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.AGENTS_READ) === "denied";
  const queryClient = useQueryClient();
  // 调用方停用不是撤权，不能清空该账号的目录或详情。
  const callerEnabled = enabled && !accessDenied;
  const queryKey = agentsQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 明确撤权时取消并清理当前账号的目录和详情。其他账号保持不动。
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [accessDenied, queryClient, queryKey]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => listAgents({ signal }),
    enabled: callerEnabled,
  });
  return {
    agents: callerEnabled ? (data ?? []) : [],
    isLoading: callerEnabled && isLoading,
    isFetching: callerEnabled && isFetching,
    error: callerEnabled ? error : null,
    refetch,
  };
}

export function useAgent(name: string | null | undefined, enabled = true) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET 详情同样要求 agents:read；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.AGENTS_READ) === "denied";
  const queryClient = useQueryClient();
  // 没有名称或调用方停用都不是撤权，不能清空目录或其他详情。
  const callerEnabled = Boolean(name) && enabled && !accessDenied;

  useEffect(() => {
    if (!accessDenied) return;
    // 明确撤权只取消并清理当前账号的详情。目录仍由列表 hook 清理。
    const ownerDetails = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerAgentDetailQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerDetails);
    queryClient.removeQueries(ownerDetails);
  }, [accessDenied, queryClient, userId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: agentQueryKey(userId, name),
    queryFn: ({ signal }) => getAgent(name!, { signal }),
    enabled: callerEnabled,
  });
  return {
    agent: callerEnabled ? (data ?? null) : null,
    isLoading: callerEnabled && isLoading,
    isFetching: callerEnabled && isFetching,
    error: callerEnabled ? error : null,
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
