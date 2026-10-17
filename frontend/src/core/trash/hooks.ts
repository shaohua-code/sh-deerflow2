import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "../auth/permissions";
import { PROJECTS_QUERY_KEY } from "../projects/api";
import { isStaticWebsiteOnly } from "../static-mode";

import {
  emptyTrash,
  isOwnerTrashDocumentsQuery,
  listTrashDocuments,
  purgeTrashDocument,
  restoreTrashDocument,
  TRASH_QUERY_KEY,
  trashDocumentsQueryKey,
  type TrashListResponse,
} from "./api";
import type { EmptyTrashResult, RestoreDocumentResult } from "./types";

/**
 * Invalidate trash and project queries. Restore re-points a document onto a
 * project shelf (and ``merged`` deletes the trash row), so both surfaces
 * change together.
 */
function invalidateTrashCaches(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: TRASH_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
}

export const TRASH_DOCUMENTS_PAGE_SIZE = 100;

/**
 * Infinite trash list. The response envelope carries ``total``, so
 * ``hasNextPage`` is exact; the view flattens pages and offers a Load-more
 * button (same convention as the project shelf).
 */
export function useInfiniteTrashDocuments({
  enabled,
}: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/trash/documents 要求 projects:read 与项目集合 data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !isStaticWebsiteOnly();
  const queryKey = trashDocumentsQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的回收站。调用方停用不能清空该账号缓存，也不能波及其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerTrashDocumentsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useInfiniteQuery<
    TrashListResponse,
    Error,
    InfiniteData<TrashListResponse>,
    readonly unknown[],
    number
  >({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listTrashDocuments({
        limit: TRASH_DOCUMENTS_PAGE_SIZE,
        offset: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.documents.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled && !accessDenied,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的回收站列表。
  if (!callerEnabled || accessDenied) {
    return {
      ...query,
      data: undefined,
      isLoading: false,
      error: null,
    };
  }
  return query;
}

export function useRestoreDocument() {
  const queryClient = useQueryClient();
  return useMutation<
    RestoreDocumentResult,
    Error,
    { documentId: string; projectId?: string }
  >({
    mutationFn: ({ documentId, projectId }) =>
      restoreTrashDocument(documentId, { projectId }),
    onSettled() {
      invalidateTrashCaches(queryClient);
    },
  });
}

export function usePurgeDocument() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (documentId) => purgeTrashDocument(documentId),
    onSettled() {
      invalidateTrashCaches(queryClient);
    },
  });
}

export function useEmptyTrash() {
  const queryClient = useQueryClient();
  return useMutation<EmptyTrashResult, Error, void>({
    mutationFn: () => emptyTrash(),
    onSettled() {
      // Purging trash rows changes no project shelf; only the trash list.
      void queryClient.invalidateQueries({ queryKey: TRASH_QUERY_KEY });
    },
  });
}
