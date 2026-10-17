import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
}));

rs.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
}));

import { fetch } from "@/core/api/fetcher";
import { mcpConfigQueryKey, useMCPConfig } from "@/core/mcp/hooks";

const mockedFetch = rs.mocked(fetch);
const cachedConfig = { mcp_servers: { private: { enabled: true } } };

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  mockedFetch.mockReset();
  authState.userId = "owner-a";
  authState.permissions = null;
});

describe("useMCPConfig permission boundary", () => {
  it("still fetches MCP config while mcp:admin is unresolved", async () => {
    authState.permissions = null;
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => cachedConfig,
    } as Response);
    const client = createClient();
    const { result } = renderHook(() => useMCPConfig(), {
      wrapper: createWrapper(client),
    });
    try {
      await waitFor(() => expect(result.current.config).toEqual(cachedConfig));
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(mcpConfigQueryKey("owner-a"))).toEqual(
        cachedConfig,
      );
    } finally {
      client.clear();
    }
  });

  it("hides a caller-disabled config without removing the owner cache", () => {
    const client = createClient();
    const key = mcpConfigQueryKey("owner-a");
    client.setQueryData(key, cachedConfig);

    const { result } = renderHook(() => useMCPConfig(false), {
      wrapper: createWrapper(client),
    });

    expect(result.current).toEqual({
      config: undefined,
      isLoading: false,
      error: null,
    });
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual(cachedConfig);
    client.clear();
  });

  it("clears only this owner's config when mcp:admin is denied", async () => {
    const client = createClient();
    const currentKey = mcpConfigQueryKey("owner-a");
    const otherKey = mcpConfigQueryKey("owner-b");
    client.setQueryData(currentKey, cachedConfig);
    client.setQueryData(otherKey, cachedConfig);
    authState.permissions = [];

    const { result } = renderHook(() => useMCPConfig(), {
      wrapper: createWrapper(client),
    });
    try {
      expect(result.current).toEqual({
        config: undefined,
        isLoading: false,
        error: null,
      });
      await waitFor(() =>
        expect(client.getQueryData(currentKey)).toBeUndefined(),
      );
      expect(client.getQueryData(otherKey)).toEqual(cachedConfig);
      expect(mockedFetch).not.toHaveBeenCalled();
    } finally {
      client.clear();
    }
  });

  it("aborts an in-flight config read when mcp:admin is revoked", async () => {
    const client = createClient();
    let signal: AbortSignal | undefined;
    authState.permissions = ["mcp:admin"];
    mockedFetch.mockImplementation((_url, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    });

    const { result, rerender } = renderHook(() => useMCPConfig(), {
      wrapper: createWrapper(client),
    });

    try {
      await waitFor(() => expect(signal?.aborted).toBe(false));
      authState.permissions = [];
      rerender();
      await waitFor(() => expect(signal?.aborted).toBe(true));
      expect(result.current.config).toBeUndefined();
      expect(result.current.error).toBeNull();
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    } finally {
      client.clear();
    }
  });
});
