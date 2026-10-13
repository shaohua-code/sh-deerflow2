import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = rs.hoisted(() => ({
  connectProvider: rs.fn(),
  configureProvider: rs.fn(),
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
  providersQueryEnabled: true,
  provider: {
    provider: "telegram",
    display_name: "Telegram",
    enabled: true,
    configured: true,
    auth_mode: "oauth",
    connection_status: "disconnected",
    credential_fields: [],
  },
}));

rs.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  SidebarGroupLabel: ({ children }: { children: ReactNode }) => (
    <h2>{children}</h2>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
  useSidebar: () => ({ open: true }),
}));
rs.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <span />,
}));
rs.mock("@/core/channels/hooks", () => ({
  useChannelProviders: (queryEnabled = true) => {
    mocks.providersQueryEnabled = queryEnabled;
    return {
      enabled: true,
      providers: [mocks.provider],
      isLoading: false,
      error: undefined,
    };
  },
  useConfigureChannelProvider: () => ({
    isPending: false,
    mutateAsync: mocks.configureProvider,
  }),
  useConnectChannelProvider: () => ({
    isPending: false,
    mutateAsync: mocks.connectProvider,
  }),
}));
rs.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
rs.mock("@/components/workspace/channels/channel-provider-icon", () => ({
  ChannelProviderIcon: () => null,
}));
rs.mock(
  "@/components/workspace/channels/channel-runtime-config-dialog",
  () => ({
    ChannelRuntimeConfigDialog: () => null,
  }),
);

import { WorkspaceChannelsList } from "@/components/workspace/channels/workspace-channels-list";
import { AuthProvider } from "@/core/auth/AuthProvider";
import { I18nProvider } from "@/core/i18n/context";

beforeEach(() => {
  mocks.providersQueryEnabled = true;
  mocks.provider = {
    provider: "telegram",
    display_name: "Telegram",
    enabled: true,
    configured: true,
    auth_mode: "oauth",
    connection_status: "disconnected",
    credential_fields: [],
  };
  mocks.connectProvider
    .mockReset()
    .mockRejectedValue(new Error("private channel credential detail"));
  mocks.configureProvider.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
});

afterEach(() => {
  cleanup();
  document.cookie = "locale=; max-age=0; path=/";
});

describe("WorkspaceChannelsList mutation errors", () => {
  it("shows localized safe copy instead of a backend connect error", async () => {
    render(
      <I18nProvider initialLocale="zh-CN">
        <AuthProvider
          initialUser={{
            id: "admin-1",
            email: "admin@example.test",
            system_role: "admin",
            needs_setup: false,
            oauth_provider: null,
            permissions: ["channels:read", "channels:write", "channels:admin"],
          }}
        >
          <WorkspaceChannelsList />
        </AuthProvider>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "连接" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "无法发起渠道连接，请检查渠道配置后重试。",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private channel credential detail",
    );
  });

  it("hides cached providers and disables the query without channels:read", () => {
    render(
      <I18nProvider initialLocale="zh-CN">
        <AuthProvider
          initialUser={{
            id: "user-1",
            email: "user@example.test",
            system_role: "user",
            needs_setup: false,
            oauth_provider: null,
            permissions: [],
          }}
        >
          <WorkspaceChannelsList />
        </AuthProvider>
      </I18nProvider>,
    );

    expect(mocks.providersQueryEnabled).toBe(false);
    expect(screen.queryByText("Telegram")).toBeNull();
  });
});
