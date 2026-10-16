import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { PROJECTS_QUERY_KEY } from "../projects/api";
import { isStaticWebsiteOnly } from "../static-mode";

import {
  emptyTrash,
  listTrashDocuments,
  purgeTrashDocument,
  restoreTrashDocument,
  TRASH_QUERY_KEY,
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
  enabled = true,
}: { enabled?: boolean } = {}) {
  const active = enabled && !isStaticWebsiteOnly();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (active) return;

    // 撤销项目读取权限后，停止回收站请求并清除先前授权时的列表缓存。
    void queryClient.cancelQueries({ queryKey: TRASH_QUERY_KEY, exact: true });
    queryClient.removeQueries({ queryKey: TRASH_QUERY_KEY, exact: true });
  }, [active, queryClient]);
  const query = useInfiniteQuery<
    TrashListResponse,
    Error,
    InfiniteData<TrashListResponse>,
    readonly unknown[],
    number
  >({
    queryKey: TRASH_QUERY_KEY,
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
    // Static-demo mode has no Gateway; never fire trash requests there.
    enabled: active,
  });
  // Disabled permission queries can still have cached rows from an earlier
  // render. Mask them immediately when the caller revokes read access.
  return active ? query : { ...query, data: undefined };
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
