import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));

rs.mock("@/components/workspace/messages/context", () => ({
  useThread: rs.fn(),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      id: authState.userId,
      permissions: authState.permissions,
    },
  }),
}));

rs.mock("@/core/artifacts/loader", () => ({
  loadArtifactContent: rs.fn(),
  loadArtifactContentFromToolCall: rs.fn(),
}));

import { useThread } from "@/components/workspace/messages/context";
import {
  artifactContentQueryKey,
  useArtifactContent,
} from "@/core/artifacts/hooks";
import { loadArtifactContent } from "@/core/artifacts/loader";

const mockedUseThread = rs.mocked(useThread);
const mockedLoadArtifactContent = rs.mocked(loadArtifactContent);
const filepath = "/mnt/user-data/outputs/report.md";

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function createWrapper(queryClient = createClient()) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useArtifactContent", () => {
  beforeEach(() => {
    mockedUseThread.mockReturnValue({
      thread: { isLoading: false, messages: [] },
      isMock: false,
    } as never);
    mockedLoadArtifactContent.mockImplementation(async ({ full }) => ({
      content: full ? "complete report" : "preview",
      url: filepath,
      sha256: undefined,
      truncated: !full,
      previewBytes: full ? 15 : 7,
      totalBytes: 15,
    }));
  });

  afterEach(() => {
    cleanup();
    mockedUseThread.mockReset();
    mockedLoadArtifactContent.mockReset();
    authState.userId = "owner-a";
    authState.permissions = null;
  });

  it("keeps a full-content request scoped to its thread", async () => {
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string }) =>
        useArtifactContent({ filepath, threadId, enabled: true }),
      {
        initialProps: { threadId: "thread-a" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(mockedLoadArtifactContent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filepath,
          threadId: "thread-a",
          isMock: false,
          full: false,
          signal: expect.any(AbortSignal),
        }),
      );
    });

    act(() => {
      result.current.loadFullContent();
    });

    await waitFor(() => {
      expect(mockedLoadArtifactContent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filepath,
          threadId: "thread-a",
          isMock: false,
          full: true,
          signal: expect.any(AbortSignal),
        }),
      );
    });

    rerender({ threadId: "thread-b" });

    await waitFor(() => {
      expect(mockedLoadArtifactContent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filepath,
          threadId: "thread-b",
          isMock: false,
          full: false,
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  it("hides and clears only this owner's cached content when threads:read is denied", async () => {
    const client = createClient();
    const currentKey = artifactContentQueryKey(
      "owner-a",
      filepath,
      "thread-a",
      false,
      false,
    );
    const otherKey = artifactContentQueryKey(
      "owner-b",
      filepath,
      "thread-a",
      false,
      false,
    );
    client.setQueryData(currentKey, { content: "secret" });
    client.setQueryData(otherKey, { content: "other" });
    authState.permissions = [];

    const { result } = renderHook(
      () =>
        useArtifactContent({ filepath, threadId: "thread-a", enabled: true }),
      { wrapper: createWrapper(client) },
    );

    expect(result.current.accessDenied).toBe(true);
    expect(result.current.content).toBeUndefined();
    await waitFor(() => {
      expect(client.getQueryData(currentKey)).toBeUndefined();
    });
    expect(client.getQueryData(otherKey)).toEqual({ content: "other" });
    expect(mockedLoadArtifactContent).not.toHaveBeenCalled();
    client.clear();
  });

  it("aborts an in-flight read when threads:read is revoked", async () => {
    let signal: AbortSignal | undefined;
    mockedLoadArtifactContent.mockImplementation(({ signal: nextSignal }) => {
      signal = nextSignal;
      return new Promise(() => undefined);
    });
    authState.permissions = ["threads:read"];

    const { result, rerender } = renderHook(
      () =>
        useArtifactContent({ filepath, threadId: "thread-a", enabled: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(signal?.aborted).toBe(false);
    });
    authState.permissions = [];
    rerender();

    await waitFor(() => {
      expect(result.current.accessDenied).toBe(true);
      expect(signal?.aborted).toBe(true);
    });
    expect(result.current.content).toBeUndefined();
  });
});
