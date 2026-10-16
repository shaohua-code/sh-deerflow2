import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  user: {
    current: {
      id: "owner-a",
      permissions: ["runs:read"] as string[] | null,
    },
  },
  listRuns: rs.fn(),
  getRun: rs.fn(),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));
rs.mock("@/core/api", () => ({
  getAPIClient: () => ({
    runs: { list: mocks.listRuns, get: mocks.getRun },
  }),
}));
rs.mock("@/core/threads/api", () => ({
  branchThreadFromTurn: rs.fn(),
  fetchThreadTokenUsage: rs.fn(),
  moveThreadToProject: rs.fn(),
  patchThreadMetadata: rs.fn(),
  searchThreadsByArchive: rs.fn(),
}));

import {
  threadRunDetailQueryKey,
  threadRunsQueryKey,
  useRunDetail,
  useThreadRuns,
} from "@/core/threads/hooks";

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
  mocks.user.current = { id: "owner-a", permissions: ["runs:read"] };
});

describe("run read hooks", () => {
  it("hides and clears only the current owner's run caches when runs:read is denied", async () => {
    const client = createClient();
    const listKey = threadRunsQueryKey("thread-1", "owner-a");
    const detailKey = threadRunDetailQueryKey("thread-1", "run-1", "owner-a");
    const otherOwnerKey = threadRunsQueryKey("thread-1", "owner-b");
    client.setQueryData(listKey, [{ run_id: "private-run" }]);
    client.setQueryData(detailKey, { run_id: "private-run" });
    client.setQueryData(otherOwnerKey, [{ run_id: "other-owner-run" }]);
    mocks.user.current.permissions = [];

    const { result } = renderHook(
      () => [useThreadRuns("thread-1"), useRunDetail("thread-1", "run-1")],
      { wrapper: createWrapper(client) },
    );

    expect(result.current[0].data).toBeUndefined();
    expect(result.current[1].data).toBeUndefined();
    expect(mocks.listRuns).not.toHaveBeenCalled();
    expect(mocks.getRun).not.toHaveBeenCalled();
    await waitFor(() => expect(client.getQueryData(listKey)).toBeUndefined());
    expect(client.getQueryData(detailKey)).toBeUndefined();
    expect(client.getQueryData(otherOwnerKey)).toEqual([
      { run_id: "other-owner-run" },
    ]);
    client.clear();
  });

  it("forwards abort signals and separates both queries by owner", async () => {
    const client = createClient();
    const listSignals: AbortSignal[] = [];
    const detailSignals: AbortSignal[] = [];
    mocks.listRuns.mockImplementation(
      (_threadId: string, options: { signal: AbortSignal }) => {
        listSignals.push(options.signal);
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    mocks.getRun.mockImplementation(
      (_threadId: string, _runId: string, options: { signal: AbortSignal }) => {
        detailSignals.push(options.signal);
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );

    const { result, rerender } = renderHook(
      () => [useThreadRuns("thread-1"), useRunDetail("thread-1", "run-1")],
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => {
      expect(listSignals).toHaveLength(1);
      expect(detailSignals).toHaveLength(1);
    });
    expect(result.current[0].data).toBeUndefined();
    expect(result.current[1].data).toBeUndefined();

    mocks.user.current = { id: "owner-b", permissions: ["runs:read"] };
    rerender();

    await waitFor(() => {
      expect(listSignals[0]?.aborted).toBe(true);
      expect(detailSignals[0]?.aborted).toBe(true);
      expect(listSignals).toHaveLength(2);
      expect(detailSignals).toHaveLength(2);
      expect(mocks.listRuns).toHaveBeenCalledTimes(2);
      expect(mocks.getRun).toHaveBeenCalledTimes(2);
    });
    expect(result.current[0].data).toBeUndefined();
    expect(result.current[1].data).toBeUndefined();
    expect(threadRunsQueryKey("thread-1", "owner-a")).not.toEqual(
      threadRunsQueryKey("thread-1", "owner-b"),
    );
    expect(threadRunDetailQueryKey("thread-1", "run-1", "owner-a")).not.toEqual(
      threadRunDetailQueryKey("thread-1", "run-1", "owner-b"),
    );
    client.clear();
  });
});
