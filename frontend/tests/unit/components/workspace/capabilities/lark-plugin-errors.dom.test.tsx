import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";

import { LarkPluginSettings } from "@/components/workspace/capabilities/lark-plugin-settings";
import { AuthProvider } from "@/core/auth/AuthProvider";
import type { User } from "@/core/auth/types";
import { I18nProvider } from "@/core/i18n/context";
import {
  LarkIntegrationRequestError,
  type LarkAuthCompleteResponse,
  type LarkAuthStartResponse,
  type LarkIntegrationStatus,
} from "@/core/integrations/lark";

const mocks = rs.hoisted(() => ({
  permissions: null as string[] | null,
  statusEnabled: true,
  statusResult: null as unknown,
  refetch: rs.fn(),
  mutate: rs.fn(),
  startConfig: rs.fn(),
  startAuth: rs.fn(),
  completeAuth: rs.fn(),
  toastInfo: rs.fn(() => "lark-auth-toast"),
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
  toastDismiss: rs.fn(),
  installPending: false,
}));

rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn(), replace: rs.fn(), refresh: rs.fn() }),
  usePathname: () => "/workspace/capabilities",
  useSearchParams: () => new URLSearchParams(),
}));

rs.mock("@/core/integrations/lark", () => ({
  larkIntegrationQueryKey: ["integrations", "lark"],
  LarkIntegrationRequestError: class LarkIntegrationRequestError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
    get isAdminRequired() {
      return this.status === 403;
    }
  },
  useLarkIntegrationStatus: (enabled = true) => {
    mocks.statusEnabled = enabled;
    return enabled
      ? mocks.statusResult
      : {
          data: undefined,
          isLoading: false,
          isFetching: false,
          error: null,
          refetch: mocks.refetch,
        };
  },
  useInstallLarkIntegration: () => ({
    mutate: mocks.mutate,
    isPending: mocks.installPending,
  }),
  useStartLarkConfiguration: () => ({
    mutate: mocks.startConfig,
    isPending: false,
  }),
  useCompleteLarkConfiguration: () => ({
    mutate: mocks.mutate,
    isPending: false,
  }),
  useStartLarkAuthorization: () => ({
    mutate: mocks.startAuth,
    isPending: false,
  }),
  useCompleteLarkAuthorization: () => ({
    mutate: mocks.completeAuth,
    isPending: false,
  }),
  useSetLarkAppCredentials: () => ({ mutate: mocks.mutate, isPending: false }),
}));

rs.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    error: mocks.toastError,
    success: mocks.toastSuccess,
    dismiss: mocks.toastDismiss,
  },
}));

const readyStatus: LarkIntegrationStatus = {
  installed: true,
  version: "1.0.0",
  manifest_version: null,
  latest_available_version: null,
  runtime_version_mismatch: false,
  app_configured: true,
  app_id: "app-1",
  app_brand: "feishu",
  skills_expected: 0,
  skills_installed: 0,
  installed_skills: [],
  enabled_skills: [],
  install_path: "",
  cli: { available: true, path: null, version: null, error: null },
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

function mockReadyStatus() {
  mocks.statusResult = {
    data: readyStatus,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.refetch,
  };
  mocks.refetch.mockResolvedValue({ data: readyStatus });
}

type CompletionCallbacks = {
  onError: (error: Error) => void;
  onSuccess: (result: LarkAuthCompleteResponse) => void;
};

async function openAuthorization(expiresIn: number | null = 300) {
  mockReadyStatus();
  rs.spyOn(window, "open").mockReturnValue(null);
  mocks.startAuth.mockImplementation(
    (
      _request: unknown,
      callbacks: { onSuccess: (result: LarkAuthStartResponse) => void },
    ) => {
      callbacks.onSuccess({
        device_code: "device-1",
        generation: "server-flow-1",
        verification_url: "https://example.test/authorize",
        expires_in: expiresIn,
        user_code: null,
        hint: null,
      });
    },
  );
  const view = renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "Connect Lark" }));
  await waitFor(() => expect(mocks.completeAuth).toHaveBeenCalledTimes(1));
  return {
    ...view,
    completion: mocks.completeAuth.mock.calls[0]![1] as CompletionCallbacks,
  };
}

