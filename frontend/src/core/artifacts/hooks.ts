import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useThread } from "@/components/workspace/messages/context";
import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

import { loadArtifactContent, loadArtifactContentFromToolCall } from "./loader";

const ARTIFACT_QUERY_KEY = ["artifact"] as const;

export function artifactContentQueryKey(
  userId: string | null | undefined,
  filepath: string,
  threadId: string,
  isMock: boolean,
  fullContentRequested: boolean,
) {
  return [
    ...ARTIFACT_QUERY_KEY,
    userId ?? null,
    filepath,
    threadId,
    isMock,
    fullContentRequested,
  ] as const;
}

function useArtifactReadAccess() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // 正式产物 GET 要求 threads:read；权限字段缺失时保持旧 Gateway 兼容。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!accessDenied) return;
    const queryKey = [...ARTIFACT_QUERY_KEY, userId] as const;
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [accessDenied, queryClient, userId]);
  return { userId, accessDenied };
}

export function useArtifactContent({
  filepath,
  threadId,
  enabled,
}: {
  filepath: string;
  threadId: string;
  enabled?: boolean;
}) {
  const isWriteFile = useMemo(() => {
    return filepath.startsWith("write-file:");
  }, [filepath]);
  const { thread, isMock } = useThread();
  const [fullContentSelection, setFullContentSelection] = useState<{
    filepath: string;
    threadId: string;
  } | null>(null);
  const fullContentRequested =
    fullContentSelection?.filepath === filepath &&
    fullContentSelection.threadId === threadId;
  const { userId, accessDenied } = useArtifactReadAccess();
  const content = useMemo(() => {
    if (isWriteFile) {
      return loadArtifactContentFromToolCall({ url: filepath, thread });
    }
    return null;
  }, [filepath, isWriteFile, thread]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: artifactContentQueryKey(
      userId,
      filepath,
      threadId,
      // useThread 上下文的 isMock 是可选布尔；归一后进 queryKey，
      // 保持同一挂载周期内键值稳定（undefined 与 false 等价语义）。
      Boolean(isMock),
      fullContentRequested,
    ),
    queryFn: ({ signal }) => {
      return loadArtifactContent({
        filepath,
        threadId,
        isMock: Boolean(isMock),
        full: fullContentRequested,
        signal,
      });
    },
    enabled: (enabled ?? true) && !accessDenied,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Refetch once when the run settles so edits made during the run are
  // visible without a manual reload.
  const wasLoadingRef = useRef(thread.isLoading);
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = thread.isLoading;
    if (wasLoading && !thread.isLoading && enabled && !isWriteFile) {
      void refetch().catch(() => undefined);
    }
  }, [enabled, isWriteFile, refetch, thread.isLoading]);

  const loadFullContent = useCallback(() => {
    setFullContentSelection({ filepath, threadId });
  }, [filepath, threadId]);

  return {
    // 明确撤权时同一帧隐藏正文，包括仍留在消息里的 write-file 草稿。
    content: accessDenied ? undefined : isWriteFile ? content : data?.content,
    url: accessDenied || isWriteFile ? undefined : data?.url,
    sha256: accessDenied || isWriteFile ? undefined : data?.sha256,
    truncated: accessDenied || isWriteFile ? false : (data?.truncated ?? false),
    previewBytes: accessDenied || isWriteFile ? undefined : data?.previewBytes,
    totalBytes: accessDenied || isWriteFile ? undefined : data?.totalBytes,
    fullContentRequested,
    loadFullContent,
    isLoading: accessDenied ? false : isLoading,
    error: accessDenied ? null : error,
    accessDenied,
  };
}

/**
 * Artifact content for the standalone viewer route.
 *
 * Deliberately separate from ``useArtifactContent``: that hook reads the live
 * thread stream through ``useThread`` so it can refetch when a run settles,
 * and the viewer window has no thread context to read. The query key matches
 * so both share the cache when they happen to run in the same document.
 */
export function useStandaloneArtifactContent({
  filepath,
  threadId,
  isMock = false,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
}) {
  const [fullContentSelection, setFullContentSelection] = useState<{
    filepath: string;
    threadId: string;
  } | null>(null);
  const fullContentRequested =
    fullContentSelection?.filepath === filepath &&
    fullContentSelection.threadId === threadId;
  const { userId, accessDenied } = useArtifactReadAccess();

  const { data, isLoading, error } = useQuery({
    queryKey: artifactContentQueryKey(
      userId,
      filepath,
      threadId,
      isMock,
      fullContentRequested,
    ),
    queryFn: ({ signal }) =>
      loadArtifactContent({
        filepath,
        threadId,
        isMock,
        full: fullContentRequested,
        signal,
      }),
    enabled: !accessDenied,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const loadFullContent = useCallback(() => {
    setFullContentSelection({ filepath, threadId });
  }, [filepath, threadId]);

  return {
    content: accessDenied ? undefined : data?.content,
    url: accessDenied ? undefined : data?.url,
    truncated: accessDenied ? false : (data?.truncated ?? false),
    previewBytes: accessDenied ? undefined : data?.previewBytes,
    totalBytes: accessDenied ? undefined : data?.totalBytes,
    fullContentRequested,
    loadFullContent,
    isLoading: accessDenied ? false : isLoading,
    error: accessDenied ? null : error,
    accessDenied,
  };
}
