import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const authState = rs.hoisted(() => ({
  userId: "owner-a",
  permissions: ["runs:read"] as string[] | null,
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      id: authState.userId,
      permissions: authState.permissions,
    },
  }),
}));

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
}));

rs.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
}));

import { fetch } from "@/core/api/fetcher";
import {
  useWorkspaceChanges,
  workspaceChangesQueryKey,
} from "@/core/workspace-changes/hooks";
import type { WorkspaceChangesResponse } from "@/core/workspace-changes/types";

const mockedFetch = rs.mocked(fetch);

function response(additions = 1): WorkspaceChangesResponse {
  return {
    available: true,
    version: 1,
    summary: {
      created: 1,
      modified: 0,
      deleted: 0,
      symlink_created: 0,
      additions,
      deletions: 0,
      truncated: false,
    },
    files: [],
    limits: {},
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
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
  authState.permissions = ["runs:read"];
});

describe("useWorkspaceChanges permission boundary", () => {
  it("hides and clears only this owner's cache when runs:read is denied", async () => {
    const client = makeClient();
    const currentOwnerKey = workspaceChangesQueryKey(
      "owner-a",
      "thread-1",
      "run-1",
      true,
      true,
    );
    const otherOwnerKey = workspaceChangesQueryKey(
      "owner-b",
      "thread-1",
      "run-1",
      true,
      true,
    );
    client.setQueryData(currentOwnerKey, response());
    client.setQueryData(otherOwnerKey, response(2));
    authState.permissions = [];

    const { result } = renderHook(
      () =>
        useWorkspaceChanges({
          threadId: "thread-1",
          runId: "run-1",
        }),
      { wrapper: createWrapper(client) },
    );

    expect(result.current.data).toBeUndefined();
    await waitFor(() => {
      expect(client.getQueryData(currentOwnerKey)).toBeUndefined();
    });
    expect(client.getQueryData(otherOwnerKey)).toEqual(response(2));
    expect(mockedFetch).not.toHaveBeenCalled();
    client.clear();
  });

  it("partitions reads by owner and forwards the query signal", async () => {
    const client = makeClient();
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify(response()), { status: 200 }),
    );

    const { result, rerender } = renderHook(
      () =>
        useWorkspaceChanges({
          threadId: "thread-1",
          runId: "run-1",
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toEqual(response()));
    expect(
      client.getQueryData(
        workspaceChangesQueryKey("owner-a", "thread-1", "run-1", true, true),
      ),
    ).toEqual(response());
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    authState.userId = "owner-b";
    rerender();
    expect(result.current.data).toBeUndefined();
    client.clear();
  });

  it("aborts an in-flight read when runs:read is revoked", async () => {
    const client = makeClient();
    let signal: AbortSignal | undefined;
    mockedFetch.mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    });

    const { result, rerender } = renderHook(
      () =>
        useWorkspaceChanges({
          threadId: "thread-1",
          runId: "run-1",
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(signal).toBeDefined());
    authState.permissions = [];
    rerender();

    await waitFor(() => expect(signal?.aborted).toBe(true));
    await waitFor(() => {
      expect(
        client.getQueryData(
          workspaceChangesQueryKey("owner-a", "thread-1", "run-1", true, true),
        ),
      ).toBeUndefined();
    });
    expect(result.current.data).toBeUndefined();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
