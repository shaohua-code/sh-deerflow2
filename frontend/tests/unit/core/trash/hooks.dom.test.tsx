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
  useEmptyTrash,
  useInfiniteTrashDocuments,
  usePurgeDocument,
  useRestoreDocument,
} from "@/core/trash/hooks";
import { trashDocumentsQueryKey } from "@/core/trash/api";

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

test("useInfiniteTrashDocuments pages the trash list under the trash key", async () => {
  authState.permissions = null;
  const client = makeClient();
  const trashed = {
    ...DOCUMENT,
    trashed_at: "2026-09-12T00:00:00+00:00",
    trash_origin: null,
  };
  mocks.fetch
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          documents: [trashed],
          total: 2,
          limit: 100,
          offset: 0,
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          documents: [trashed],
          total: 2,
          limit: 100,
          offset: 1,
        }),
      ),
    );
  const { result, unmount } = renderHook(() => useInfiniteTrashDocuments(), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    const [firstUrl] = mocks.fetch.mock.calls[0] as [string];
    expect(firstUrl).toBe("/backend/api/trash/documents?limit=100&offset=0");
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    const [nextUrl] = mocks.fetch.mock.calls[1] as [string];
    expect(nextUrl).toBe("/backend/api/trash/documents?limit=100&offset=1");
    await waitFor(() =>
      expect(
        result.current.data?.pages.flatMap((page) => page.documents),
      ).toHaveLength(2),
    );
    expect(result.current.hasNextPage).toBe(false);
    expect(client.getQueryData(trashDocumentsQueryKey("owner-a"))).toEqual(
      result.current.data,
    );
  } finally {
    unmount();
    client.clear();
  }
});

test("useInfiniteTrashDocuments does not fire in static-demo mode", async () => {
  mocks.isStatic.mockReturnValue(true);
  const client = makeClient();
  const { unmount } = renderHook(() => useInfiniteTrashDocuments(), {
    wrapper: wrapperFor(client),
  });
  try {
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

test("caller-disabled trash documents hide rows without removing the owner cache", () => {
  const client = makeClient();
  const page = {
    pages: [{ documents: [{ ...DOCUMENT, name: "private.pdf" }] }],
    pageParams: [0],
  };
  const key = trashDocumentsQueryKey("owner-a");
  client.setQueryData(key, page);
  const { result, unmount } = renderHook(
    () => useInfiniteTrashDocuments({ enabled: false }),
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

test("explicit projects:read denial hides trash and clears only this owner", async () => {
  const client = makeClient();
  const page = {
    pages: [{ documents: [{ ...DOCUMENT, name: "private.pdf" }] }],
    pageParams: [0],
  };
  const currentKey = trashDocumentsQueryKey("owner-a");
  const otherOwnerKey = trashDocumentsQueryKey("owner-b");
  client.setQueryData(currentKey, page);
  client.setQueryData(otherOwnerKey, page);
  authState.permissions = [];

  const { result, unmount } = renderHook(() => useInfiniteTrashDocuments(), {
    wrapper: wrapperFor(client),
  });
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherOwnerKey)).toEqual(page);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

test("revoking projects:read aborts an in-flight trash list", async () => {
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
    () => useInfiniteTrashDocuments(),
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

test("useRestoreDocument posts and invalidates trash and projects caches", async () => {
  const client = makeClient();
  const trashKey = ["trash", "documents"];
  const projectsKey = ["projects", "documents", "proj-1"];
  client.setQueryData(trashKey, { documents: [], total: 0 });
  client.setQueryData(projectsKey, { documents: [], total: 0 });
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ outcome: "restored", document: DOCUMENT })),
  );
  const { result, unmount } = renderHook(() => useRestoreDocument(), {
    wrapper: wrapperFor(client),
  });
  try {
    await act(async () => {
      await result.current.mutateAsync({ documentId: "doc-1" });
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/backend/api/trash/documents/doc-1/restore");
    expect(init.method).toBe("POST");
    expect(client.getQueryState(trashKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(projectsKey)?.isInvalidated).toBe(true);
  } finally {
    unmount();
    client.clear();
  }
});

test("usePurgeDocument posts and invalidates trash and projects caches", async () => {
  const client = makeClient();
  const trashKey = ["trash", "documents"];
  const projectsKey = ["projects", "documents", "proj-1"];
  client.setQueryData(trashKey, { documents: [], total: 0 });
  client.setQueryData(projectsKey, { documents: [], total: 0 });
  mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  const { result, unmount } = renderHook(() => usePurgeDocument(), {
    wrapper: wrapperFor(client),
  });
  try {
    await act(async () => {
      await result.current.mutateAsync("doc-1");
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/backend/api/trash/documents/doc-1/purge");
    expect(init.method).toBe("POST");
    expect(client.getQueryState(trashKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(projectsKey)?.isInvalidated).toBe(true);
  } finally {
    unmount();
    client.clear();
  }
});

test("useEmptyTrash posts and invalidates only the trash cache", async () => {
  const client = makeClient();
  const trashKey = ["trash", "documents"];
  const projectsKey = ["projects", "documents", "proj-1"];
  client.setQueryData(trashKey, { documents: [], total: 0 });
  client.setQueryData(projectsKey, { documents: [], total: 0 });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ purged: 2 })));
  const { result, unmount } = renderHook(() => useEmptyTrash(), {
    wrapper: wrapperFor(client),
  });
  try {
    await act(async () => {
      await result.current.mutateAsync();
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/backend/api/trash/purge");
    expect(init.method).toBe("POST");
    expect(client.getQueryState(trashKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(projectsKey)?.isInvalidated).toBe(false);
  } finally {
    unmount();
    client.clear();
  }
});
