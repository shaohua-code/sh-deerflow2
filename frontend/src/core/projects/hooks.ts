import {
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { isStaticWebsiteOnly } from "../static-mode";
import { INFINITE_THREADS_QUERY_KEY_PREFIX } from "../threads/hooks";

import {
  archiveProject,
  attachProjectDocument,
  createProject,
  deleteProject,
  deleteProjectDocument,
  getProject,
  getProjectsConfig,
  listProjectDocuments,
  listProjects,
  listProjectThreadFiles,
  listProjectThreads,
  patchProject,
  PROJECTS_QUERY_KEY,
  promoteThreadFile,
  restoreProject,
  uploadProjectDocument,
  type ProjectDocumentListResponse,
  type ProjectDocumentUploadResponse,
  type ProjectsConfig,
  type ProjectThreadFilesResponse,
} from "./api";
import type {
  AttachProjectDocumentResult,
  Project,
  ProjectCreateInput,
  ProjectPatchInput,
  ProjectStatus,
  ProjectThread,
  PromoteThreadFileInput,
} from "./types";

/**
 * Invalidate project queries. Archive/restore/delete change how member threads
 * group in the sidebar, so those mutations also invalidate the infinite threads
 * search cache via ``includeThreads``.
 */
function invalidateProjectCaches(
  queryClient: QueryClient,
  { includeThreads = false }: { includeThreads?: boolean } = {},
) {
  void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
  if (includeThreads) {
    void queryClient.invalidateQueries({
      queryKey: INFINITE_THREADS_QUERY_KEY_PREFIX,
    });
  }
}

/**
 * Stop a permission-scoped read and discard its cached result as soon as its
 * owner disables the query. The returned hook data is masked synchronously;
 * this effect also prevents a later permission grant from reviving old rows.
 */
function useClearQueryWhenInactive(
  queryKey: readonly unknown[],
  active: boolean,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (active) return;

    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.removeQueries({ queryKey, exact: true });
  }, [active, queryClient, queryKey]);
}

export function useProjects(
  status?: ProjectStatus,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const active = enabled && !isStaticWebsiteOnly();
  const queryKey = useMemo(
    () => [...PROJECTS_QUERY_KEY, { status }] as const,
    [status],
  );
  const query = useQuery<Project[]>({
    queryKey,
    queryFn: ({ signal }) => listProjects(status, { signal }),
    // Static-demo mode has no Gateway; never fire project requests there.
    enabled: active,
  });
  // A disabled query can still hold an earlier successful result in cache.
  // Never expose that result after a permission revocation.
  return active ? query : { ...query, data: undefined };
}

const PROJECTS_CONFIG_QUERY_KEY = [...PROJECTS_QUERY_KEY, "config"] as const;

/**
 * Server-configured projects limits (``GET /api/projects/config``). Callers
 * fall back to ``PROJECTS_CONFIG_DEFAULT`` while loading or on error — older
 * gateways 404 the endpoint, so ``retry: false`` avoids spending the default
 * retry backoff before the fallback kicks in. Callers must pass the current
 * ``projects:read`` grant so revocation can cancel the request and clear cache.
 */
export function useProjectsConfig({ enabled }: { enabled: boolean }) {
  const active = enabled && !isStaticWebsiteOnly();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (active) return;

    // 撤销 projects:read 后取消配置读取并清掉旧查询，避免继续展示或复用授权前结果。
    void queryClient.cancelQueries({
      queryKey: PROJECTS_CONFIG_QUERY_KEY,
      exact: true,
    });
    queryClient.removeQueries({
      queryKey: PROJECTS_CONFIG_QUERY_KEY,
      exact: true,
    });
  }, [active, queryClient]);

  const query = useQuery<ProjectsConfig>({
    queryKey: PROJECTS_CONFIG_QUERY_KEY,
    queryFn: ({ signal }) => getProjectsConfig({ signal }),
    retry: false,
    // Config changes only via server redeploy; a stale read is harmless next
    // to the 422 guard of last resort.
    staleTime: 5 * 60_000,
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

export function useProject(
  id: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const active = enabled && !isStaticWebsiteOnly();
  const queryKey = useMemo(
    () => [...PROJECTS_QUERY_KEY, "detail", id] as const,
    [id],
  );
  useClearQueryWhenInactive(queryKey, active);
  const query = useQuery<Project>({
    queryKey,
    queryFn: ({ signal }) => getProject(id, { signal }),
    // A deleted or foreign project 404s deterministically and the page has a
    // dedicated not-found state for it; do not spend the default retry
    // backoff (~7s) in "loading" first. Matches useThreadMetadata /
    // useThreadTokenUsage.
    retry: false,
    enabled: active,
  });
  return active ? query : { ...query, data: undefined };
}

export const PROJECT_THREADS_PAGE_SIZE = 100;

/**
 * Project-keyed infinite thread list. Keying the accumulation on the project
 * id fences pagination: an older-page response can only land in the query it
 * was issued for, and a first-page invalidation refetches through TanStack
 * instead of racing manual offset state.
 */
export function useInfiniteProjectThreads(
  id: string,
  { enabled = true }: { enabled?: boolean } = {},
): ProjectThreadsQueryResult {
  const active = enabled && !isStaticWebsiteOnly();
  const queryKey = useMemo(
    () => [...PROJECTS_QUERY_KEY, "threads", id] as const,
    [id],
  );
  useClearQueryWhenInactive(queryKey, active);
  const query = useInfiniteQuery<
    ProjectThread[],
    Error,
    InfiniteData<ProjectThread[]>,
    readonly unknown[],
    number
  >({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listProjectThreads(id, {
        limit: PROJECT_THREADS_PAGE_SIZE,
        offset: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PROJECT_THREADS_PAGE_SIZE
        ? allPages.reduce((total, page) => total + page.length, 0)
        : undefined,
    enabled: active,
  });
  return active
    ? query
    : ({ ...query, data: undefined } as ProjectThreadsQueryResult);
}

export type ProjectThreadsQueryResult = UseInfiniteQueryResult<
  InfiniteData<ProjectThread[]>,
  Error
>;

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectCreateInput) => createProject(input),
    onSettled() {
      invalidateProjectCaches(queryClient);
    },
  });
}

