/**
 * React hooks for file uploads
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "../auth/permissions";

import {
  deleteUploadedFile,
  getUploadLimits,
  listUploadedFiles,
  uploadFiles,
  type UploadedFileInfo,
  type UploadResponse,
} from "./api";

export function uploadedFilesQueryKey(
  threadId: string,
  userId: string | null | undefined,
) {
  // owner 位于 list 与 thread 之后；["uploads", "list", threadId] 仍能失效该线程的全部账号。
  return ["uploads", "list", threadId, userId ?? null] as const;
}

export function isOwnerUploadedFilesQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 4 段才是 owner。额度等其它 uploads 命名空间的第 2 段不是 list。
  return (
    queryKey[0] === "uploads" &&
    queryKey[1] === "list" &&
    queryKey[3] === userId
  );
}

export function uploadLimitsQueryKey(
  threadId: string,
  userId: string | null | undefined,
) {
  // owner 位于 limits 与 thread 之后；["uploads", "limits", threadId] 仍能失效该线程的全部账号。
  return ["uploads", "limits", threadId, userId ?? null] as const;
}

export function isOwnerUploadLimitsQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 4 段才是 owner。上传列表的第 2 段是 list，不会被这个谓词命中。
  return (
    queryKey[0] === "uploads" &&
    queryKey[1] === "limits" &&
    queryKey[3] === userId
  );
}

/**
 * Hook to load the gateway-enforced upload limits.
 * Callers must pass the current threads:read grant. Validation still falls back
 * to Gateway enforcement while loading or if the limits endpoint is unavailable.
 */
export function useUploadLimits(
  threadId: string,
  { enabled }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/threads/{id}/uploads/limits 要求 threads:read 与 owner check；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = Boolean(threadId) && (enabled ?? true) && !accessDenied;
  const queryKey = uploadLimitsQueryKey(threadId, userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的上传额度。调用方停用不能清空该账号缓存，也不能波及上传列表或其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerUploadLimitsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getUploadLimits(threadId, signal),
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled,
    retry: false,
    staleTime: 60_000,
  });

  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的上传额度。
  if (!callerEnabled || accessDenied) {
    return {
      ...query,
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
    };
  }
  return query;
}

/**
 * Hook to upload files
 */
export function useUploadFiles(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation<UploadResponse, Error, File[]>({
    mutationFn: (files: File[]) => uploadFiles(threadId, files),
    onSuccess: () => {
      // Invalidate the uploaded files list
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "list", threadId],
      });
    },
  });
}

/**
 * 读取当前线程的上传文件。GET 要求 threads:read 与线程归属。
 */
export function useUploadedFiles(
  threadId: string,
  { enabled }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/threads/{id}/uploads/list 要求 threads:read 与 owner check；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = Boolean(threadId) && (enabled ?? true) && !accessDenied;
  const queryKey = uploadedFilesQueryKey(threadId, userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的上传列表。调用方停用不能清空该账号缓存，也不能波及额度或其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerUploadedFilesQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => listUploadedFiles(threadId, signal),
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled,
  });

  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的上传列表。
  if (!callerEnabled || accessDenied) {
    return {
      ...query,
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
    };
  }
  return query;
}

/**
 * Hook to delete an uploaded file
 */
export function useDeleteUploadedFile(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filename: string) => deleteUploadedFile(threadId, filename),
    onSuccess: () => {
      // Invalidate the uploaded files list
      void queryClient.invalidateQueries({
        queryKey: ["uploads", "list", threadId],
      });
    },
  });
}

/**
 * Hook to handle file uploads in submit flow
 * Returns a function that uploads files and returns their info
 */
export function useUploadFilesOnSubmit(threadId: string) {
  const uploadMutation = useUploadFiles(threadId);

  return useCallback(
    async (files: File[]): Promise<UploadedFileInfo[]> => {
      if (files.length === 0) {
        return [];
      }

      const result = await uploadMutation.mutateAsync(files);
      return result.files;
    },
    [uploadMutation],
  );
}
