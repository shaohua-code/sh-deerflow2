import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

import {
  clearMemory,
  createMemoryFact,
  deleteMemoryFact,
  importMemory,
  loadMemory,
  updateMemoryFact,
} from "./api";
import type {
  MemoryFactInput,
  MemoryFactPatchInput,
  UserMemory,
} from "./types";

export const memoryQueryKey = (userId: string | null) =>
  ["memory", userId] as const;

type MemoryOwner = { ownerId: string };

export function useMemory(enabled = true, userId: string | null = null) {
  const { user } = useAuth();
  // 记忆读取要求 memory:read；权限字段缺失时继续请求以兼容旧 Gateway。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.MEMORY_READ) === "denied";
  // 调用方停用不是撤权，只隐藏结果，不清理该账号缓存。
  const active = enabled && userId !== null && !accessDenied;
  const queryClient = useQueryClient();
  const previousUserId = useRef(userId);
  const key = memoryQueryKey(userId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => {
      if (!userId) throw new Error("Memory requires an authenticated owner");
      return loadMemory(userId, signal);
    },
    enabled: active,
  });

  useEffect(() => {
    // 切换账号或明确撤权时先取消读取再清缓存，避免旧请求的迟到响应恢复私密记忆。
    const previous = previousUserId.current;
    previousUserId.current = userId;
    const keysToClear = new Set<string>();
    if (previous && previous !== userId) keysToClear.add(previous);
    if (accessDenied && userId) keysToClear.add(userId);
    for (const ownerId of keysToClear) {
      const previousKey = memoryQueryKey(ownerId);
      void queryClient.cancelQueries({ queryKey: previousKey, exact: true });
      queryClient.removeQueries({ queryKey: previousKey, exact: true });
    }
  }, [accessDenied, queryClient, userId]);

  return {
    // 清理 effect 执行前也不向页面暴露当前权限不允许的数据。
    memory: active ? (query.data ?? null) : null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

function invalidateMemoryForOwner(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerId: string,
) {
  // mutation 返回整份记忆正文；只失效发起账号的缓存，避免撤权后的迟到回包复活旧数据。
  return queryClient.invalidateQueries({
    queryKey: memoryQueryKey(ownerId),
    exact: true,
  });
}

export function useClearMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ownerId }: MemoryOwner) => clearMemory(ownerId),
    onSuccess: (_memory, { ownerId }) =>
      invalidateMemoryForOwner(queryClient, ownerId),
  });
}

export function useDeleteMemoryFact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ factId, ownerId }: MemoryOwner & { factId: string }) =>
      deleteMemoryFact(factId, ownerId),
    onSuccess: (_memory, { ownerId }) =>
      invalidateMemoryForOwner(queryClient, ownerId),
  });
}

export function useImportMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memory, ownerId }: MemoryOwner & { memory: UserMemory }) =>
      importMemory(memory, ownerId),
    onSuccess: (_memory, { ownerId }) =>
      invalidateMemoryForOwner(queryClient, ownerId),
  });
}

export function useCreateMemoryFact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      input,
      ownerId,
    }: MemoryOwner & { input: MemoryFactInput }) =>
      createMemoryFact(input, ownerId),
    onSuccess: (_memory, { ownerId }) =>
      invalidateMemoryForOwner(queryClient, ownerId),
  });
}

export function useUpdateMemoryFact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      factId,
      input,
      ownerId,
    }: MemoryOwner & { factId: string; input: MemoryFactPatchInput }) =>
      updateMemoryFact(factId, input, ownerId),
    onSuccess: (_memory, { ownerId }) =>
      invalidateMemoryForOwner(queryClient, ownerId),
  });
}
