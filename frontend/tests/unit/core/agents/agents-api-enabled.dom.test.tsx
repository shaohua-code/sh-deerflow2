import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  fetchEnabled: rs.fn(),
  getAgent: rs.fn(),
  listAgents: rs.fn(),
  deleteAgent: rs.fn(),
  user: { current: { id: "owner-a" } },
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));

rs.mock("@/core/agents/api", () => ({
  createAgent: rs.fn(),
  deleteAgent: mocks.deleteAgent,
  fetchAgentsApiEnabled: mocks.fetchEnabled,
  getAgent: mocks.getAgent,
  listAgents: mocks.listAgents,
  updateAgent: rs.fn(),
}));

import {
  useAgent,
  useAgents,
  useAgentsApiEnabled,
  useDeleteAgent,
} from "@/core/agents/hooks";

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
  mocks.deleteAgent.mockReset();
  mocks.user.current = { id: "owner-a" };
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
    const ownerAgent = { name: "private-agent" };
    const otherOwnerAgent = { name: "other-private-agent" };
    client.setQueryData(["agents", "owner-a"], [ownerAgent]);
    client.setQueryData(["agents", "owner-a", "private-agent"], ownerAgent);
    client.setQueryData(["agents", "owner-b"], [otherOwnerAgent]);

    const list = renderHook(() => useAgents(false), { wrapper: Wrapper });
    const detail = renderHook(() => useAgent("private-agent", false), {
      wrapper: Wrapper,
    });

    expect(list.result.current.agents).toEqual([]);
    expect(detail.result.current.agent).toBeNull();
    await waitFor(() => {
      expect(client.getQueryData(["agents", "owner-a"])).toBeUndefined();
      expect(
        client.getQueryData(["agents", "owner-a", "private-agent"]),
      ).toBeUndefined();
    });
    expect(list.result.current.agents).toEqual([]);
    expect(detail.result.current.agent).toBeNull();
    expect(client.getQueryData(["agents", "owner-b"])).toEqual([
      otherOwnerAgent,
    ]);
    expect(mocks.listAgents).not.toHaveBeenCalled();
    expect(mocks.getAgent).not.toHaveBeenCalled();
    client.clear();
  });

  it("switches list and detail reads to the new owner's cache", async () => {
    const { client, Wrapper } = createWrapper();
    const ownerAgent = { name: "shared-name", owner: "owner-a" };
    const otherOwnerAgent = { name: "shared-name", owner: "owner-b" };
    client.setQueryData(["agents", "owner-a"], [ownerAgent]);
    client.setQueryData(["agents", "owner-a", "shared-name"], ownerAgent);
    client.setQueryData(["agents", "owner-b"], [otherOwnerAgent]);
    client.setQueryData(["agents", "owner-b", "shared-name"], otherOwnerAgent);
    mocks.listAgents.mockImplementation(async () =>
      mocks.user.current.id === "owner-a" ? [ownerAgent] : [otherOwnerAgent],
    );
    mocks.getAgent.mockImplementation(async () =>
      mocks.user.current.id === "owner-a" ? ownerAgent : otherOwnerAgent,
    );

    const list = renderHook(() => useAgents(), { wrapper: Wrapper });
    const detail = renderHook(() => useAgent("shared-name"), {
      wrapper: Wrapper,
    });
    expect(list.result.current.agents).toEqual([ownerAgent]);
    expect(detail.result.current.agent).toEqual(ownerAgent);

    act(() => {
      mocks.user.current = { id: "owner-b" };
      list.rerender();
      detail.rerender();
    });

    await waitFor(() => {
      expect(list.result.current.agents).toEqual([otherOwnerAgent]);
      expect(detail.result.current.agent).toEqual(otherOwnerAgent);
    });
    expect(client.getQueryData(["agents", "owner-a"])).toEqual([ownerAgent]);
    client.clear();
  });

  it("invalidates only the owner cache captured when a mutation starts", async () => {
    const { client, Wrapper } = createWrapper();
    client.setQueryData(["agents", "owner-a"], [{ name: "owner-a-agent" }]);
    client.setQueryData(["agents", "owner-b"], [{ name: "owner-b-agent" }]);
    let markDeleteStarted: () => void = () => undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      markDeleteStarted = resolve;
    });
    let finishDelete: () => void = () => undefined;
    mocks.deleteAgent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
          markDeleteStarted();
        }),
    );

    const deletion = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });
    await act(async () => {
      const mutationPromise =
        deletion.result.current.mutateAsync("owner-a-agent");
      await deleteStarted;
      mocks.user.current = { id: "owner-b" };
      deletion.rerender();
      finishDelete();
      await mutationPromise;
    });

    expect(client.getQueryState(["agents", "owner-a"])?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(["agents", "owner-b"])?.isInvalidated).toBe(
      false,
    );
    client.clear();
  });
});
