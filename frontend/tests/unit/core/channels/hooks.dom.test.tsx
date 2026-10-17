import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  configureProvider: rs.fn(),
  connectProvider: rs.fn(),
  disconnectConnection: rs.fn(),
  disconnectProvider: rs.fn(),
  listConnections: rs.fn(),
  listProviders: rs.fn(),
  user: {
    current: { id: "owner-a", permissions: null as string[] | null },
  },
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));

rs.mock("@/core/channels/api", () => ({
  configureChannelProvider: mocks.configureProvider,
  connectChannelProvider: mocks.connectProvider,
  disconnectChannelConnection: mocks.disconnectConnection,
  disconnectChannelProvider: mocks.disconnectProvider,
  listChannelConnections: mocks.listConnections,
  listChannelProviders: mocks.listProviders,
}));

import {
  useChannelConnections,
  useChannelProviders,
  useDisconnectChannelConnection,
  useDisconnectChannelProvider,
} from "@/core/channels/hooks";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
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

function providerSnapshot(connectionStatus: string) {
  return {
    enabled: true,
    providers: [
      {
        provider: "telegram",
        display_name: "Telegram",
        enabled: true,
        configured: true,
        auth_mode: "deep_link",
        connection_status: connectionStatus,
        credential_fields: [],
      },
    ],
  };
}

function connection(id: string) {
  return {
    id,
    provider: "telegram",
    status: "connected",
    scopes: [],
    metadata: {},
  };
}

afterEach(() => {
  cleanup();
  mocks.configureProvider.mockReset();
  mocks.connectProvider.mockReset();
  mocks.disconnectConnection.mockReset();
  mocks.disconnectProvider.mockReset();
  mocks.listConnections.mockReset();
  mocks.listProviders.mockReset();
  mocks.user.current = { id: "owner-a", permissions: null };
});

