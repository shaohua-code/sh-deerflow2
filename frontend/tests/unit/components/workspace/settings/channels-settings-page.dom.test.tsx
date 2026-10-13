import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ChannelsSettingsPage } from "@/components/workspace/settings/channels-settings-page";
import type {
  ChannelProvider,
  ChannelRuntimeConfigValues,
} from "@/core/channels/types";
import { AuthProvider } from "@/core/auth/AuthProvider";
import { I18nProvider } from "@/core/i18n/context";

const mocks = rs.hoisted(() => ({
  useProviders: rs.fn(),
  useConnections: rs.fn(),
  refetchProviders: rs.fn(),
  refetchConnections: rs.fn(),
  connectProvider: rs.fn(),
  configureProvider: rs.fn(),
  disconnectConnection: rs.fn(),
  disconnectProvider: rs.fn(),
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
}));

rs.mock("@/core/channels/hooks", () => ({
  useChannelProviders: (queryEnabled = true) =>
    mocks.useProviders(queryEnabled),
  useChannelConnections: (queryEnabled = true) =>
    mocks.useConnections(queryEnabled),
  useConfigureChannelProvider: () => ({
    isPending: false,
    mutateAsync: mocks.configureProvider,
  }),
  useConnectChannelProvider: () => ({
    isPending: false,
    mutateAsync: mocks.connectProvider,
  }),
  useDisconnectChannelConnection: () => ({
    isPending: false,
    mutateAsync: mocks.disconnectConnection,
  }),
  useDisconnectChannelProvider: () => ({
    isPending: false,
    mutateAsync: mocks.disconnectProvider,
  }),
}));
rs.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
rs.mock(
  "@/components/workspace/channels/channel-runtime-config-dialog",
  () => ({
    ChannelRuntimeConfigDialog: ({
      provider,
      open,
      onSubmit,
    }: {
      provider: ChannelProvider;
      open: boolean;
      onSubmit: (
        provider: ChannelProvider,
        values: ChannelRuntimeConfigValues,
      ) => void;
    }) =>
      open ? (
        <button onClick={() => onSubmit(provider, {})}>
          Save channel settings
        </button>
      ) : null,
  }),
);

const cachedProvider = {
  provider: "telegram",
  display_name: "Telegram",
  enabled: true,
  configured: true,
  auth_mode: "oauth",
  connection_status: "disconnected",
  credential_fields: [],
};

function renderPage(
  locale: "en-US" | "zh-CN" = "en-US",
  permissions = ["channels:read", "channels:write", "channels:admin"],
) {
  return render(
    <I18nProvider initialLocale={locale}>
      <AuthProvider
        initialUser={{
          id: "admin-1",
          email: "admin@example.test",
          system_role: "admin",
          needs_setup: false,
          oauth_provider: null,
          permissions,
        }}
      >
        <ChannelsSettingsPage />
      </AuthProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.refetchProviders.mockReset().mockResolvedValue({ data: undefined });
  mocks.refetchConnections.mockReset().mockResolvedValue({ data: undefined });
  mocks.connectProvider.mockReset().mockResolvedValue({});
  mocks.configureProvider.mockReset().mockResolvedValue(cachedProvider);
  mocks.disconnectConnection.mockReset().mockResolvedValue(undefined);
  mocks.disconnectProvider.mockReset().mockResolvedValue(cachedProvider);
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.useProviders.mockReset().mockReturnValue({
    enabled: true,
    providers: [cachedProvider],
    isLoading: false,
    isFetching: false,
    hasData: true,
    error: undefined,
    refetch: mocks.refetchProviders,
  });
  mocks.useConnections.mockReset().mockReturnValue({
    connections: [],
    isLoading: false,
    isFetching: false,
    hasData: true,
    error: undefined,
    refetch: mocks.refetchConnections,
  });
});

afterEach(() => {
  cleanup();
  document.cookie = "locale=; max-age=0; path=/";
});

