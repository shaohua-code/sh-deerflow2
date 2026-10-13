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
  useControlSubagentBatch,
  useRetrySubagentBatchItem,
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
    const { result } = renderHook(() => useControlSubagentBatch("thread-1"), {
      wrapper: Wrapper,
    });

    act(() => {
      void result.current.mutate({ batchId: "batch-1", action: "pause" });
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
      () => useRetrySubagentBatchItem("thread-1", "batch-1"),
      { wrapper: Wrapper },
    );

    act(() => {
      void result.current.mutate("item-1");
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
