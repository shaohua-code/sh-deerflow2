import { afterEach, expect, test, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));
const searchThreads = rs.hoisted(() => rs.fn());

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));

rs.mock("@/core/api", () => ({
  getAPIClient: () => ({ threads: { search: searchThreads } }),
}));

import { threadsSearchQueryKey, useThreads } from "@/core/threads/hooks";

// ThreadSearchParams 未导出；用 hook 参数类型取参，让 select 获得上下文推断。
const listParams: NonNullable<Parameters<typeof useThreads>[0]> = {
  limit: 50,
  sortBy: "updated_at",
  sortOrder: "desc",
  select: ["thread_id", "updated_at", "values", "metadata"],
};
const otherParams = { ...listParams, offset: 50 };

const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const rows = (id: string) => [{ thread_id: id, metadata: {} }];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  searchThreads.mockReset();
  authState.userId = "owner-a";
  authState.permissions = null;
});

test("unresolved permissions still fetch the finite thread catalog", async () => {
  authState.permissions = null;
  searchThreads.mockResolvedValue([{ thread_id: "thread-1", metadata: {} }]);
  const { result } = renderHook(() => useThreads(listParams), {
    wrapper: wrapper(),
  });

  await waitFor(() =>
    expect(result.current.data?.[0]?.thread_id).toBe("thread-1"),
  );
  expect(searchThreads).toHaveBeenCalledWith(
    expect.objectContaining({
      signal: expect.any(AbortSignal),
    }),
  );
});

test("explicit threads:read denial hides rows and clears only this owner", async () => {
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  const currentKey = threadsSearchQueryKey("owner-a", listParams, "picker");
  const otherListKey = threadsSearchQueryKey("owner-a", otherParams);
  const otherOwnerKey = threadsSearchQueryKey("owner-b", listParams, "picker");
  client.setQueryData(currentKey, rows("mine"));
  client.setQueryData(otherListKey, rows("mine-offset"));
  client.setQueryData(otherOwnerKey, rows("other"));
  authState.permissions = [];

  const { result } = renderHook(
    () => useThreads(listParams, { cacheScope: "picker" }),
    { wrapper: testWrapper },
  );

  expect(result.current.data).toBeUndefined();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toBeNull();
  await waitFor(() => {
    expect(client.getQueryData(currentKey)).toBeUndefined();
  });
  expect(client.getQueryData(otherListKey)).toBeUndefined();
  expect(client.getQueryData(otherOwnerKey)).toEqual(rows("other"));
  expect(searchThreads).not.toHaveBeenCalled();
});

test("revoking threads:read aborts an in-flight finite thread search", async () => {
  let signal: AbortSignal | undefined;
  searchThreads.mockImplementation((query: { signal?: AbortSignal }) => {
    signal = query.signal;
    return new Promise(() => undefined);
  });
  authState.permissions = ["threads:read"];
  const { result, rerender } = renderHook(() => useThreads(listParams), {
    wrapper: wrapper(),
  });

  await waitFor(() => {
    expect(signal?.aborted).toBe(false);
  });
  authState.permissions = [];
  rerender();

  await waitFor(() => {
    expect(signal?.aborted).toBe(true);
  });
  expect(result.current.data).toBeUndefined();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toBeNull();
});

test("caller enabled false hides rows without removing the owner cache", () => {
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  const key = threadsSearchQueryKey("owner-a", listParams);
  client.setQueryData(key, rows("mine"));
  authState.permissions = ["threads:read"];

  const { result } = renderHook(
    () => useThreads(listParams, { enabled: false }),
    { wrapper: testWrapper },
  );

  expect(result.current.data).toBeUndefined();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toBeNull();
  expect(client.getQueryData(key)).toEqual(rows("mine"));
  expect(searchThreads).not.toHaveBeenCalled();
});
