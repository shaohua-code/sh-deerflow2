import { afterEach, expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  fetch: rs.fn(),
  isStatic: rs.fn(() => false),
}));
const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));
rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "/backend" }));
rs.mock("@/core/static-mode", () => ({
  isStaticWebsiteOnly: mocks.isStatic,
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));

import {
  projectConfigQueryKey,
  projectDetailQueryKey,
  projectDocumentsQueryKey,
  projectThreadFilesQueryKey,
  projectThreadsQueryKey,
  projectsListQueryKey,
} from "@/core/projects/api";
import {
  useAttachProjectDocument,
  useDeleteProjectDocument,
  useInfiniteProjectDocuments,
  useInfiniteProjectThreadFiles,
  useInfiniteProjectThreads,
  useProject,
  useProjects,
  useProjectsConfig,
  usePromoteThreadFile,
  useUploadProjectDocument,
} from "@/core/projects/hooks";

const DOCUMENT = {
  id: "doc-1",
  name: "q3-report.pdf",
  size_bytes: 1024,
  sha256: "abc123",
  content_missing: false,
  source_thread_id: null,
  source_kind: null,
  source_name: null,
  created_at: "2026-09-10T00:00:00+00:00",
  updated_at: "2026-09-10T00:00:00+00:00",
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  rs.resetAllMocks();
  mocks.isStatic.mockReturnValue(false);
  authState.userId = "owner-a";
  authState.permissions = null;
});

test("useInfiniteProjectDocuments pages the shelf under the documents key", async () => {
  const client = makeClient();
  mocks.fetch
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          documents: [DOCUMENT],
          total: 3,
          limit: 100,
          offset: 0,
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          documents: [DOCUMENT, DOCUMENT],
          total: 3,
          limit: 100,
          offset: 1,
        }),
      ),
    );
  const { result, unmount } = renderHook(
    () => useInfiniteProjectDocuments("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // total (3) exceeds the loaded count (1): another page exists.
    expect(result.current.hasNextPage).toBe(true);
    const [firstUrl] = mocks.fetch.mock.calls[0] as [string];
    expect(firstUrl).toBe(
      "/backend/api/projects/proj-1/documents?limit=100&offset=0",
    );
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    const [nextUrl] = mocks.fetch.mock.calls[1] as [string];
    expect(nextUrl).toBe(
      "/backend/api/projects/proj-1/documents?limit=100&offset=1",
    );
    // All 3 rows are loaded across the two pages: no further page.
    await waitFor(() =>
      expect(
        result.current.data?.pages.flatMap((page) => page.documents),
      ).toHaveLength(3),
    );
    expect(result.current.hasNextPage).toBe(false);
    expect(
      client.getQueryData(projectDocumentsQueryKey("proj-1", "owner-a")),
    ).toEqual(result.current.data);
  } finally {
    unmount();
    client.clear();
  }
});

test("unresolved permissions still fetch project config", async () => {
  authState.permissions = null;
  const client = makeClient();
  const body = { instructions_max_bytes: 16384, trash_retention_days: 7 };
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify(body)));
  const { result, unmount } = renderHook(
    () => useProjectsConfig({ enabled: true }),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url] = mocks.fetch.mock.calls[0] as [string];
    expect(url).toBe("/backend/api/projects/config");
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(client.getQueryData(projectConfigQueryKey("owner-a"))).toEqual(body);
  } finally {
    unmount();
    client.clear();
  }
});

