import { afterEach, expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({ fetch: rs.fn() }));
const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));
rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "/backend" }));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));

import {
  uploadedFilesQueryKey,
  uploadLimitsQueryKey,
  useUploadedFiles,
  useUploadLimits,
} from "@/core/uploads/hooks";

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
  authState.userId = "owner-a";
  authState.permissions = null;
});

const LIMITS = {
  max_files: 10,
  max_file_size: 1024,
  max_total_size: 4096,
};

test("unresolved permissions still fetch upload limits", async () => {
  authState.permissions = null;
  const client = makeClient();
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(LIMITS)));

  const view = renderHook(() => useUploadLimits("thread-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(
      client.getQueryData(uploadLimitsQueryKey("thread-1", "owner-a")),
    ).toEqual(LIMITS);
  } finally {
    view.unmount();
    client.clear();
  }
});

test("caller-disabled upload limits hide data without removing the owner cache", () => {
  const client = makeClient();
  const key = uploadLimitsQueryKey("thread-1", "owner-a");
  client.setQueryData(key, LIMITS);
  const view = renderHook(
    () => useUploadLimits("thread-1", { enabled: false }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.error).toBeNull();
    expect(client.getQueryData(key)).toEqual(LIMITS);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

test("explicit threads:read denial hides limits and clears only this owner", async () => {
  const client = makeClient();
  const currentKey = uploadLimitsQueryKey("thread-1", "owner-a");
  const otherOwnerKey = uploadLimitsQueryKey("thread-1", "owner-b");
  const listKey = uploadedFilesQueryKey("thread-1", "owner-a");
  client.setQueryData(currentKey, LIMITS);
  client.setQueryData(otherOwnerKey, LIMITS);
  client.setQueryData(listKey, { files: [], count: 0 });
  authState.permissions = [];

  const view = renderHook(() => useUploadLimits("thread-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherOwnerKey)).toEqual(LIMITS);
    expect(client.getQueryData(listKey)).toEqual({ files: [], count: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

test("revoking threads:read aborts an in-flight upload limits read", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["threads:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const view = renderHook(() => useUploadLimits("thread-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    view.rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.error).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});

test("unresolved permissions still fetch the uploaded file list", async () => {
  authState.permissions = null;
  const client = makeClient();
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ files: [], count: 0 })),
  );

  const view = renderHook(() => useUploadedFiles("thread-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(
      client.getQueryData(uploadedFilesQueryKey("thread-1", "owner-a")),
    ).toEqual(view.result.current.data);
  } finally {
    view.unmount();
    client.clear();
  }
});

test("caller-disabled uploaded files hide rows without removing the owner cache", () => {
  const client = makeClient();
  const cached = { files: [{ filename: "a.txt" }], count: 1 };
  const key = uploadedFilesQueryKey("thread-1", "owner-a");
  client.setQueryData(key, cached);
  const view = renderHook(
    () => useUploadedFiles("thread-1", { enabled: false }),
    { wrapper: wrapperFor(client) },
  );
  try {
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.error).toBeNull();
    expect(client.getQueryData(key)).toEqual(cached);
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

test("explicit threads:read denial hides uploads and clears only this owner", async () => {
  const client = makeClient();
  const cached = { files: [{ filename: "a.txt" }], count: 1 };
  const currentKey = uploadedFilesQueryKey("thread-1", "owner-a");
  const otherOwnerKey = uploadedFilesQueryKey("thread-1", "owner-b");
  const limitsKey = ["uploads", "limits", "thread-1"] as const;
  client.setQueryData(currentKey, cached);
  client.setQueryData(otherOwnerKey, cached);
  client.setQueryData(limitsKey, { max_files: 10 });
  authState.permissions = [];

  const view = renderHook(() => useUploadedFiles("thread-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherOwnerKey)).toEqual(cached);
    expect(client.getQueryData(limitsKey)).toEqual({ max_files: 10 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

test("revoking threads:read aborts an in-flight uploaded file list", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["threads:read"];
  mocks.fetch.mockImplementation(
    (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
  );
  const client = makeClient();
  const view = renderHook(() => useUploadedFiles("thread-1"), {
    wrapper: wrapperFor(client),
  });
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    view.rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.error).toBeNull();
  } finally {
    view.unmount();
    client.clear();
  }
});
