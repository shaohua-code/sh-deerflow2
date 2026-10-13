import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  createManagedSubagent,
  deleteManagedSubagent,
  listSubagents,
  updateManagedSubagent,
} from "./api";
import type {
  CreateManagedSubagentRequest,
  UpdateManagedSubagentRequest,
} from "./types";

export const SUBAGENTS_QUERY_KEY = ["subagents"] as const;

/** 调用方必须传入当前用户的 subagents:read 权限状态。 */
export function useSubagents(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (enabled) return;

    // 撤销 subagents:read 后取消在途目录读取并清除旧缓存，避免权限恢复前残留。
    void queryClient.cancelQueries({
      queryKey: SUBAGENTS_QUERY_KEY,
      exact: true,
    });
    queryClient.removeQueries({
      queryKey: SUBAGENTS_QUERY_KEY,
      exact: true,
    });
  }, [enabled, queryClient]);

  const query = useQuery({
    queryKey: SUBAGENTS_QUERY_KEY,
    queryFn: ({ signal }) => listSubagents({ signal }),
    enabled,
  });
  return {
    // 首次禁用渲染时也不暴露缓存；清缓存由上方 effect 完成。
    subagents: enabled ? (query.data ?? []) : [],
    isLoading: enabled && query.isLoading,
    isFetching: enabled && query.isFetching,
    error: enabled ? query.error : null,
    refetch: query.refetch,
  };
}

export function useCreateManagedSubagent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateManagedSubagentRequest) =>
      createManagedSubagent(request),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: SUBAGENTS_QUERY_KEY }),
  });
}

export function useUpdateManagedSubagent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      request,
    }: {
      name: string;
      request: UpdateManagedSubagentRequest;
    }) => updateManagedSubagent(name, request),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: SUBAGENTS_QUERY_KEY }),
  });
}

export function useDeleteManagedSubagent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteManagedSubagent,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: SUBAGENTS_QUERY_KEY }),
  });
}