function makeUser(): User {
  return {
    id: "admin-1",
    email: "admin@example.test",
    system_role: "admin",
    needs_setup: false,
    oauth_provider: null,
    permissions: mocks.permissions,
  } as User;
}

function renderSettings(children?: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <I18nProvider initialLocale="en-US">
        <QueryClientProvider client={client}>
          <AuthProvider initialUser={makeUser()}>
            {children ?? <LarkPluginSettings />}
          </AuthProvider>
        </QueryClientProvider>
      </I18nProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  mocks.permissions = null;
  mocks.refetch.mockReset();
  mocks.mutate.mockReset();
  mocks.startConfig.mockReset();
  mocks.startAuth.mockReset();
  mocks.completeAuth.mockReset();
  mocks.toastInfo.mockClear();
  mocks.toastError.mockClear();
  mocks.toastSuccess.mockClear();
  mocks.toastDismiss.mockClear();
  mocks.installPending = false;
  mocks.statusEnabled = true;
  mocks.statusResult = null;
  rs.restoreAllMocks();
});

describe("Lark integration error presentation", () => {
  it("disables install and connection when integration write permission is denied", () => {
    mockReadyStatus();
    mocks.permissions = ["integrations:read"];

    renderSettings();

    expect(screen.getByRole("status").textContent).toContain(
      "You do not have permission to manage this integration.",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Lark",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Reinstall" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Connect Lark" }));
    expect(mocks.startAuth).not.toHaveBeenCalled();
  });

  it("does not fetch or refresh integration status after explicit read denial", () => {
    mockReadyStatus();
    mocks.permissions = [];

    renderSettings();

    expect(mocks.statusEnabled).toBe(false);
    expect(screen.getByRole("status").textContent).toContain(
      "You do not have permission to manage this integration.",
    );
    expect(screen.queryByText("Skill pack")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it.each(["request failure", "missing fresh data"])(
    "does not start authorization from stale status after %s",
    async (failure) => {
      mockReadyStatus();
      const close = rs.fn();
      rs.spyOn(window, "open").mockReturnValue({
        close,
        opener: null,
      } as unknown as Window);
      rs.spyOn(console, "error").mockImplementation(() => undefined);
      if (failure === "request failure") {
        mocks.refetch.mockRejectedValue(
          new Error("private status diagnostics"),
        );
      } else {
        mocks.refetch.mockResolvedValue({ data: undefined });
      }
      const { client } = renderSettings();

      fireEvent.click(screen.getByRole("button", { name: "Connect Lark" }));
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1));

      expect(mocks.refetch).toHaveBeenCalledWith({ throwOnError: true });
      expect(mocks.startAuth).not.toHaveBeenCalled();
      expect(mocks.startConfig).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole("button", {
            name: "Connect Lark",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't load Lark integration status. Refresh and try again.",
        undefined,
      );
      client.clear();
    },
  );

  it("releases a superseded authorization and ignores its later completion", async () => {
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, completion } = await openAuthorization();

    act(() =>
      completion.onError(
        new LarkIntegrationRequestError(409, "private flow detail"),
      ),
    );

    expect(
      screen.queryByRole("button", { name: "Start connection again" }),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Lark",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "A newer connection replaced this authorization. Start the connection again.",
      undefined,
    );
    act(() =>
      completion.onSuccess({
        success: true,
        message: "late completion",
        status: readyStatus,
      }),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    client.clear();
  });

  it("keeps an ambiguous failure retryable and allows starting a new connection", async () => {
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, completion } = await openAuthorization();
    act(() =>
      completion.onError(
        new LarkIntegrationRequestError(400, "private CLI error"),
      ),
    );

    const restart = screen.getByRole("button", {
      name: "Start connection again",
    }) as HTMLButtonElement;
    expect(restart.disabled).toBe(false);
    fireEvent.click(restart);
    await waitFor(() => expect(mocks.startAuth).toHaveBeenCalledTimes(2));

    act(() =>
      completion.onSuccess({
        success: true,
        message: "old completion",
        status: readyStatus,
      }),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Start connection again" }),
    ).toBeDefined();
    client.clear();
  });

  it("keeps waiting after a short automatic authorization timeout", async () => {
    const { client, completion, unmount } = await openAuthorization();
    act(() =>
      completion.onError(
        new LarkIntegrationRequestError(504, "private CLI timeout"),
      ),
    );

    expect(
      screen.getByRole("button", { name: "Start connection again" }),
    ).toBeDefined();
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Lark",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.toastError).not.toHaveBeenCalled();
    unmount();
    client.clear();
  });

  it("ends the local wait at the returned deadline without claiming server expiry", async () => {
    const clock = rs.spyOn(Date, "now").mockReturnValue(100_000);
    const { client, completion } = await openAuthorization(1);
    clock.mockReturnValue(101_001);

    act(() =>
      completion.onSuccess({
        success: false,
        message: "private status",
        status: readyStatus,
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Start connection again" }),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Lark",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(mocks.toastInfo).toHaveBeenLastCalledWith(
      "Automatic authorization checks ended without confirming completion. Start the connection again to continue.",
    );
    client.clear();
  });

  it("rechecks the deadline when an already scheduled retry fires", async () => {
    const clock = rs.spyOn(Date, "now").mockReturnValue(100_000);
    const timers = rs.spyOn(globalThis, "setTimeout");
    const { client, completion } = await openAuthorization(1);
    act(() =>
      completion.onSuccess({
        success: false,
        message: "pending",
        status: readyStatus,
      }),
    );

    const retryIndex = timers.mock.calls.findIndex(
      ([, delay]) => delay === 1500,
    );
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    const retry = timers.mock.calls[retryIndex]?.[0];
    const retryHandle = timers.mock.results[retryIndex]?.value as ReturnType<
      typeof setTimeout
    >;
    clearTimeout(retryHandle);
    clock.mockReturnValue(101_500);
    act(() => {
      if (typeof retry !== "function")
        throw new Error("Missing authorization retry callback");
      retry();
    });

    expect(mocks.completeAuth).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Lark",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(mocks.toastInfo).toHaveBeenLastCalledWith(
      "Automatic authorization checks ended without confirming completion. Start the connection again to continue.",
    );
    client.clear();
  });

  it("reports active Gateway mutations to its dialog owner", () => {
    mocks.installPending = true;
    mocks.statusResult = {
      data: {
        installed: false,
        version: "1.0.0",
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
          status: "not_authenticated",
          message: null,
          user: null,
          verified: false,
        },
        sandbox_runtime_mode: "none",
        sandbox_runtime_ready: false,
        sandbox_runtime_detail: null,
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mocks.refetch,
    };
    const onBusyChange = rs.fn();

    const { client } = renderSettings(
      <LarkPluginSettings onBusyChange={onBusyChange} />,
    );

    expect(onBusyChange).toHaveBeenCalledWith(true);
    client.clear();
  });

  it("shows localized status guidance instead of the Gateway error body", () => {
    const privateDetail = "private Gateway path and credential detail";
    const error = new Error(privateDetail);
    const log = rs.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.statusResult = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error,
      refetch: mocks.refetch,
    };

    const { client } = renderSettings();

    expect(
      screen.getByText(
        "Couldn't load Lark integration status. Refresh and try again.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText(privateDetail)).toBeNull();
    expect(log).toHaveBeenCalledWith(
      "Failed to load Lark integration status:",
      error,
    );
    client.clear();
  });

  it("uses stable copy for CLI, sandbox and authorization status details", () => {
    const privateCliDetail = "private Gateway executable path";
    const privateSandboxDetail = "private container runtime diagnostics";
    const privateAuthDetail = "private OAuth provider response";
    mocks.statusResult = {
      data: {
        installed: false,
        version: "1.0.0",
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
        cli: {
          available: false,
          path: null,
          version: null,
          error: privateCliDetail,
        },
        auth: {
          status: "error",
          message: privateAuthDetail,
          user: null,
          verified: false,
        },
        sandbox_runtime_mode: "gateway-download",
        sandbox_runtime_ready: false,
        sandbox_runtime_detail: privateSandboxDetail,
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: mocks.refetch,
    };

    const { client } = renderSettings();

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Not ready — lark-cli may be missing at chat time"),
    ).not.toBeNull();
    expect(screen.queryByText(privateCliDetail)).toBeNull();
    expect(screen.queryByText(privateSandboxDetail)).toBeNull();
    expect(screen.queryByText(privateAuthDetail)).toBeNull();
    client.clear();
  });
});
