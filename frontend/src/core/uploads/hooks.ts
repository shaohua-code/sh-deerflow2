/**
 * React hooks for file uploads
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import {
  deleteUploadedFile,
  getUploadLimits,
  listUploadedFiles,
  uploadFiles,
  type UploadedFileInfo,
  type UploadResponse,
} from "./api";

/**
 * Hook to load the gateway-enforced upload limits.
 * Callers must pass the current threads:read grant. Validation still falls back
 * to Gateway enforcement while loading or if the limits endpoint is unavailable.
 */
export function useUploadLimits(
  threadId: string,
  options: { enabled: boolean },
) {
  const queryClient = useQueryClient();
  const active = Boolean(threadId) && options.enabled;
  const queryKey = useMemo(
    () => ["uploads", "limits", threadId] as const,
    [threadId],
  );

  useEffect(() => {
    if (active) return;

    // 撤销 threads:read 后取消在途请求并清除旧额度，不能继续用授权前缓存校验附件。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [active, queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getUploadLimits(threadId, signal),
    enabled: active,
    retry: false,
    staleTime: 60_000,
  });

  return active
    ? query
    : {
        ...query,
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
      };
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
 * 读取当前线程的上传文件。调用方必须传入 threads:read 权限，撤权后会取消请求并清除旧目录缓存。
 */
export function useUploadedFiles(
  threadId: string,
  { enabled }: { enabled: boolean },
) {
  const queryClient = useQueryClient();
  const active = Boolean(threadId) && enabled;
  const queryKey = useMemo(
    () => ["uploads", "list", threadId] as const,
    [threadId],
  );

  useEffect(() => {
    if (active) return;

    // 撤销 threads:read 后停止目录读取，并清除授权前缓存的文件名和路径。
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [active, queryClient, queryKey]);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => listUploadedFiles(threadId, signal),
    enabled: active,
  });

  return active
    ? query
    : {
        ...query,
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
      };
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