describe("ChannelsSettingsPage read error state", () => {
  it("does not render cached channel details without channels:read", () => {
    renderPage("en-US", ["channels:write"]);

    expect(
      screen.getByText(/permission to view channel connections/),
    ).toBeDefined();
    expect(screen.queryByText("Telegram")).toBeNull();
    expect(mocks.useProviders).toHaveBeenCalledWith(false);
    expect(mocks.useConnections).toHaveBeenCalledWith(false);
  });

  it("disables connection mutations when channels:write is denied", () => {
    renderPage("en-US", ["channels:read"]);

    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect.hasAttribute("disabled")).toBe(true);
    expect(connect.title).toContain("channels:write");
  });

  it("keeps runtime credential editing behind channel admin permission", () => {
    mocks.useProviders.mockReturnValue({
      enabled: true,
      providers: [
        {
          ...cachedProvider,
          credential_fields: [
            { name: "token", label: "Token", type: "password", required: true },
          ],
        },
      ],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: undefined,
      refetch: mocks.refetchProviders,
    });

    renderPage("en-US", ["channels:read", "channels:write"]);

    expect(
      screen.getByText(/system administrator with channels:admin/),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Modify" })).toBeNull();
  });

  it("does not start a channel connection after saving runtime settings without channels:write", async () => {
    mocks.useProviders.mockReturnValue({
      enabled: true,
      providers: [
        {
          ...cachedProvider,
          configured: false,
          credential_fields: [
            { name: "token", label: "Token", type: "password", required: true },
          ],
        },
      ],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: undefined,
      refetch: mocks.refetchProviders,
    });

    renderPage("en-US", ["channels:read", "channels:admin"]);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save channel settings" }),
    );

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Channel settings were saved. You do not have permission to start the connection.",
      ),
    );
    expect(mocks.connectProvider).not.toHaveBeenCalled();
  });

  it("localizes the initial failure and retries both channel queries", () => {
    document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
    mocks.useProviders.mockReturnValue({
      enabled: false,
      providers: [],
      isLoading: false,
      isFetching: false,
      hasData: false,
      error: new Error("private provider details"),
      refetch: mocks.refetchProviders,
    });
    mocks.useConnections.mockReturnValue({
      connections: [],
      isLoading: false,
      isFetching: false,
      hasData: false,
      error: undefined,
      refetch: mocks.refetchConnections,
    });

    renderPage("zh-CN");

    expect(screen.getByText("暂时无法加载渠道状态。")).toBeDefined();
    expect(screen.queryByText("private provider details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(mocks.refetchProviders).toHaveBeenCalledTimes(1);
    expect(mocks.refetchConnections).toHaveBeenCalledTimes(1);
  });

  it("keeps the complete cached provider list visible after a refresh error", () => {
    mocks.useConnections.mockReturnValue({
      connections: [],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: new Error("private connection details"),
      refetch: mocks.refetchConnections,
    });

    renderPage();

    expect(
      screen.getByText(/Showing the last successfully loaded channel/),
    ).toBeDefined();
    expect(screen.getByText("Telegram")).toBeDefined();
    expect(screen.queryByText("private connection details")).toBeNull();
  });

  it("shows localized safe copy instead of a backend connect error", async () => {
    document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
    mocks.connectProvider.mockRejectedValue(
      new Error("private provider credential detail"),
    );

    renderPage("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "连接" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "无法发起渠道连接，请检查渠道配置后重试。",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private provider credential detail",
    );
  });

  it("shows localized safe copy instead of a backend disconnect error", async () => {
    mocks.useProviders.mockReturnValue({
      enabled: true,
      providers: [{ ...cachedProvider, connection_status: "connected" }],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: undefined,
      refetch: mocks.refetchProviders,
    });
    mocks.useConnections.mockReturnValue({
      connections: [
        {
          id: "connection-1",
          provider: "telegram",
          status: "connected",
          scopes: [],
          metadata: {},
        },
      ],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: undefined,
      refetch: mocks.refetchConnections,
    });
    mocks.disconnectConnection.mockRejectedValue(
      new Error("private provider credential detail"),
    );

    renderPage("en-US");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not disconnect the channel. Please try again.",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private provider credential detail",
    );
  });

  it("lets a channel user disconnect their own binding without admin permission", () => {
    mocks.useProviders.mockReturnValue({
      enabled: true,
      providers: [{ ...cachedProvider, connection_status: "connected" }],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: undefined,
      refetch: mocks.refetchProviders,
    });
    mocks.useConnections.mockReturnValue({
      connections: [
        {
          id: "connection-1",
          provider: "telegram",
          status: "connected",
          scopes: [],
          metadata: {},
        },
      ],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: undefined,
      refetch: mocks.refetchConnections,
    });

    renderPage("en-US", ["channels:read", "channels:write"]);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(mocks.disconnectConnection).toHaveBeenCalledWith("connection-1");
    expect(mocks.disconnectProvider).not.toHaveBeenCalled();
  });

  it("shows localized safe copy instead of a backend configuration error", async () => {
    mocks.useProviders.mockReturnValue({
      enabled: true,
      providers: [
        {
          ...cachedProvider,
          credential_fields: [
            { name: "token", label: "Token", type: "password", required: true },
          ],
        },
      ],
      isLoading: false,
      isFetching: false,
      hasData: true,
      error: undefined,
      refetch: mocks.refetchProviders,
    });
    mocks.configureProvider.mockRejectedValue(
      new Error("private provider credential detail"),
    );

    renderPage("en-US");
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save channel settings" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not save channel settings. Check the values and try again.",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private provider credential detail",
    );
  });
});
