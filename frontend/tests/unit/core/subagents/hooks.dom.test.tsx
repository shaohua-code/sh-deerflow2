import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  listSubagents: rs.fn(),
  createManagedSubagent: rs.fn(),
  deleteManagedSubagent: rs.fn(),
  updateManagedSubagent: rs.fn(),
}));

rs.mock("@/core/subagents/api", () => mocks);

import { SUBAGENTS_QUERY_KEY, useSubagents } from "@/core/subagents/hooks";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, Wrapper };
}

afterEach(() => {
  cleanup();
  mocks.listSubagents.mockReset();
});

describe("subagent catalog read permission", () => {
  it("hides and removes cached catalog data while reads are disabled", async () => {
    const { client, Wrapper } = createWrapper();
    client.setQueryData(SUBAGENTS_QUERY_KEY, [{ name: "cached-private" }]);

    const { result } = renderHook(() => useSubagents(false), {
      wrapper: Wrapper,
    });

    expect(result.current.subagents).toEqual([]);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(SUBAGENTS_QUERY_KEY)).toBeUndefined(),
    );
    expect(mocks.listSubagents).not.toHaveBeenCalled();
    client.clear();
  });

  it("aborts an in-flight catalog read after permission is withdrawn", async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.listSubagents.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) => {
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
    const { client, Wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSubagents(enabled),
      { initialProps: { enabled: true }, wrapper: Wrapper },
    );

    await waitFor(() => expect(mocks.listSubagents).toHaveBeenCalledTimes(1));
    rerender({ enabled: false });

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(result.current.subagents).toEqual([]);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(SUBAGENTS_QUERY_KEY)).toBeUndefined(),
    );
    client.clear();
  });
});