describe("channel query owner and permission boundaries", () => {
  it("switches provider and connection reads to the new owner's cache", async () => {
    const { client, Wrapper } = createWrapper();
    const ownerAProviders = providerSnapshot("owner-a-connected");
    const ownerBProviders = providerSnapshot("owner-b-connected");
    const ownerAConnections = [connection("owner-a-connection")];
    const ownerBConnections = [connection("owner-b-connection")];
    client.setQueryData(["channelProviders", "owner-a"], ownerAProviders);
    client.setQueryData(["channelProviders", "owner-b"], ownerBProviders);
    client.setQueryData(["channelConnections", "owner-a"], ownerAConnections);
    client.setQueryData(["channelConnections", "owner-b"], ownerBConnections);
    mocks.listProviders.mockImplementation(async () =>
      mocks.user.current.id === "owner-a" ? ownerAProviders : ownerBProviders,
    );
    mocks.listConnections.mockImplementation(async () =>
      mocks.user.current.id === "owner-a"
        ? ownerAConnections
        : ownerBConnections,
    );

    const providers = renderHook(() => useChannelProviders(), {
      wrapper: Wrapper,
    });
    const connections = renderHook(() => useChannelConnections(), {
      wrapper: Wrapper,
    });
    expect(providers.result.current.providers).toEqual(
      ownerAProviders.providers,
    );
    expect(connections.result.current.connections).toEqual(ownerAConnections);

    act(() => {
      mocks.user.current = { id: "owner-b", permissions: null };
      providers.rerender();
      connections.rerender();
    });

    await waitFor(() => {
      expect(providers.result.current.providers).toEqual(
        ownerBProviders.providers,
      );
      expect(connections.result.current.connections).toEqual(ownerBConnections);
    });
    expect(client.getQueryData(["channelProviders", "owner-a"])).toEqual(
      ownerAProviders,
    );
    expect(client.getQueryData(["channelConnections", "owner-a"])).toEqual(
      ownerAConnections,
    );
    client.clear();
  });

  it("hides caller-disabled channel lists without removing either owner cache", () => {
    const { client, Wrapper } = createWrapper();
    const providersCached = providerSnapshot("private-status");
    const connectionsCached = [connection("private-connection")];
    client.setQueryData(["channelProviders", "owner-a"], providersCached);
    client.setQueryData(["channelConnections", "owner-a"], connectionsCached);
    client.setQueryData(
      ["channelProviders", "owner-b"],
      providerSnapshot("other-owner"),
    );

    const providers = renderHook(() => useChannelProviders(false), {
      wrapper: Wrapper,
    });
    const connections = renderHook(() => useChannelConnections(false), {
      wrapper: Wrapper,
    });

    expect(providers.result.current.providers).toEqual([]);
    expect(providers.result.current.hasData).toBe(false);
    expect(connections.result.current.connections).toEqual([]);
    expect(connections.result.current.hasData).toBe(false);
    expect(connections.result.current.isLoading).toBe(false);
    expect(connections.result.current.error).toBeNull();
    expect(client.getQueryData(["channelProviders", "owner-a"])).toEqual(
      providersCached,
    );
    expect(client.getQueryData(["channelConnections", "owner-a"])).toEqual(
      connectionsCached,
    );
    expect(client.getQueryData(["channelProviders", "owner-b"])).toEqual(
      providerSnapshot("other-owner"),
    );
    expect(mocks.listProviders).not.toHaveBeenCalled();
    expect(mocks.listConnections).not.toHaveBeenCalled();
    client.clear();
  });

  it("still fetches providers while channels:read is unresolved", async () => {
    mocks.user.current = { id: "owner-a", permissions: null };
    mocks.listProviders.mockResolvedValueOnce(providerSnapshot("connected"));
    const { client, Wrapper } = createWrapper();
    const providers = renderHook(() => useChannelProviders(), {
      wrapper: Wrapper,
    });
    try {
      await waitFor(() => expect(providers.result.current.hasData).toBe(true));
      expect(mocks.listProviders).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(["channelProviders", "owner-a"])).toEqual(
        providerSnapshot("connected"),
      );
    } finally {
      providers.unmount();
      client.clear();
    }
  });

  it("clears only this owner's provider list when channels:read is denied", async () => {
    const { client, Wrapper } = createWrapper();
    const cached = providerSnapshot("private-status");
    const connections = [connection("private-connection")];
    client.setQueryData(["channelProviders", "owner-a"], cached);
    client.setQueryData(["channelProviders", "owner-b"], cached);
    client.setQueryData(["channelConnections", "owner-a"], connections);
    mocks.user.current = { id: "owner-a", permissions: [] };

    const providers = renderHook(() => useChannelProviders(), {
      wrapper: Wrapper,
    });
    try {
      expect(providers.result.current.providers).toEqual([]);
      expect(providers.result.current.hasData).toBe(false);
      expect(providers.result.current.isLoading).toBe(false);
      expect(providers.result.current.error).toBeNull();
      await waitFor(() =>
        expect(client.getQueryData(["channelProviders", "owner-a"])).toBe(
          undefined,
        ),
      );
      expect(client.getQueryData(["channelProviders", "owner-b"])).toEqual(
        cached,
      );
      expect(client.getQueryData(["channelConnections", "owner-a"])).toEqual(
        connections,
      );
      expect(mocks.listProviders).not.toHaveBeenCalled();
    } finally {
      providers.unmount();
      client.clear();
    }
  });

  it("hides a caller-disabled provider list without removing the owner cache", () => {
    const { client, Wrapper } = createWrapper();
    const cached = providerSnapshot("private-status");
    client.setQueryData(["channelProviders", "owner-a"], cached);
    mocks.user.current = { id: "owner-a", permissions: ["channels:read"] };

    const providers = renderHook(() => useChannelProviders(false), {
      wrapper: Wrapper,
    });
    try {
      expect(providers.result.current.providers).toEqual([]);
      expect(providers.result.current.hasData).toBe(false);
      expect(providers.result.current.isLoading).toBe(false);
      expect(providers.result.current.error).toBeNull();
      expect(client.getQueryData(["channelProviders", "owner-a"])).toEqual(
        cached,
      );
      expect(mocks.listProviders).not.toHaveBeenCalled();
    } finally {
      providers.unmount();
      client.clear();
    }
  });

  it("still fetches connections while channels:read is unresolved", async () => {
    mocks.user.current = { id: "owner-a", permissions: null };
    mocks.listConnections.mockResolvedValueOnce([connection("connection-a")]);
    const { client, Wrapper } = createWrapper();
    const connections = renderHook(() => useChannelConnections(), {
      wrapper: Wrapper,
    });
    try {
      await waitFor(() =>
        expect(connections.result.current.hasData).toBe(true),
      );
      expect(mocks.listConnections).toHaveBeenCalledTimes(1);
      expect(mocks.listConnections.mock.calls[0]?.[0]).toBeInstanceOf(
        AbortSignal,
      );
      expect(client.getQueryData(["channelConnections", "owner-a"])).toEqual([
        connection("connection-a"),
      ]);
    } finally {
      connections.unmount();
      client.clear();
    }
  });

  it("clears only this owner's connections when channels:read is denied", async () => {
    const { client, Wrapper } = createWrapper();
    const providersCached = providerSnapshot("private-status");
    const connectionsCached = [connection("private-connection")];
    client.setQueryData(["channelProviders", "owner-a"], providersCached);
    client.setQueryData(["channelConnections", "owner-a"], connectionsCached);
    client.setQueryData(["channelConnections", "owner-b"], connectionsCached);
    mocks.user.current = { id: "owner-a", permissions: [] };

    const connections = renderHook(() => useChannelConnections(), {
      wrapper: Wrapper,
    });
    try {
      expect(connections.result.current.connections).toEqual([]);
      expect(connections.result.current.hasData).toBe(false);
      expect(connections.result.current.isLoading).toBe(false);
      expect(connections.result.current.error).toBeNull();
      await waitFor(() =>
        expect(client.getQueryData(["channelConnections", "owner-a"])).toBe(
          undefined,
        ),
      );
      expect(client.getQueryData(["channelConnections", "owner-b"])).toEqual(
        connectionsCached,
      );
      expect(client.getQueryData(["channelProviders", "owner-a"])).toEqual(
        providersCached,
      );
      expect(mocks.listConnections).not.toHaveBeenCalled();
    } finally {
      connections.unmount();
      client.clear();
    }
  });

  it("passes cancellation signals to both authorized directory reads", async () => {
    const { client, Wrapper } = createWrapper();
    mocks.listProviders.mockResolvedValueOnce(providerSnapshot("connected"));
    mocks.listConnections.mockResolvedValueOnce([connection("connection-a")]);

    const providers = renderHook(() => useChannelProviders(), {
      wrapper: Wrapper,
    });
    const connections = renderHook(() => useChannelConnections(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(providers.result.current.hasData).toBe(true);
      expect(connections.result.current.hasData).toBe(true);
    });
    expect(mocks.listProviders.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(mocks.listConnections.mock.calls[0]?.[0]).toBeInstanceOf(
      AbortSignal,
    );
    client.clear();
  });

  it("invalidates only the owner cache captured when disconnect starts", async () => {
    const { client, Wrapper } = createWrapper();
    for (const owner of ["owner-a", "owner-b"]) {
      client.setQueryData(["channelProviders", owner], providerSnapshot(owner));
      client.setQueryData(["channelConnections", owner], [connection(owner)]);
    }
    let markDisconnectStarted: () => void = () => undefined;
    const disconnectStarted = new Promise<void>((resolve) => {
      markDisconnectStarted = resolve;
    });
    let finishDisconnect: () => void = () => undefined;
    mocks.disconnectConnection.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisconnect = resolve;
          markDisconnectStarted();
        }),
    );

    const mutation = renderHook(() => useDisconnectChannelConnection(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      const mutationPromise =
        mutation.result.current.mutateAsync("owner-a-connection");
      await disconnectStarted;
      mocks.user.current = { id: "owner-b", permissions: null };
      mutation.rerender();
      finishDisconnect();
      await mutationPromise;
    });

    expect(
      client.getQueryState(["channelProviders", "owner-a"])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["channelConnections", "owner-a"])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["channelProviders", "owner-b"])?.isInvalidated,
    ).toBe(false);
    expect(
      client.getQueryState(["channelConnections", "owner-b"])?.isInvalidated,
    ).toBe(false);
    client.clear();
  });

  it("invalidates every owner's snapshot after a global provider disconnect", async () => {
    const { client, Wrapper } = createWrapper();
    for (const owner of ["owner-a", "owner-b"]) {
      client.setQueryData(["channelProviders", owner], providerSnapshot(owner));
      client.setQueryData(["channelConnections", owner], [connection(owner)]);
    }
    mocks.disconnectProvider.mockResolvedValueOnce({});
    const mutation = renderHook(() => useDisconnectChannelProvider(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await mutation.result.current.mutateAsync("telegram");
    });

    for (const owner of ["owner-a", "owner-b"]) {
      expect(
        client.getQueryState(["channelProviders", owner])?.isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryState(["channelConnections", owner])?.isInvalidated,
      ).toBe(true);
    }
    client.clear();
  });
});
