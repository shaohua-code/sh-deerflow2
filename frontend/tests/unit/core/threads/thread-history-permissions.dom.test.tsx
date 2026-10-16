import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

rs.mock("@/core/threads/api", () => ({
  branchThreadFromTurn: rs.fn(),
  fetchThreadTokenUsage: rs.fn(),
  moveThreadToProject: rs.fn(),
  patchThreadMetadata: rs.fn(),
  searchThreadsByArchive: rs.fn(),
}));

import { useThreadHistory, threadHistoryQueryKey } from "@/core/threads/hooks";

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
});

describe("useThreadHistory runs:read gate", () => {
  it("does not request or expose a cached history page when runs:read is denied", async () => {
    const client = createClient();
    const key = threadHistoryQueryKey("thread-1");
    const cachedHistory = {
      pages: [
        {
          data: [
            {
              run_id: "run-1",
              seq: 1,
              content: {
                type: "human",
                id: "private-history-row",
                content: "private conversation",
              },
              metadata: { caller: "lead_agent" },
              created_at: "2026-10-15T00:00:00Z",
            },
          ],
          has_more: false,
          next_before_seq: null,
        },
      ],
      pageParams: [null],
    };
    client.setQueryData(key, cachedHistory);
    client.setQueryData(threadHistoryQueryKey("thread-2"), cachedHistory);
    const fetchMock = rs.spyOn(globalThis, "fetch");

    const { result } = renderHook(
      () => useThreadHistory("thread-1", { permissionDenied: true }),
      { wrapper: createWrapper(client) },
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.permissionDenied).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
    expect(
      client.getQueryData(threadHistoryQueryKey("thread-2")),
    ).toBeUndefined();
    client.clear();
  });

  it("keeps reading for older Gateways that do not return a permission snapshot", async () => {
    const client = createClient();
    const fetchMock = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [], has_more: false, next_before_seq: null }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );

    const { result } = renderHook(() => useThreadHistory("thread-1"), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.permissionDenied).toBe(false);
    expect(result.current.messages).toEqual([]);
    client.clear();
  });

  it("aborts a history request and hides rows immediately when runs:read is revoked", async () => {
    const client = createClient();
    let permissionDenied = false;
    let requestSignal: AbortSignal | undefined;
    rs.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal | undefined;
          requestSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const { result, rerender } = renderHook(
      () => useThreadHistory("thread-1", { permissionDenied }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(requestSignal).toBeDefined());

    permissionDenied = true;
    rerender();

    expect(result.current.messages).toEqual([]);
    expect(result.current.permissionDenied).toBe(true);
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    await waitFor(() =>
      expect(
        client.getQueryData(threadHistoryQueryKey("thread-1")),
      ).toBeUndefined(),
    );
    client.clear();
  });
});
