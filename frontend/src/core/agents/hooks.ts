import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

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
  const queryClient = useQueryClient();
  useEffect(() => {
    if (enabled) return;
    const queryKey = ["agents"] as const;
    // Disabled queries keep their last successful result by default. Remove
    // the list when agents:read is denied so a later render cannot revive it.
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [enabled, queryClient]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["agents"],
    queryFn: ({ signal }) => listAgents({ signal }),
    enabled,
  });
  return { agents: data ?? [], isLoading, isFetching, error, refetch };
}

export function useAgent(name: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (enabled || !name) return;
    const queryKey = ["agents", name] as const;
    // Keep an old detail response out of the cache after agents:read revocation.
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [enabled, name, queryClient]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["agents", name],
    queryFn: ({ signal }) => getAgent(name!, { signal }),
    enabled: Boolean(name) && enabled,
  });
  return { agent: data ?? null, isLoading, isFetching, error, refetch };
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateAgentRequest) => createAgent(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      request,
    }: {
      name: string;
      request: UpdateAgentRequest;
    }) => updateAgent(name, request),
    onSuccess: (_data, { name }) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({ queryKey: ["agents", name] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteAgent(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
