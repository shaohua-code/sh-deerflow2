import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  install: rs.fn(),
  loadStatus: rs.fn(),
}));
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
rs.mock("@/core/integrations/lark/api", () => ({
  completeLarkAuthorization: rs.fn(),
  completeLarkConfiguration: rs.fn(),
  installLarkIntegration: mocks.install,
  loadLarkIntegrationStatus: mocks.loadStatus,
  setLarkAppCredentials: rs.fn(),
  startLarkAuthorization: rs.fn(),
  startLarkConfiguration: rs.fn(),
}));

import {
  larkIntegrationQueryKey,
  useInstallLarkIntegration,
  useLarkIntegrationStatus,
} from "@/core/integrations/lark/hooks";
import type { LarkIntegrationStatus } from "@/core/integrations/lark/types";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, Wrapper };
}

function status(version: string): LarkIntegrationStatus {
  return {
    installed: false,
    version,
    manifest_version: null,
    latest_available_version: null,
    runtime_version_mismatch: false,
    app_configured: false,
    app_id: null,
    app_brand: null,
    skills_expected: 0,
    skills_installed: 0,
    installed_skills: [],
    enabled_skills: [],
    install_path: "",
    cli: { available: false, path: null, version: null, error: null },
    auth: {
      status: "not_configured",
      message: null,
      user: null,
      verified: false,
    },
    sandbox_runtime_mode: "none",
    sandbox_runtime_ready: false,
    sandbox_runtime_detail: null,
  };
}

afterEach(() => {
  cleanup();
  mocks.install.mockReset();
  mocks.loadStatus.mockReset();
  authState.userId = "owner-a";
  authState.permissions = null;
});

describe("Lark integration status permissions and owner cache", () => {
  it("keeps status caches separate when two users open the same workspace", async () => {
    const { client, Wrapper } = createWrapper();
    const userAStatus = status("user-a-version");
    const userBStatus = status("user-b-version");
    client.setQueryData(larkIntegrationQueryKey("user-a"), userAStatus);
    authState.userId = "user-b";
    authState.permissions = null;
    mocks.loadStatus.mockResolvedValueOnce(userBStatus);

    const query = renderHook(() => useLarkIntegrationStatus(true), {
      wrapper: Wrapper,
    });

    try {
      expect(query.result.current.data).not.toEqual(userAStatus);
      await waitFor(() =>
        expect(query.result.current.data).toEqual(userBStatus),
      );
      expect(client.getQueryData(larkIntegrationQueryKey("user-a"))).toEqual(
        userAStatus,
      );
      expect(client.getQueryData(larkIntegrationQueryKey("user-b"))).toEqual(
        userBStatus,
      );
    } finally {
      query.unmount();
      client.clear();
    }
  });

  it("still fetches status while integrations:read is unresolved", async () => {
    authState.userId = "user-a";
    authState.permissions = null;
    mocks.loadStatus.mockResolvedValueOnce(status("v1"));
    const { client, Wrapper } = createWrapper();
    const query = renderHook(() => useLarkIntegrationStatus(), {
      wrapper: Wrapper,
    });

    try {
      await waitFor(() => expect(query.result.current.isSuccess).toBe(true));
      expect(mocks.loadStatus.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
      expect(client.getQueryData(larkIntegrationQueryKey("user-a"))).toEqual(
        status("v1"),
      );
    } finally {
      query.unmount();
      client.clear();
    }
  });

  it("hides a caller-disabled status without removing the owner cache", () => {
    const { client, Wrapper } = createWrapper();
    const cached = status("private-status");
    const key = larkIntegrationQueryKey("owner-a");
    client.setQueryData(key, cached);
    const query = renderHook(() => useLarkIntegrationStatus(false), {
      wrapper: Wrapper,
    });

    try {
      expect(query.result.current.data).toBeUndefined();
      expect(query.result.current.isLoading).toBe(false);
      expect(query.result.current.error).toBeNull();
      expect(mocks.loadStatus).not.toHaveBeenCalled();
      expect(client.getQueryData(key)).toEqual(cached);
    } finally {
      query.unmount();
      client.clear();
    }
  });

  it("clears only this owner's status when integrations:read is denied", async () => {
    const { client, Wrapper } = createWrapper();
    const cached = status("private-status");
    const currentKey = larkIntegrationQueryKey("owner-a");
    const otherKey = larkIntegrationQueryKey("owner-b");
    client.setQueryData(currentKey, cached);
    client.setQueryData(otherKey, cached);
    authState.permissions = [];
    const query = renderHook(() => useLarkIntegrationStatus(), {
      wrapper: Wrapper,
    });

    try {
      expect(query.result.current.data).toBeUndefined();
      expect(query.result.current.isLoading).toBe(false);
      expect(query.result.current.error).toBeNull();
      await waitFor(() =>
        expect(client.getQueryData(currentKey)).toBeUndefined(),
      );
      expect(client.getQueryData(otherKey)).toEqual(cached);
      expect(mocks.loadStatus).not.toHaveBeenCalled();
    } finally {
      query.unmount();
      client.clear();
    }
  });

  it("aborts an in-flight status read when integrations:read is revoked", async () => {
    let signal: AbortSignal | undefined;
    authState.permissions = ["integrations:read"];
    mocks.loadStatus.mockImplementation((next: AbortSignal) => {
      signal = next;
      return new Promise(() => undefined);
    });
    const { client, Wrapper } = createWrapper();
    const query = renderHook(() => useLarkIntegrationStatus(), {
      wrapper: Wrapper,
    });

    try {
      await waitFor(() => expect(signal?.aborted).toBe(false));
      authState.permissions = [];
      query.rerender();
      await waitFor(() => expect(signal?.aborted).toBe(true));
      expect(query.result.current.data).toBeUndefined();
      expect(query.result.current.error).toBeNull();
    } finally {
      query.unmount();
      client.clear();
    }
  });

  it("invalidates only the initiating user's status cache after install", async () => {
    const { client, Wrapper } = createWrapper();
    const userAStatus = status("user-a-old-status");
    const userBStatus = status("user-b-status");
    authState.userId = "user-a";
    client.setQueryData(larkIntegrationQueryKey("user-a"), userAStatus);
    client.setQueryData(larkIntegrationQueryKey("user-b"), userBStatus);
    const installedStatus = status("installed-for-a");
    mocks.install.mockResolvedValueOnce({ status: installedStatus });
    const mutation = renderHook(() => useInstallLarkIntegration(), {
      wrapper: Wrapper,
    });

    try {
      await mutation.result.current.mutateAsync({ cacheScope: "user-b" });
      expect(
        client.getQueryState(larkIntegrationQueryKey("user-a"))?.isInvalidated,
      ).toBe(true);
      expect(client.getQueryData(larkIntegrationQueryKey("user-a"))).toEqual(
        userAStatus,
      );
      expect(
        client.getQueryState(larkIntegrationQueryKey("user-b"))?.isInvalidated,
      ).toBe(false);
      expect(client.getQueryData(larkIntegrationQueryKey("user-b"))).toEqual(
        userBStatus,
      );
    } finally {
      mutation.unmount();
      client.clear();
    }
  });
});