test("caller-disabled project config does not remove the owner cache", () => {
  const client = makeClient();
  const body = { instructions_max_bytes: 16384, trash_retention_days: 7 };
  const key = projectConfigQueryKey("owner-a");
  client.setQueryData(key, body);

  const { result, unmount } = renderHook(
    () => useProjectsConfig({ enabled: false }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(client.getQueryData(key)).toEqual(body);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("explicit projects:read denial hides config and clears only this owner", async () => {
  const client = makeClient();
  const body = { instructions_max_bytes: 16384, trash_retention_days: 7 };
  const currentKey = projectConfigQueryKey("owner-a");
  const otherOwnerKey = projectConfigQueryKey("owner-b");
  const listKey = projectsListQueryKey("owner-a", "active");
  const detailKey = projectDetailQueryKey("proj-1", "owner-a");
  const threadsKey = projectThreadsQueryKey("proj-1", "owner-a");
  const documentsKey = projectDocumentsQueryKey("proj-1", "owner-a");
  client.setQueryData(currentKey, body);
  client.setQueryData(otherOwnerKey, body);
  client.setQueryData(listKey, [{ id: "proj-1" }]);
  client.setQueryData(detailKey, { id: "proj-1", name: "Mine" });
  client.setQueryData(threadsKey, {
    pages: [[{ thread_id: "t-1" }]],
    pageParams: [0],
  });
  client.setQueryData(documentsKey, {
    pages: [{ documents: [], total: 0, limit: 100, offset: 0 }],
    pageParams: [0],
  });
  authState.permissions = [];

  const { result, unmount } = renderHook(
    () => useProjectsConfig({ enabled: true }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherOwnerKey)).toEqual(body);
    expect(client.getQueryData(listKey)).toEqual([{ id: "proj-1" }]);
    expect(client.getQueryData(detailKey)).toEqual({
      id: "proj-1",
      name: "Mine",
    });
    expect(client.getQueryData(threadsKey)).toEqual({
      pages: [[{ thread_id: "t-1" }]],
      pageParams: [0],
    });
    expect(client.getQueryData(documentsKey)).toEqual({
      pages: [{ documents: [], total: 0, limit: 100, offset: 0 }],
      pageParams: [0],
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("revoking projects:read aborts an in-flight project config read", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["projects:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const { result, rerender, unmount } = renderHook(
    () => useProjectsConfig({ enabled: true }),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});

test("project list and detail queries mask cached data when disabled", () => {
  const client = makeClient();
  const project = {
    id: "proj-1",
    name: "Private project",
    instructions: "private instructions",
    presentation: {},
    status: "active",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  };
  client.setQueryData(projectDetailQueryKey("proj-1", "owner-a"), project);
  client.setQueryData(projectsListQueryKey("owner-a", "active"), [project]);

  const detail = renderHook(() => useProject("proj-1", { enabled: false }), {
    wrapper: wrapperFor(client),
  });
  const list = renderHook(() => useProjects("active", { enabled: false }), {
    wrapper: wrapperFor(client),
  });
  try {
    expect(detail.result.current.data).toBeUndefined();
    expect(detail.result.current.isLoading).toBe(false);
    expect(detail.result.current.error).toBeNull();
    expect(
      client.getQueryData(projectDetailQueryKey("proj-1", "owner-a")),
    ).toEqual(project);
    expect(list.result.current.data).toBeUndefined();
    expect(list.result.current.isLoading).toBe(false);
    expect(list.result.current.error).toBeNull();
    expect(
      client.getQueryData(projectsListQueryKey("owner-a", "active")),
    ).toEqual([project]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    detail.unmount();
    list.unmount();
    client.clear();
  }
});

test("useProject forwards its query cancellation signal to the Gateway", async () => {
  const client = makeClient();
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "proj-1",
        name: "Project",
        instructions: "",
        presentation: {},
        status: "active",
        created_at: "2026-09-10T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
      }),
    ),
  );
  const { result, unmount } = renderHook(() => useProject("proj-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  } finally {
    unmount();
    client.clear();
  }
});

test("unresolved permissions still fetch project detail", async () => {
  authState.permissions = null;
  const client = makeClient();
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ id: "proj-1", name: "Project" })),
  );
  const { result, unmount } = renderHook(() => useProject("proj-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(result.current.data?.id).toBe("proj-1"));
    expect(mocks.fetch).toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("explicit projects:read denial hides detail and clears only this owner", async () => {
  const client = makeClient();
  const project = { id: "proj-1", name: "Mine" };
  const currentKey = projectDetailQueryKey("proj-1", "owner-a");
  const otherProjectKey = projectDetailQueryKey("proj-2", "owner-a");
  const otherOwnerKey = projectDetailQueryKey("proj-1", "owner-b");
  const listKey = projectsListQueryKey("owner-a", "active");
  client.setQueryData(currentKey, project);
  client.setQueryData(otherProjectKey, { id: "proj-2", name: "Also mine" });
  client.setQueryData(otherOwnerKey, { id: "proj-1", name: "Other" });
  client.setQueryData(listKey, [project]);
  authState.permissions = [];

  const { result, unmount } = renderHook(() => useProject("proj-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherProjectKey)).toBeUndefined();
    expect(client.getQueryData(otherOwnerKey)).toEqual({
      id: "proj-1",
      name: "Other",
    });
    expect(client.getQueryData(listKey)).toEqual([project]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("revoking projects:read aborts an in-flight project detail", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["projects:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const { result, rerender, unmount } = renderHook(() => useProject("proj-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});

test("unresolved permissions still fetch project threads", async () => {
  authState.permissions = null;
  const client = makeClient();
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify([{ thread_id: "t-1" }])),
  );
  const { result, unmount } = renderHook(
    () => useInfiniteProjectThreads("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() =>
      expect(result.current.data?.pages[0]?.[0]?.thread_id).toBe("t-1"),
    );
    expect(mocks.fetch).toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("explicit projects or threads read denial hides project threads and clears only this owner", async () => {
  const client = makeClient();
  const page = {
    pages: [[{ thread_id: "t-1" }]],
    pageParams: [0],
  };
  const currentKey = projectThreadsQueryKey("proj-1", "owner-a");
  const otherProjectKey = projectThreadsQueryKey("proj-2", "owner-a");
  const otherOwnerKey = projectThreadsQueryKey("proj-1", "owner-b");
  const listKey = projectsListQueryKey("owner-a", "active");
  const detailKey = projectDetailQueryKey("proj-1", "owner-a");
  client.setQueryData(currentKey, page);
  client.setQueryData(otherProjectKey, page);
  client.setQueryData(otherOwnerKey, page);
  client.setQueryData(listKey, [{ id: "proj-1" }]);
  client.setQueryData(detailKey, { id: "proj-1", name: "Mine" });
  authState.permissions = ["threads:read"];

  const { result, unmount } = renderHook(
    () => useInfiniteProjectThreads("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherProjectKey)).toBeUndefined();
    expect(client.getQueryData(otherOwnerKey)).toEqual(page);
    expect(client.getQueryData(listKey)).toEqual([{ id: "proj-1" }]);
    expect(client.getQueryData(detailKey)).toEqual({
      id: "proj-1",
      name: "Mine",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("revoking threads:read aborts an in-flight project thread list", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["projects:read", "threads:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const { result, rerender, unmount } = renderHook(
    () => useInfiniteProjectThreads("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = ["projects:read"];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});

test("caller-disabled project threads do not remove the owner cache", () => {
  const client = makeClient();
  const page = {
    pages: [[{ thread_id: "t-1" }]],
    pageParams: [0],
  };
  const key = projectThreadsQueryKey("proj-1", "owner-a");
  client.setQueryData(key, page);
  const { result, unmount } = renderHook(
    () => useInfiniteProjectThreads("proj-1", { enabled: false }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(client.getQueryData(key)).toEqual(page);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("useProjects forwards its query cancellation signal to the Gateway", async () => {
  const client = makeClient();
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ projects: [] })));
  const { result, unmount } = renderHook(() => useProjects("active"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  } finally {
    unmount();
    client.clear();
  }
});

test("unresolved permissions still fetch the project list", async () => {
  authState.permissions = null;
  const client = makeClient();
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ projects: [{ id: "proj-1" }] })),
  );
  const { result, unmount } = renderHook(() => useProjects("active"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(result.current.data?.[0]?.id).toBe("proj-1"));
    expect(mocks.fetch).toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("explicit projects:read denial hides the list and clears only this owner", async () => {
  const client = makeClient();
  const currentKey = projectsListQueryKey("owner-a", "active");
  const otherStatusKey = projectsListQueryKey("owner-a", "archived");
  const otherOwnerKey = projectsListQueryKey("owner-b", "active");
  client.setQueryData(currentKey, [{ id: "proj-1", name: "Mine" }]);
  client.setQueryData(otherStatusKey, [{ id: "proj-2", name: "Archived" }]);
  client.setQueryData(otherOwnerKey, [{ id: "proj-3", name: "Other" }]);
  authState.permissions = [];

  const { result, unmount } = renderHook(() => useProjects("active"), {
    wrapper: wrapperFor(client),
  });
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherStatusKey)).toBeUndefined();
    expect(client.getQueryData(otherOwnerKey)).toEqual([
      { id: "proj-3", name: "Other" },
    ]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("revoking projects:read aborts an in-flight project list", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["projects:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const { result, rerender, unmount } = renderHook(
    () => useProjects("active"),
    {
      wrapper: wrapperFor(client),
    },
  );
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});

test("unresolved permissions still fetch project documents", async () => {
  authState.permissions = null;
  const client = makeClient();
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        documents: [DOCUMENT],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    ),
  );
  const { result, unmount } = renderHook(
    () => useInfiniteProjectDocuments("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() =>
      expect(result.current.data?.pages[0]?.documents[0]?.id).toBe("doc-1"),
    );
    expect(mocks.fetch).toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("caller-disabled project documents hide rows without removing the owner cache", async () => {
  const client = makeClient();
  mocks.fetch.mockImplementation(() => new Promise(() => undefined));
  const { result, rerender, unmount } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useInfiniteProjectDocuments("proj-1", { enabled }),
    { initialProps: { enabled: true }, wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    rerender({ enabled: false });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(
      client.getQueryState(projectDocumentsQueryKey("proj-1", "owner-a")),
    ).toBeDefined();
  } finally {
    unmount();
    client.clear();
  }
});

test("explicit projects:read denial hides documents and clears only this owner", async () => {
  const client = makeClient();
  const page = {
    pages: [{ documents: [DOCUMENT], total: 1, limit: 100, offset: 0 }],
    pageParams: [0],
  };
  const currentKey = projectDocumentsQueryKey("proj-1", "owner-a");
  const otherProjectKey = projectDocumentsQueryKey("proj-2", "owner-a");
  const otherOwnerKey = projectDocumentsQueryKey("proj-1", "owner-b");
  const listKey = projectsListQueryKey("owner-a", "active");
  const detailKey = projectDetailQueryKey("proj-1", "owner-a");
  const threadsKey = projectThreadsQueryKey("proj-1", "owner-a");
  client.setQueryData(currentKey, page);
  client.setQueryData(otherProjectKey, page);
  client.setQueryData(otherOwnerKey, page);
  client.setQueryData(listKey, [{ id: "proj-1" }]);
  client.setQueryData(detailKey, { id: "proj-1", name: "Mine" });
  client.setQueryData(threadsKey, {
    pages: [[{ thread_id: "t-1" }]],
    pageParams: [0],
  });
  authState.permissions = [];

  const { result, unmount } = renderHook(
    () => useInfiniteProjectDocuments("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherProjectKey)).toBeUndefined();
    expect(client.getQueryData(otherOwnerKey)).toEqual(page);
    expect(client.getQueryData(listKey)).toEqual([{ id: "proj-1" }]);
    expect(client.getQueryData(detailKey)).toEqual({
      id: "proj-1",
      name: "Mine",
    });
    expect(client.getQueryData(threadsKey)).toEqual({
      pages: [[{ thread_id: "t-1" }]],
      pageParams: [0],
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("revoking projects:read aborts an in-flight project document list", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["projects:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const { result, rerender, unmount } = renderHook(
    () => useInfiniteProjectDocuments("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});

test("disabled project documents keep the seeded owner cache", () => {
  const client = makeClient();
  const page = {
    pages: [{ documents: [DOCUMENT], total: 1, limit: 100, offset: 0 }],
    pageParams: [0],
  };
  const key = projectDocumentsQueryKey("proj-1", "owner-a");
  client.setQueryData(key, page);
  const { result, unmount } = renderHook(
    () => useInfiniteProjectDocuments("proj-1", { enabled: false }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(client.getQueryData(key)).toEqual(page);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("useInfiniteProjectThreadFiles pages the conversation-files view under its key", async () => {
  authState.permissions = null;
  const client = makeClient();
  const body = { groups: [], next_offset: null, truncated: false };
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify(body)));
  const { result, unmount } = renderHook(
    () =>
      useInfiniteProjectThreadFiles("proj-1", {
        thread_limit: 10,
        file_limit: 25,
      }),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url] = mocks.fetch.mock.calls[0] as [string];
    expect(url).toBe(
      "/backend/api/projects/proj-1/thread-files?offset=0&thread_limit=10&file_limit=25",
    );
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.hasNextPage).toBe(false);
    expect(
      client.getQueryData(
        projectThreadFilesQueryKey("proj-1", "owner-a", {
          thread_limit: 10,
          file_limit: 25,
        }),
      ),
    ).toEqual(result.current.data);
  } finally {
    unmount();
    client.clear();
  }
});

test("useInfiniteProjectThreadFiles refetches every retained page on invalidation", async () => {
  const client = makeClient();
  const groupA = {
    thread_id: "t-a",
    display_name: "Chat A",
    updated_at: "2026-09-10T00:00:00Z",
    files: [],
    truncated: false,
  };
  const groupB = {
    thread_id: "t-b",
    display_name: "Chat B",
    updated_at: "2026-09-09T00:00:00Z",
    files: [],
    truncated: false,
  };
  const envelope = (groups: (typeof groupA)[], nextOffset: number | null) => ({
    groups,
    next_offset: nextOffset,
    truncated: false,
  });
  mocks.fetch
    .mockResolvedValueOnce(new Response(JSON.stringify(envelope([groupA], 1))))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(envelope([groupB], null))),
    );
  const { result, unmount } = renderHook(
    () => useInfiniteProjectThreadFiles("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  const urls = () => mocks.fetch.mock.calls.map(([url]) => url as string);
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(urls()).toEqual([
      "/backend/api/projects/proj-1/thread-files?offset=0",
      "/backend/api/projects/proj-1/thread-files?offset=1",
    ]);

    // t-a is moved out of the project between page loads: the shifted
    // boundary now answers page 1 with groupB and page 2 with nothing.
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify(envelope([groupB], 1))),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope([], null))));
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["projects", "thread-files", "proj-1"],
      });
    });
    // BOTH retained pages refetch — never only the current offset.
    await waitFor(() => expect(urls()).toHaveLength(4));
    expect(urls().slice(2)).toEqual([
      "/backend/api/projects/proj-1/thread-files?offset=0",
      "/backend/api/projects/proj-1/thread-files?offset=1",
    ]);
    // The moved-out thread's group is gone, and the shifted boundary did
    // not duplicate the surviving group.
    const groups = result.current.data!.pages.flatMap((page) => page.groups);
    expect(groups.map((group) => group.thread_id)).toEqual(["t-b"]);
  } finally {
    unmount();
    client.clear();
  }
});

test("caller-disabled project thread files hide rows without removing the owner cache", () => {
  const client = makeClient();
  const page = {
    pages: [{ groups: [], next_offset: null, truncated: false }],
    pageParams: [0],
  };
  const key = projectThreadFilesQueryKey("proj-1", "owner-a");
  client.setQueryData(key, page);
  const { result, unmount } = renderHook(
    () => useInfiniteProjectThreadFiles("proj-1", {}, { enabled: false }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(client.getQueryData(key)).toEqual(page);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("explicit denial hides thread files and clears only this owner", async () => {
  const client = makeClient();
  const page = {
    pages: [{ groups: [], next_offset: null, truncated: false }],
    pageParams: [0],
  };
  const currentKey = projectThreadFilesQueryKey("proj-1", "owner-a", {
    thread_limit: 10,
    file_limit: 25,
  });
  const otherOwnerKey = projectThreadFilesQueryKey("proj-1", "owner-b", {
    thread_limit: 10,
    file_limit: 25,
  });
  const listKey = projectsListQueryKey("owner-a", "active");
  const detailKey = projectDetailQueryKey("proj-1", "owner-a");
  const threadsKey = projectThreadsQueryKey("proj-1", "owner-a");
  const documentsKey = projectDocumentsQueryKey("proj-1", "owner-a");
  const configKey = projectConfigQueryKey("owner-a");
  client.setQueryData(currentKey, page);
  client.setQueryData(otherOwnerKey, page);
  client.setQueryData(listKey, [{ id: "proj-1" }]);
  client.setQueryData(detailKey, { id: "proj-1", name: "Mine" });
  client.setQueryData(threadsKey, {
    pages: [[{ thread_id: "t-1" }]],
    pageParams: [0],
  });
  client.setQueryData(documentsKey, page);
  client.setQueryData(configKey, { instructions_max_bytes: 1 });
  // 只授予 projects:read，threads:read 被明确拒绝。
  authState.permissions = ["projects:read"];

  const { result, unmount } = renderHook(
    () =>
      useInfiniteProjectThreadFiles("proj-1", {
        thread_limit: 10,
        file_limit: 25,
      }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherOwnerKey)).toEqual(page);
    expect(client.getQueryData(listKey)).toEqual([{ id: "proj-1" }]);
    expect(client.getQueryData(detailKey)).toEqual({
      id: "proj-1",
      name: "Mine",
    });
    expect(client.getQueryData(threadsKey)).toEqual({
      pages: [[{ thread_id: "t-1" }]],
      pageParams: [0],
    });
    expect(client.getQueryData(documentsKey)).toEqual(page);
    expect(client.getQueryData(configKey)).toEqual({
      instructions_max_bytes: 1,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("revoking projects:read aborts an in-flight thread-files list", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["projects:read", "threads:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const { result, rerender, unmount } = renderHook(
    () => useInfiniteProjectThreadFiles("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = ["threads:read"];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});

test("document queries do not fire in static-demo mode", async () => {
  mocks.isStatic.mockReturnValue(true);
  const client = makeClient();
  const { unmount } = renderHook(
    () => ({
      documents: useInfiniteProjectDocuments("proj-1"),
      threadFiles: useInfiniteProjectThreadFiles("proj-1"),
    }),
    { wrapper: wrapperFor(client) },
  );
  try {
    // Give any (erroneously) enabled query a macrotask to fire.
    await act(async () => {
      // ES2022 lib has no Promise.withResolvers typing; executor form required.
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("useUploadProjectDocument posts multipart and invalidates the projects prefix", async () => {
  const client = makeClient();
  const shelfKey = ["projects", "documents", "proj-1"];
  client.setQueryData(shelfKey, { documents: [], total: 0 });
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ document: DOCUMENT, deduplicated: false }), {
      status: 201,
    }),
  );
  const { result, unmount } = renderHook(
    () => useUploadProjectDocument("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await act(async () => {
      await result.current.mutateAsync({
        file: new File(["hello"], "notes.txt"),
      });
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/backend/api/projects/proj-1/documents");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(client.getQueryState(shelfKey)?.isInvalidated).toBe(true);
  } finally {
    unmount();
    client.clear();
  }
});

test("usePromoteThreadFile posts the from-thread body and invalidates projects", async () => {
  const client = makeClient();
  const shelfKey = ["projects", "documents", "proj-1"];
  client.setQueryData(shelfKey, { documents: [], total: 0 });
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ document: DOCUMENT, deduplicated: false })),
  );
  const { result, unmount } = renderHook(() => usePromoteThreadFile("proj-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await act(async () => {
      await result.current.mutateAsync({
        thread_id: "thread-1",
        kind: "output",
        name: "report.md",
      });
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/backend/api/projects/proj-1/documents/from-thread");
    expect(JSON.parse(init.body as string)).toEqual({
      thread_id: "thread-1",
      kind: "output",
      name: "report.md",
    });
    expect(client.getQueryState(shelfKey)?.isInvalidated).toBe(true);
  } finally {
    unmount();
    client.clear();
  }
});

test("useAttachProjectDocument invalidates projects and threads caches", async () => {
  const client = makeClient();
  const shelfKey = ["projects", "documents", "proj-1"];
  const threadsKey = ["threads", "searchInfinite", {}];
  client.setQueryData(shelfKey, { documents: [], total: 0 });
  client.setQueryData(threadsKey, { pages: [], pageParams: [] });
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        filename: "q3-report.pdf",
        size_bytes: 1024,
        virtual_path: "/mnt/user-data/uploads/q3-report.pdf",
        artifact_url: "/api/threads/thread-1/artifacts/...",
      }),
    ),
  );
  const { result, unmount } = renderHook(
    () => useAttachProjectDocument("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await act(async () => {
      await result.current.mutateAsync({
        documentId: "doc-1",
        threadId: "thread-1",
      });
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/backend/api/projects/proj-1/documents/doc-1/attach-to-thread/thread-1",
    );
    expect(init.method).toBe("POST");
    expect(client.getQueryState(shelfKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(threadsKey)?.isInvalidated).toBe(true);
  } finally {
    unmount();
    client.clear();
  }
});

test("useDeleteProjectDocument deletes and invalidates the projects prefix", async () => {
  const client = makeClient();
  const shelfKey = ["projects", "documents", "proj-1"];
  client.setQueryData(shelfKey, { documents: [], total: 0 });
  mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  const { result, unmount } = renderHook(
    () => useDeleteProjectDocument("proj-1"),
    { wrapper: wrapperFor(client) },
  );
  try {
    await act(async () => {
      await result.current.mutateAsync("doc-1");
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/backend/api/projects/proj-1/documents/doc-1");
    expect(init.method).toBe("DELETE");
    expect(client.getQueryState(shelfKey)?.isInvalidated).toBe(true);
  } finally {
    unmount();
    client.clear();
  }
});
