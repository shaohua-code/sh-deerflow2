import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  clearMemory: rs.fn(),
  loadMemory: rs.fn(),
  user: {
    current: { id: "user-1", permissions: null as string[] | null },
  },
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user.current }),
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
  mocks.user.current = { id: "user-1", permissions: null };
});

describe("memory query ownership and permission cleanup", () => {
  it("removes the cached document only when memory:read is explicitly denied", async () => {
    const { client, Wrapper } = createWrapper();
    const key = memoryQueryKey("alice");
    client.setQueryData(key, memorySnapshot("alice-private"));
    mocks.user.current = { id: "user-1", permissions: [] };

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMemory(enabled, "alice"),
      { initialProps: { enabled: true }, wrapper: Wrapper },
    );

    expect(result.current.memory).toBeNull();
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
    expect(mocks.loadMemory).not.toHaveBeenCalled();

    // 恢复授权后重新读取，不再保留被清理的旧缓存。
    mocks.user.current = { id: "user-1", permissions: ["memory:read"] };
    mocks.loadMemory.mockResolvedValue(memorySnapshot("fresh-after-grant"));
    rerender({ enabled: true });
    await waitFor(() =>
      expect(result.current.memory?.lastUpdated).toBe("fresh-after-grant"),
    );
    expect(mocks.loadMemory).toHaveBeenCalledWith("alice", expect.anything());
  });

  it("hides a caller-disabled read without removing the owner cache", async () => {
    const { client, Wrapper } = createWrapper();
    const key = memoryQueryKey("alice");
    const snapshot = memorySnapshot("alice-private");
    client.setQueryData(key, snapshot);
    mocks.user.current = { id: "user-1", permissions: ["memory:read"] };

    const { result } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMemory(enabled, "alice"),
      { initialProps: { enabled: false }, wrapper: Wrapper },
    );

    // 调用方停用只隐藏结果，不删该账号缓存。
    expect(result.current.memory).toBeNull();
    expect(client.getQueryData(key)).toEqual(snapshot);
    expect(mocks.loadMemory).not.toHaveBeenCalled();
  });

  it("shows only the active account cache and clears the previous account", async () => {
    const { client, Wrapper } = createWrapper();
    const aliceKey = memoryQueryKey("alice");
    const bobKey = memoryQueryKey("bob");
    client.setQueryData(aliceKey, memorySnapshot("alice-private"));
    client.setQueryData(bobKey, memorySnapshot("bob-private"));
    mocks.loadMemory.mockResolvedValue(memorySnapshot("bob-fresh"));

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
    mocks.user.current = { id: "user-1", permissions: ["memory:read"] };

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

    // 明确撤权触发清理，迟到的清空响应不能复活缓存。
    mocks.user.current = { id: "user-1", permissions: [] };
    reader.rerender({ enabled: true });
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());

    await act(async () => {
      resolveClear(memorySnapshot("late-response"));
      await pendingMutation;
    });

    expect(client.getQueryData(key)).toBeUndefined();
  });
});
