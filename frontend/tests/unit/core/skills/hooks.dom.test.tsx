import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({ loadSkills: rs.fn() }));
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
rs.mock("@/core/skills", () => ({ loadSkills: mocks.loadSkills }));

import { skillsQueryKey, useSkills } from "@/core/skills/hooks";

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
  mocks.loadSkills.mockReset();
  authState.userId = "owner-a";
  authState.permissions = null;
});

describe("skill catalog read permission", () => {
  it("still fetches the catalog while skills:read is unresolved", async () => {
    authState.permissions = null;
    mocks.loadSkills.mockResolvedValue([{ name: "public-skill" }]);
    const { client, Wrapper } = createWrapper();
    const { result } = renderHook(() => useSkills(), { wrapper: Wrapper });
    try {
      await waitFor(() =>
        expect(result.current.skills).toEqual([{ name: "public-skill" }]),
      );
      expect(mocks.loadSkills).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(skillsQueryKey("owner-a"))).toEqual([
        { name: "public-skill" },
      ]);
    } finally {
      client.clear();
    }
  });

  it("hides a caller-disabled catalog without removing the owner cache", () => {
    const { client, Wrapper } = createWrapper();
    const cached = [{ name: "private-skill" }];
    const key = skillsQueryKey("owner-a");
    client.setQueryData(key, cached);

    const { result } = renderHook(() => useSkills(false), {
      wrapper: Wrapper,
    });

    expect(result.current.skills).toEqual([]);
    expect(result.current.hasData).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mocks.loadSkills).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual(cached);
    client.clear();
  });

  it("clears only this owner's catalog when skills:read is denied", async () => {
    const { client, Wrapper } = createWrapper();
    const cached = [{ name: "private-skill" }];
    const currentKey = skillsQueryKey("owner-a");
    const otherKey = skillsQueryKey("owner-b");
    const customKey = ["skills", "custom"] as const;
    client.setQueryData(currentKey, cached);
    client.setQueryData(otherKey, cached);
    client.setQueryData(customKey, cached);
    authState.permissions = [];

    const { result } = renderHook(() => useSkills(), { wrapper: Wrapper });
    try {
      expect(result.current.skills).toEqual([]);
      expect(result.current.hasData).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      await waitFor(() =>
        expect(client.getQueryData(currentKey)).toBeUndefined(),
      );
      expect(client.getQueryData(otherKey)).toEqual(cached);
      expect(client.getQueryData(customKey)).toEqual(cached);
      expect(mocks.loadSkills).not.toHaveBeenCalled();
    } finally {
      client.clear();
    }
  });

  it("aborts an in-flight catalog read when skills:read is revoked", async () => {
    let requestSignal: AbortSignal | undefined;
    authState.permissions = ["skills:read"];
    mocks.loadSkills.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) => {
        requestSignal = signal;
        return new Promise(() => undefined);
      },
    );
    const { client, Wrapper } = createWrapper();
    const { result, rerender } = renderHook(() => useSkills(), {
      wrapper: Wrapper,
    });

    try {
      await waitFor(() => expect(requestSignal?.aborted).toBe(false));
      authState.permissions = [];
      rerender();
      await waitFor(() => expect(requestSignal?.aborted).toBe(true));
      expect(result.current.skills).toEqual([]);
      expect(result.current.hasData).toBe(false);
      expect(result.current.error).toBeNull();
    } finally {
      client.clear();
    }
  });
});
