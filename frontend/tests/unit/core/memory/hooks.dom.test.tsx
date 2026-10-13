import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  clearMemory: rs.fn(),
  loadMemory: rs.fn(),
}));

rs.mock("@/core/memory/api", () => ({
  clearMemory: mocks.clearMemory,
  createMemoryFact: rs.fn(),
  deleteMemoryFact: rs.fn(),
  importMemory: rs.fn(),
  loadMemory: mocks.loadMemory,
  updateMemoryFact: rs.fn(),
}));

import { memoryQueryKey, useClearMemory, useMemory } from "@/core/memory/hooks";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, Wrapper };
}

function memorySnapshot(lastUpdated: string) {
  return {
    version: "1",
    lastUpdated,
    user: {
      workContext: { summary: "", updatedAt: "" },
      personalContext: { summary: "", updatedAt: "" },
      topOfMind: { summary: "", updatedAt: "" },
    },
    history: {
      recentMonths: { summary: "", updatedAt: "" },
      earlierContext: { summary: "", updatedAt: "" },
      longTermBackground: { summary: "", updatedAt: "" },
    },
    facts: [],
  };
}

afterEach(() => {
  cleanup();
  mocks.clearMemory.mockReset();
  mocks.loadMemory.mockReset();
});

describe("memory query ownership and permission cleanup", () => {
  it("removes a cached document when read permission is denied", async () => {
    const { client, Wrapper } = createWrapper();
    const key = memoryQueryKey("alice");
    client.setQueryData(key, memorySnapshot("alice-private"));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMemory(enabled, "alice"),
      { initialProps: { enabled: false }, wrapper: Wrapper },
    );

    expect(result.current.memory).toBeNull();
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
    expect(mocks.loadMemory).not.toHaveBeenCalled();

    mocks.loadMemory.mockResolvedValue(memorySnapshot("fresh-after-grant"));
    rerender({ enabled: true });
    await waitFor(() =>
      expect(result.current.memory?.lastUpdated).toBe("fresh-after-grant"),
    );
    expect(mocks.loadMemory).toHaveBeenCalledWith("alice", expect.anything());
  });

  it("shows only the active account cache and clears the previous account", async () => {
    const { client, Wrapper } = createWrapper();
    const aliceKey = memoryQueryKey("alice");
    const bobKey = memoryQueryKey("bob");
    client.setQueryData(aliceKey, memorySnapshot("alice-private"));
    client.setQueryData(bobKey, memorySnapshot("bob-private"));

    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) => useMemory(true, userId),
      { initialProps: { userId: "alice" }, wrapper: Wrapper },
    );
    expect(result.current.memory?.lastUpdated).toBe("alice-private");

    rerender({ userId: "bob" });

    expect(result.current.memory?.lastUpdated).toBe("bob-private");
    await waitFor(() => expect(client.getQueryData(aliceKey)).toBeUndefined());
  });

  it("does not restore a mutation response after permission revocation", async () => {
    const { client, Wrapper } = createWrapper();
    const key = memoryQueryKey("alice");
    client.setQueryData(key, memorySnapshot("before-clear"));
    let resolveClear!: (value: ReturnType<typeof memorySnapshot>) => void;
    mocks.clearMemory.mockReturnValue(
      new Promise((resolve) => {
        resolveClear = resolve;
      }),
    );

    const reader = renderHook(
      ({ enabled }: { enabled: boolean }) => useMemory(enabled, "alice"),
      { initialProps: { enabled: true }, wrapper: Wrapper },
    );
    const mutation = renderHook(() => useClearMemory(), { wrapper: Wrapper });
    let pendingMutation!: Promise<unknown>;
    act(() => {
      pendingMutation = mutation.result.current.mutateAsync({
        ownerId: "alice",
      });
    });

    reader.rerender({ enabled: false });
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());

    await act(async () => {
      resolveClear(memorySnapshot("late-response"));
      await pendingMutation;
    });

    expect(client.getQueryData(key)).toBeUndefined();
  });
});
