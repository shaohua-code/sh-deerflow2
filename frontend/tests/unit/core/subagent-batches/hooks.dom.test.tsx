import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  control: rs.fn(),
  fetchItems: rs.fn(),
  fetchBatches: rs.fn(),
  retry: rs.fn(),
  toastError: rs.fn(),
}));

rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
rs.mock("@/core/subagent-batches/api", () => ({
  controlSubagentBatch: mocks.control,
  fetchSubagentBatchItems: mocks.fetchItems,
  fetchSubagentBatches: mocks.fetchBatches,
  retrySubagentBatchItem: mocks.retry,
}));

import { I18nProvider } from "@/core/i18n/context";
import {
  subagentBatchItemsKey,
  subagentBatchesKey,
  useControlSubagentBatch,
  useRetrySubagentBatchItem,
  useSubagentBatchItems,
  useSubagentBatches,
} from "@/core/subagent-batches/hooks";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale="en-US">{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  return { client, Wrapper };
}

afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
  mocks.control.mockReset();
  mocks.fetchItems.mockReset();
  mocks.fetchBatches.mockReset();
  mocks.retry.mockReset();
  mocks.toastError.mockReset();
});

describe("subagent batch mutation error copy", () => {
  it("does not expose backend details when controlling a batch fails", async () => {
    mocks.control.mockRejectedValue(new Error("private batch database detail"));
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useControlSubagentBatch("thread-1", { enabled: true }),
      { wrapper: Wrapper },
    );

    act(() => {
      void result.current.mutate({
        batchId: "batch-1",
        action: "pause",
        cacheScope: "user-1",
      });
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to update subagent batch",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private batch database detail",
    );
    client.clear();
  });

  it("does not expose backend details when retrying an item fails", async () => {
    mocks.retry.mockRejectedValue(new Error("private retry backend detail"));
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useRetrySubagentBatchItem("thread-1", "batch-1", { enabled: true }),
      { wrapper: Wrapper },
    );

    act(() => {
      void result.current.mutate({ itemId: "item-1", cacheScope: "user-1" });
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to retry batch item",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private retry backend detail",
    );
    client.clear();
  });
});

