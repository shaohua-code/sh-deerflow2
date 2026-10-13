import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  fetchEnabled: rs.fn(),
  getAgent: rs.fn(),
  listAgents: rs.fn(),
}));

rs.mock("@/core/agents/api", () => ({
  createAgent: rs.fn(),
  deleteAgent: rs.fn(),
  fetchAgentsApiEnabled: mocks.fetchEnabled,
  getAgent: mocks.getAgent,
  listAgents: mocks.listAgents,
  updateAgent: rs.fn(),
}));

import { useAgent, useAgents, useAgentsApiEnabled } from "@/core/agents/hooks";

const CACHE_KEY = "deerflow.features.agents_api";

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
  localStorage.clear();
  mocks.fetchEnabled.mockReset();
  mocks.getAgent.mockReset();
  mocks.listAgents.mockReset();
});

describe("useAgentsApiEnabled cached browser snapshot", () => {
  it("uses the sticky localStorage value after hydration when the API is unavailable", async () => {
    localStorage.setItem(CACHE_KEY, "false");
    mocks.fetchEnabled.mockRejectedValue(new Error("Gateway unavailable"));
    const { client, Wrapper } = createWrapper();

    const { result } = renderHook(() => useAgentsApiEnabled(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
    client.clear();
  });

  it("updates from cross-tab storage events and lets a live API result win", async () => {
    localStorage.setItem(CACHE_KEY, "false");
    let resolveLiveValue: (value: boolean) => void = () => undefined;
    mocks.fetchEnabled.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLiveValue = resolve;
        }),
    );
    const { client, Wrapper } = createWrapper();

    const { result } = renderHook(() => useAgentsApiEnabled(), {
      wrapper: Wrapper,
    });

    act(() => {
      // 浏览器会先更新共享值，再通知其他标签页触发 storage 事件。
      localStorage.setItem(CACHE_KEY, "true");
      window.dispatchEvent(
        new StorageEvent("storage", { key: CACHE_KEY, newValue: "true" }),
      );
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => resolveLiveValue(false));
    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(localStorage.getItem(CACHE_KEY)).toBe("false");
    client.clear();
  });

  it("keeps a successful live answer usable after a background probe fails", async () => {
    mocks.fetchEnabled.mockResolvedValueOnce(true);
    const { client, Wrapper } = createWrapper();
    const { result } = renderHook(() => useAgentsApiEnabled(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mocks.fetchEnabled.mockRejectedValueOnce(new Error("Gateway unavailable"));
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.enabled).toBe(true);
    expect(result.current.isError).toBe(false);
    client.clear();
  });
});

describe("agent read permission cache handling", () => {
  it("removes cached Agent lists and details when reads are disabled", async () => {
    const { client, Wrapper } = createWrapper();
    const cachedAgent = { name: "private-agent" };
    client.setQueryData(["agents"], [cachedAgent]);
    client.setQueryData(["agents", "private-agent"], cachedAgent);

    const list = renderHook(() => useAgents(false), { wrapper: Wrapper });
    const detail = renderHook(() => useAgent("private-agent", false), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(client.getQueryData(["agents"])).toBeUndefined();
      expect(client.getQueryData(["agents", "private-agent"])).toBeUndefined();
    });
    expect(list.result.current.agents).toEqual([]);
    expect(detail.result.current.agent).toBeNull();
    expect(mocks.listAgents).not.toHaveBeenCalled();
    expect(mocks.getAgent).not.toHaveBeenCalled();
    client.clear();
  });
});
