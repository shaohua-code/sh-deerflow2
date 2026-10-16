import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  fetchUsage: rs.fn(),
  user: {
    current: {
      id: "owner-a",
      permissions: ["threads:read"] as string[] | null,
    },
  },
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));

rs.mock("@/core/threads/api", () => ({
  branchThreadFromTurn: rs.fn(),
  fetchThreadTokenUsage: mocks.fetchUsage,
  moveThreadToProject: rs.fn(),
  patchThreadMetadata: rs.fn(),
  searchThreadsByArchive: rs.fn(),
}));

import { useThreadTokenUsage } from "@/core/threads/hooks";
import { threadTokenUsageQueryKey } from "@/core/threads/token-usage";
import type { ThreadTokenUsageResponse } from "@/core/threads/types";

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function usage(
  threadId: string,
  totalTokens: number,
): ThreadTokenUsageResponse {
  return {
    thread_id: threadId,
    total_input_tokens: totalTokens,
    total_output_tokens: 0,
    total_tokens: totalTokens,
    total_runs: 1,
    by_model: {},
    by_caller: { lead_agent: totalTokens, subagent: 0, middleware: 0 },
  };
}

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

afterEach(() => {
  cleanup();
  mocks.fetchUsage.mockReset();
  mocks.user.current = { id: "owner-a", permissions: ["threads:read"] };
});

describe("useThreadTokenUsage permission and owner boundary", () => {
  it("hides and clears the current owner's cache when threads:read is denied", async () => {
    const client = createClient();
    const cached = usage("thread-1", 41);
    const key = threadTokenUsageQueryKey("thread-1", "owner-a");
    const otherThreadKey = threadTokenUsageQueryKey("thread-2", "owner-a");
    const otherOwnerKey = threadTokenUsageQueryKey("thread-1", "owner-b");
    client.setQueryData(key, cached);
    client.setQueryData(otherThreadKey, usage("thread-2", 72));
    client.setQueryData(otherOwnerKey, usage("thread-1", 88));
    mocks.user.current.permissions = [];

    const { result } = renderHook(() => useThreadTokenUsage("thread-1"), {
      wrapper: createWrapper(client),
    });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
    expect(client.getQueryData(otherThreadKey)).toBeUndefined();
    expect(client.getQueryData(otherOwnerKey)).toEqual(usage("thread-1", 88));
    expect(mocks.fetchUsage).not.toHaveBeenCalled();
    client.clear();
  });

  it("hides cached usage whenever the caller disables the query", () => {
    const client = createClient();
    client.setQueryData(
      threadTokenUsageQueryKey("thread-1", "owner-a"),
      usage("thread-1", 41),
    );

    const { result } = renderHook(
      () => useThreadTokenUsage("thread-1", { enabled: false }),
      { wrapper: createWrapper(client) },
    );

    expect(result.current.data).toBeUndefined();
    expect(mocks.fetchUsage).not.toHaveBeenCalled();
    client.clear();
  });

  it("aborts an in-flight usage read after permission is withdrawn", async () => {
    const client = createClient();
    let requestSignal: AbortSignal | undefined;
    mocks.fetchUsage.mockImplementation(
      (_threadId: string, signal?: AbortSignal) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );

    const { result, rerender } = renderHook(
      () => useThreadTokenUsage("thread-1"),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(requestSignal).toBeDefined());
    mocks.user.current.permissions = [];
    rerender();

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    await waitFor(() =>
      expect(
        client.getQueryData(threadTokenUsageQueryKey("thread-1", "owner-a")),
      ).toBeUndefined(),
    );
    expect(result.current.data).toBeUndefined();
    expect(mocks.fetchUsage).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it("does not show the previous owner's placeholder after an account switch", async () => {
    const client = createClient();
    let resolveOwnerB: ((value: ThreadTokenUsageResponse) => void) | undefined;
    mocks.fetchUsage.mockImplementation((threadId: string) => {
      if (mocks.user.current.id === "owner-a") {
        return Promise.resolve(usage(threadId, 10));
      }
      return new Promise((resolve) => {
        resolveOwnerB = resolve;
      });
    });

    const { result, rerender } = renderHook(
      () => useThreadTokenUsage("thread-1"),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(result.current.data?.total_tokens).toBe(10));

    mocks.user.current = { id: "owner-b", permissions: ["threads:read"] };
    rerender();
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(resolveOwnerB).toBeDefined());

    resolveOwnerB?.(usage("thread-1", 99));
    await waitFor(() => expect(result.current.data?.total_tokens).toBe(99));
    expect(
      client.getQueryData(threadTokenUsageQueryKey("thread-1", "owner-a")),
    ).toMatchObject({ total_tokens: 10 });
    client.clear();
  });
});