describe("subagent batch read permissions", () => {
  it("passes React Query cancellation signals to authorized batch reads", async () => {
    mocks.fetchBatches.mockResolvedValueOnce([]);
    mocks.fetchItems.mockResolvedValueOnce([]);
    const { client, Wrapper } = createWrapper();
    const batches = renderHook(
      () =>
        useSubagentBatches("thread-1", {
          enabled: true,
          polling: false,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    const items = renderHook(
      () =>
        useSubagentBatchItems("thread-1", "batch-1", {
          enabled: true,
          polling: false,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    try {
      await waitFor(() => {
        expect(batches.result.current.isSuccess).toBe(true);
        expect(items.result.current.isSuccess).toBe(true);
      });
      expect(mocks.fetchBatches.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
      expect(mocks.fetchItems.mock.calls[0]?.[2]?.signal).toBeInstanceOf(
        AbortSignal,
      );
    } finally {
      batches.unmount();
      items.unmount();
      client.clear();
    }
  });

  it("hides and removes batch and paged-item caches when threads:read is denied", async () => {
    const { client, Wrapper } = createWrapper();
    client.setQueryData(subagentBatchesKey("thread-1", "user-1"), [
      { id: "private" },
    ]);
    client.setQueryData(
      subagentBatchItemsKey("thread-1", "batch-1", "user-1"),
      {
        pages: [[{ id: "private-item" }]],
        pageParams: [0],
      },
    );
    const batches = renderHook(
      () =>
        useSubagentBatches("thread-1", {
          enabled: false,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    const items = renderHook(
      () =>
        useSubagentBatchItems("thread-1", "batch-1", {
          enabled: false,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    try {
      expect(batches.result.current.data).toBeUndefined();
      expect(items.result.current.data).toBeUndefined();
      await waitFor(() => {
        expect(
          client.getQueryData(subagentBatchesKey("thread-1", "user-1")),
        ).toBe(undefined);
        expect(
          client.getQueryData(
            subagentBatchItemsKey("thread-1", "batch-1", "user-1"),
          ),
        ).toBeUndefined();
      });
      expect(mocks.fetchBatches).not.toHaveBeenCalled();
      expect(mocks.fetchItems).not.toHaveBeenCalled();
    } finally {
      batches.unmount();
      items.unmount();
      client.clear();
    }
  });

  it("does not reuse a thread's batch cache across authenticated users", async () => {
    const { client, Wrapper } = createWrapper();
    client.setQueryData(subagentBatchesKey("thread-1", "user-a"), [
      { id: "private-to-a" },
    ]);
    mocks.fetchBatches.mockResolvedValueOnce([]);

    const batches = renderHook(
      () =>
        useSubagentBatches("thread-1", {
          enabled: true,
          polling: false,
          cacheScope: "user-b",
        }),
      { wrapper: Wrapper },
    );

    try {
      expect(batches.result.current.data).not.toEqual([{ id: "private-to-a" }]);
      await waitFor(() => expect(batches.result.current.data).toEqual([]));
      expect(
        client.getQueryData(subagentBatchesKey("thread-1", "user-a")),
      ).toEqual([{ id: "private-to-a" }]);
      expect(
        client.getQueryData(subagentBatchesKey("thread-1", "user-b")),
      ).toEqual([]);
    } finally {
      batches.unmount();
      client.clear();
    }
  });

  it("invalidates only the initiating user's batch and item caches", async () => {
    const { client, Wrapper } = createWrapper();
    const userABatchesKey = subagentBatchesKey("thread-1", "user-a");
    const userBBatchesKey = subagentBatchesKey("thread-1", "user-b");
    const userAItemsKey = subagentBatchItemsKey(
      "thread-1",
      "batch-1",
      "user-a",
    );
    const userBItemsKey = subagentBatchItemsKey(
      "thread-1",
      "batch-1",
      "user-b",
    );
    client.setQueryData(userABatchesKey, []);
    client.setQueryData(userBBatchesKey, []);
    client.setQueryData(userAItemsKey, { pages: [[]], pageParams: [0] });
    client.setQueryData(userBItemsKey, { pages: [[]], pageParams: [0] });
    mocks.control.mockResolvedValueOnce({});
    mocks.retry.mockResolvedValueOnce({});

    const control = renderHook(
      () => useControlSubagentBatch("thread-1", { enabled: true }),
      { wrapper: Wrapper },
    );
    const retry = renderHook(
      () =>
        useRetrySubagentBatchItem("thread-1", "batch-1", {
          enabled: true,
        }),
      { wrapper: Wrapper },
    );

    try {
      await control.result.current.mutateAsync({
        batchId: "batch-1",
        action: "pause",
        cacheScope: "user-a",
      });
      await retry.result.current.mutateAsync({
        itemId: "item-1",
        cacheScope: "user-a",
      });

      expect(client.getQueryState(userABatchesKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(userAItemsKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(userBBatchesKey)?.isInvalidated).toBe(false);
      expect(client.getQueryState(userBItemsKey)?.isInvalidated).toBe(false);
    } finally {
      control.unmount();
      retry.unmount();
      client.clear();
    }
  });

  it("does not call batch write routes when threads:write is denied", async () => {
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, Wrapper } = createWrapper();
    const control = renderHook(
      () => useControlSubagentBatch("thread-1", { enabled: false }),
      { wrapper: Wrapper },
    );
    const retry = renderHook(
      () =>
        useRetrySubagentBatchItem("thread-1", "batch-1", { enabled: false }),
      { wrapper: Wrapper },
    );

    await expect(
      control.result.current.mutateAsync({
        batchId: "batch-1",
        action: "pause",
        cacheScope: "user-1",
      }),
    ).rejects.toThrow("Thread write permission is required.");
    await expect(
      retry.result.current.mutateAsync({
        itemId: "item-1",
        cacheScope: "user-1",
      }),
    ).rejects.toThrow("Thread write permission is required.");
    expect(mocks.control).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    client.clear();
  });
});