export function usePatchProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      input,
    }: {
      projectId: string;
      input: ProjectPatchInput;
    }) => patchProject(projectId, input),
    onSettled() {
      invalidateProjectCaches(queryClient);
    },
  });
}

export function useArchiveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => archiveProject(projectId),
    onSettled() {
      invalidateProjectCaches(queryClient, { includeThreads: true });
    },
  });
}

export function useRestoreProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => restoreProject(projectId),
    onSettled() {
      invalidateProjectCaches(queryClient, { includeThreads: true });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSettled() {
      invalidateProjectCaches(queryClient, { includeThreads: true });
    },
  });
}

export const PROJECT_DOCUMENTS_PAGE_SIZE = 100;

/**
 * Project-keyed infinite shelf list. The response envelope carries ``total``,
 * so ``hasNextPage`` is exact; the shelf flattens pages and offers a
 * Load-more button (same convention as ``useInfiniteProjectThreads``).
 */
export function useInfiniteProjectDocuments(
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const active = enabled && !isStaticWebsiteOnly();
  const queryKey = useMemo(
    () => [...PROJECTS_QUERY_KEY, "documents", projectId] as const,
    [projectId],
  );
  useClearQueryWhenInactive(queryKey, active);
  const query = useInfiniteQuery<
    ProjectDocumentListResponse,
    Error,
    InfiniteData<ProjectDocumentListResponse>,
    readonly unknown[],
    number
  >({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listProjectDocuments(projectId, {
        limit: PROJECT_DOCUMENTS_PAGE_SIZE,
        offset: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.documents.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: active,
  });
  return active ? query : { ...query, data: undefined };
}

/**
 * Project-keyed infinite conversation-files view. The envelope carries the
 * member-thread cursor ``next_offset``, so ``hasNextPage`` comes straight
 * from it; the browser flattens pages and offers a Load-more button (same
 * convention as ``useInfiniteProjectDocuments``). Unlike a manually
 * accumulated page map, every retained page stays subscribed: invalidation
 * or window-focus refetch refreshes them all, so a moved/deleted member
 * thread cannot leave a stale group behind and a shifted page boundary
 * cannot duplicate groups.
 */
export function useInfiniteProjectThreadFiles(
  projectId: string,
  {
    thread_limit,
    file_limit,
  }: { thread_limit?: number; file_limit?: number } = {},
  { enabled = true }: { enabled?: boolean } = {},
) {
  const active = enabled && !isStaticWebsiteOnly();
  const queryKey = useMemo(
    () =>
      [
        ...PROJECTS_QUERY_KEY,
        "thread-files",
        projectId,
        { thread_limit, file_limit },
      ] as const,
    [file_limit, projectId, thread_limit],
  );
  useClearQueryWhenInactive(queryKey, active);
  const query = useInfiniteQuery<
    ProjectThreadFilesResponse,
    Error,
    InfiniteData<ProjectThreadFilesResponse>,
    readonly unknown[],
    number
  >({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listProjectThreadFiles(projectId, {
        offset: pageParam,
        thread_limit,
        file_limit,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    // Static-demo mode has no Gateway; never fire project requests there.
    enabled: active,
  });
  return active ? query : { ...query, data: undefined };
}

export function useUploadProjectDocument(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectDocumentUploadResponse,
    Error,
    { file: File; name?: string }
  >({
    mutationFn: (input) => uploadProjectDocument(projectId, input),
    onSettled() {
      invalidateProjectCaches(queryClient);
    },
  });
}

export function usePromoteThreadFile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectDocumentUploadResponse,
    Error,
    PromoteThreadFileInput
  >({
    mutationFn: (input) => promoteThreadFile(projectId, input),
    onSettled() {
      invalidateProjectCaches(queryClient);
    },
  });
}

export function useAttachProjectDocument(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    AttachProjectDocumentResult,
    Error,
    { documentId: string; threadId: string }
  >({
    mutationFn: ({ documentId, threadId }) =>
      attachProjectDocument(projectId, documentId, threadId),
    onSettled() {
      // The shelf read does not change, but the target thread's uploads did.
      invalidateProjectCaches(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useDeleteProjectDocument(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (documentId) => deleteProjectDocument(projectId, documentId),
    onSettled() {
      invalidateProjectCaches(queryClient);
    },
  });
}
