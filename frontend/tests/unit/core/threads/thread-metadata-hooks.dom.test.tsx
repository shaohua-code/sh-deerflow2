import { afterEach, expect, test, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));
const getThread = rs.hoisted(() => rs.fn());
const fetchThreadSummary = rs.hoisted(() => rs.fn());

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));

rs.mock("@/core/api", () => ({
  getAPIClient: () => ({ threads: { get: getThread } }),
}));
rs.mock("@/core/threads/api", () => ({
  branchThreadFromTurn: rs.fn(),
  fetchThreadSummary,
  fetchThreadTokenUsage: rs.fn(),
  moveThreadToProject: rs.fn(),
  patchThreadMetadata: rs.fn(),
  searchThreadsByArchive: rs.fn(),
}));

import {
  infiniteThreadsQueryKey,
  threadMetadataQueryKey,
  useThreadMetadata,
} from "@/core/threads/hooks";
import { workspaceRecentThreadListParams } from "@/core/threads/workspace-thread-list";

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

const thread = { thread_id: "thread-1", metadata: { title: "Report" } };

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  getThread.mockReset();
  fetchThreadSummary.mockReset();
  authState.userId = "owner-a";
  authState.permissions = null;
});

test("unresolved permissions still fetch thread metadata", async () => {
  authState.permissions = null;
  fetchThreadSummary.mockResolvedValue(thread);
  const { result } = renderHook(() => useThreadMetadata("thread-1"), {
    wrapper: wrapper(),
  });

  await waitFor(() => expect(result.current.data).toEqual(thread));
  expect(fetchThreadSummary).toHaveBeenCalledWith(
    "thread-1",
    expect.any(AbortSignal),
  );
  expect(getThread).not.toHaveBeenCalled();
});

test("shows the sidebar thread while the summary request is still pending", async () => {
  authState.permissions = ["threads:read"];
  fetchThreadSummary.mockImplementation(() => new Promise(() => undefined));
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  const cachedThread = {
    thread_id: "thread-1",
    values: { title: "侧栏标题" },
    metadata: { deerflow_project_id: "project-1" },
  };
  client.setQueryData(
    infiniteThreadsQueryKey("owner-a", workspaceRecentThreadListParams()),
    {
      pages: [[cachedThread]],
      pageParams: [0],
    },
  );

  const { result } = renderHook(() => useThreadMetadata("thread-1"), {
    wrapper: testWrapper,
  });

  expect(result.current.data).toEqual(cachedThread);
  expect(result.current.isPlaceholderData).toBe(true);
});

test("explicit threads:read denial hides data and clears only this owner", async () => {
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  const currentKey = threadMetadataQueryKey("thread-1", "owner-a", false);
  const otherThreadKey = threadMetadataQueryKey("thread-2", "owner-a", false);
  const otherOwnerKey = threadMetadataQueryKey("thread-1", "owner-b", false);
  client.setQueryData(currentKey, thread);
  client.setQueryData(otherThreadKey, {
    thread_id: "thread-2",
    metadata: { title: "Mine" },
  });
  client.setQueryData(otherOwnerKey, {
    thread_id: "thread-1",
    metadata: { title: "Other" },
  });
  authState.permissions = [];

  const { result } = renderHook(() => useThreadMetadata("thread-1"), {
    wrapper: testWrapper,
  });

  expect(result.current.data).toBeUndefined();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toBeNull();
  await waitFor(() => {
    expect(client.getQueryData(currentKey)).toBeUndefined();
  });
  expect(client.getQueryData(otherThreadKey)).toBeUndefined();
  expect(client.getQueryData(otherOwnerKey)).toEqual({
    thread_id: "thread-1",
    metadata: { title: "Other" },
  });
  expect(fetchThreadSummary).not.toHaveBeenCalled();
});

test("revoking threads:read aborts an in-flight metadata read", async () => {
  let signal: AbortSignal | undefined;
  fetchThreadSummary.mockImplementation(
    (_threadId: string, requestSignal?: AbortSignal) => {
      signal = requestSignal;
      return new Promise(() => undefined);
    },
  );
  authState.permissions = ["threads:read"];
  const { result, rerender } = renderHook(() => useThreadMetadata("thread-1"), {
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

test("caller enabled false hides data without removing the owner cache", () => {
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  const key = threadMetadataQueryKey("thread-1", "owner-a", false);
  client.setQueryData(key, thread);
  authState.permissions = ["threads:read"];

  const { result } = renderHook(
    () => useThreadMetadata("thread-1", { enabled: false }),
    { wrapper: testWrapper },
  );

  expect(result.current.data).toBeUndefined();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toBeNull();
  expect(client.getQueryData(key)).toEqual(thread);
  expect(fetchThreadSummary).not.toHaveBeenCalled();
});

test("an unselected thread does not remove the owner cache", () => {
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  const key = threadMetadataQueryKey("thread-1", "owner-a", false);
  client.setQueryData(key, thread);
  authState.permissions = ["threads:read"];

  renderHook(() => useThreadMetadata(null), { wrapper: testWrapper });

  expect(client.getQueryData(key)).toEqual(thread);
  expect(fetchThreadSummary).not.toHaveBeenCalled();
});
