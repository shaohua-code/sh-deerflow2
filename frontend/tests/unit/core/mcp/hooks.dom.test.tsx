import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
}));

rs.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
}));

import { fetch } from "@/core/api/fetcher";
import { useMCPConfig } from "@/core/mcp/hooks";

const mockedFetch = rs.mocked(fetch);

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
});

describe("useMCPConfig permission boundary", () => {
  it("hides and removes cached config when the read is disabled", async () => {
    const client = createClient();
    client.setQueryData(["mcpConfig"], {
      mcp_servers: { private: { enabled: true } },
    });

    const { result } = renderHook(() => useMCPConfig(false), {
      wrapper: createWrapper(client),
    });

    expect(result.current).toEqual({
      config: undefined,
      isLoading: false,
      error: null,
    });
    await waitFor(() => {
      expect(client.getQueryData(["mcpConfig"])).toBeUndefined();
    });
    expect(mockedFetch).not.toHaveBeenCalled();
    client.clear();
  });

  it("aborts an in-flight config read when permission is revoked", async () => {
    const client = createClient();
    let signal: AbortSignal | undefined;
    mockedFetch.mockImplementation((_url, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMCPConfig(enabled),
      {
        initialProps: { enabled: true },
        wrapper: createWrapper(client),
      },
    );

    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    rerender({ enabled: false });

    await waitFor(() => expect(signal?.aborted).toBe(true));
    await waitFor(() => {
      expect(client.getQueryData(["mcpConfig"])).toBeUndefined();
    });
    expect(
      client.getQueryCache().find({ queryKey: ["mcpConfig"] })?.state
        .fetchStatus,
    ).toBe("idle");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(result.current.config).toBeUndefined();
    expect(result.current.error).toBeNull();
    client.clear();
  });
});
