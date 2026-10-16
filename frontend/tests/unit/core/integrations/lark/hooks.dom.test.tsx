import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  install: rs.fn(),
  loadStatus: rs.fn(),
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
});

describe("Lark integration status permissions and owner cache", () => {
  it("keeps status caches separate when two users open the same workspace", async () => {
    const { client, Wrapper } = createWrapper();
    const userAStatus = status("user-a-version");
    const userBStatus = status("user-b-version");
    client.setQueryData(larkIntegrationQueryKey("user-a"), userAStatus);
    mocks.loadStatus.mockResolvedValueOnce(userBStatus);

    const query = renderHook(() => useLarkIntegrationStatus(true, "user-b"), {
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

  it("hides and removes status data and cancels reads when access is denied", async () => {
    const { client, Wrapper } = createWrapper();
    const key = larkIntegrationQueryKey("user-a");
    client.setQueryData(key, status("private-status"));
    const query = renderHook(() => useLarkIntegrationStatus(false, "user-a"), {
      wrapper: Wrapper,
    });

    try {
      expect(query.result.current.data).toBeUndefined();
      expect(mocks.loadStatus).not.toHaveBeenCalled();
      await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
    } finally {
      query.unmount();
      client.clear();
    }
  });

  it("passes React Query cancellation signals to authorized status reads", async () => {
    const { client, Wrapper } = createWrapper();
    mocks.loadStatus.mockResolvedValueOnce(status("v1"));
    const query = renderHook(() => useLarkIntegrationStatus(true, "user-a"), {
      wrapper: Wrapper,
    });

    try {
      await waitFor(() => expect(query.result.current.isSuccess).toBe(true));
      expect(mocks.loadStatus.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    } finally {
      query.unmount();
      client.clear();
    }
  });

  it("invalidates only the initiating user's status cache after install", async () => {
    const { client, Wrapper } = createWrapper();
    const userAStatus = status("user-a-old-status");
    const userBStatus = status("user-b-status");
    client.setQueryData(larkIntegrationQueryKey("user-a"), userAStatus);
    client.setQueryData(larkIntegrationQueryKey("user-b"), userBStatus);
    const installedStatus = status("installed-for-a");
    mocks.install.mockResolvedValueOnce({ status: installedStatus });
    const mutation = renderHook(() => useInstallLarkIntegration(), {
      wrapper: Wrapper,
    });

    try {
      await mutation.result.current.mutateAsync({ cacheScope: "user-a" });
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
