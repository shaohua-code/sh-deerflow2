import {
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "../auth/permissions";
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
  isOwnerProjectDetailQuery,
  isOwnerProjectListQuery,
  isOwnerProjectConfigQuery,
  isOwnerProjectDocumentsQuery,
  isOwnerProjectThreadFilesQuery,
  isOwnerProjectThreadsQuery,
  projectConfigQueryKey,
  projectDetailQueryKey,
  projectDocumentsQueryKey,
  projectThreadFilesQueryKey,
  projectThreadsQueryKey,
  projectsListQueryKey,
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

export function useProjects(
  status?: ProjectStatus,
  { enabled }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/projects 只要求 projects:read；权限字段缺失时继续请求，不能把未知当成拒绝。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !isStaticWebsiteOnly();
  const queryKey = projectsListQueryKey(userId, status);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的项目列表。调用方停用不能清空该账号缓存，也不能波及其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectListQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery<Project[]>({
    queryKey,
    queryFn: ({ signal }) => listProjects(status, { signal }),
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled && !accessDenied,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的项目行。
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

/**
 * Server-configured projects limits (``GET /api/projects/config``). Callers
 * fall back to ``PROJECTS_CONFIG_DEFAULT`` while loading or on error — older
 * gateways 404 the endpoint, so ``retry: false`` avoids spending the default
 * retry backoff before the fallback kicks in. Callers must pass the current
 * ``projects:read`` grant so revocation can cancel the request and clear cache.
 */
export function useProjectsConfig({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/projects/config 只要求 projects:read；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied";
  const queryClient = useQueryClient();
  // 调用方必须传入读取状态。停用只隐藏，不能清空该账号缓存。
  const callerEnabled = enabled && !isStaticWebsiteOnly();
  const queryKey = projectConfigQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的项目配置，不能波及列表、详情、会话、资料或其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectConfigQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery<ProjectsConfig>({
    queryKey,
    queryFn: ({ signal }) => getProjectsConfig({ signal }),
    retry: false,
    // Config changes only via server redeploy; a stale read is harmless next
    // to the 422 guard of last resort.
    staleTime: 5 * 60_000,
    enabled: callerEnabled && !accessDenied,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的项目配置。
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

export function useProject(
  id: string,
  { enabled }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/projects/{id} 要求 projects:read 与项目归属；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !isStaticWebsiteOnly();
  const queryKey = projectDetailQueryKey(id, userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的项目详情。调用方停用不能清空该账号缓存，也不能波及其他 owner 或项目列表。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectDetailQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const query = useQuery<Project>({
    queryKey,
    queryFn: ({ signal }) => getProject(id, { signal }),
    // A deleted or foreign project 404s deterministically and the page has a
    // dedicated not-found state for it; do not spend the default retry
    // backoff (~7s) in "loading" first. Matches useThreadMetadata /
    // useThreadTokenUsage.
    retry: false,
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled && !accessDenied,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的项目详情。
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

export const PROJECT_THREADS_PAGE_SIZE = 100;

/**
 * Project-keyed infinite thread list. Keying the accumulation on the project
 * id fences pagination: an older-page response can only land in the query it
 * was issued for, and a first-page invalidation refetches through TanStack
 * instead of racing manual offset state.
 */
export function useInfiniteProjectThreads(
  id: string,
  { enabled }: { enabled?: boolean } = {},
): ProjectThreadsQueryResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/projects/{id}/threads 同时要求 projects:read 与 threads:read；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied" ||
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !isStaticWebsiteOnly();
  const queryKey = projectThreadsQueryKey(id, userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的项目会话。调用方停用不能清空该账号缓存，也不能波及列表、详情或其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectThreadsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

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
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled && !accessDenied,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的项目会话。
  if (!callerEnabled || accessDenied) {
    return {
      ...query,
      data: undefined,
      isLoading: false,
      error: null,
    } as ProjectThreadsQueryResult;
  }
  return query;
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
  { enabled }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/projects/{id}/documents 要求 projects:read、项目归属与 data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !isStaticWebsiteOnly();
  const queryKey = projectDocumentsQueryKey(projectId, userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的项目资料。调用方停用不能清空该账号缓存，也不能波及列表、详情、会话或其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectDocumentsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

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
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled && !accessDenied,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的项目资料。
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
  { enabled }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/projects/{id}/thread-files 同时要求 projects:read 与 threads:read，并校验项目归属与两项 data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.PROJECTS_READ) === "denied" ||
    getPermissionState(user, PERMISSIONS.THREADS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !isStaticWebsiteOnly();
  const queryKey = projectThreadFilesQueryKey(projectId, userId, {
    thread_limit,
    file_limit,
  });

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的会话文件。调用方停用不能清空该账号缓存，也不能波及列表、详情、会话、资料、配置或其他 owner。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerProjectThreadFilesQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

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
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled && !accessDenied,
  });
  // 明确撤权或调用方停用时，同一帧不返回仍留在缓存里的会话文件。
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
