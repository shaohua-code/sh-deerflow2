import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  fetchAdminSettings: rs.fn(),
  fetchAuditEvents: rs.fn(),
  fetchAdminUsers: rs.fn(),
  updateAdminUserStatus: rs.fn(),
  updateAdminSettings: rs.fn(),
}));
const auth = rs.hoisted(() => ({ userId: "admin-1" }));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () =>
    auth.userId
      ? {
          user: {
            id: auth.userId,
            system_role: "admin",
            permissions: ["product:admin", "accounts:admin"],
          },
        }
      : { user: null },
}));

rs.mock("@/product/api", () => ({
  fetchProductAdminSettings: mocks.fetchAdminSettings,
  fetchProductAuditEvents: mocks.fetchAuditEvents,
  fetchAdminUsers: mocks.fetchAdminUsers,
  updateAdminUserStatus: mocks.updateAdminUserStatus,
  AdminUserStatusConflictError: class AdminUserStatusConflictError extends Error {},
  updateProductAdminSettings: mocks.updateAdminSettings,
  ProductConfigConflictError: class ProductConfigConflictError extends Error {},
}));

import { ProductAdminPage } from "@/components/workspace/settings/product-admin-page";
import { I18nProvider } from "@/core/i18n/context";

function Wrapper({
  children,
  locale = "en-US",
  queryClient,
}: PropsWithChildren<{
  locale?: "en-US" | "zh-CN";
  queryClient?: QueryClient;
}>) {
  const client =
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale={locale}>{children}</I18nProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.fetchAdminSettings.mockResolvedValue({
    api_version: 1,
    version: 1,
    product: {
      name: "Flow Desk",
      name_zh: "工作台",
      features: {
        overview: true,
        chats: true,
        agents: true,
        scheduled_tasks: true,
        capabilities: true,
        files: false,
        data_privacy: false,
        administration: true,
      },
    },
  });
  mocks.fetchAdminUsers.mockResolvedValue({
    users: [
      {
        id: "user-2",
        email: "member@example.com",
        system_role: "user",
        is_active: true,
        needs_setup: false,
        created_at: "2026-09-26T08:00:00Z",
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  });
  // 服务端动作码是稳定协议；页面负责翻译它们，并为未来动作提供可读回退。
  mocks.fetchAuditEvents.mockResolvedValue({
    api_version: 1,
    limit: 50,
    offset: 0,
    events: [
      {
        event_id: "event-skill-update",
        actor_user_id: "user-1",
        action: "skill.custom.update",
        resource_type: "skill",
        resource_id: null,
        outcome: "success",
        occurred_at: "2026-09-27T08:00:05Z",
        request_id: null,
      },
      {
        event_id: "event-known",
        actor_user_id: "user-1",
        action: "settings.write",
        resource_type: "user_setting",
        resource_id: "density",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:00Z",
        request_id: "request-1",
      },
      {
        event_id: "event-account",
        actor_user_id: "user-1",
        action: "account.status.disable",
        resource_type: "account",
        resource_id: "user-3",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:30Z",
        request_id: "request-account",
      },
      {
        event_id: "event-export-failed",
        actor_user_id: "user-1",
        action: "data.export.failed",
        resource_type: "data_job",
        resource_id: "job-1",
        outcome: "failure",
        occurred_at: "2026-09-27T08:00:45Z",
        request_id: "request-export",
      },
      {
        event_id: "event-export-cancelled",
        actor_user_id: "user-1",
        action: "data.export.cancelled",
        resource_type: "data_job",
        resource_id: "job-2",
        outcome: "cancelled",
        occurred_at: "2026-09-27T08:00:50Z",
        request_id: "request-cancel",
      },
      {
        event_id: "event-download",
        actor_user_id: "user-1",
        action: "data.export.download_requested",
        resource_type: "data_job",
        resource_id: "job-3",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:55Z",
        request_id: "request-download",
      },
      {
        event_id: "event-thread-delete",
        actor_user_id: "user-1",
        action: "thread.delete",
        resource_type: "thread",
        resource_id: "thread-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:57Z",
        request_id: "request-thread-delete",
      },
      {
        event_id: "event-thread-create",
        actor_user_id: "user-1",
        action: "thread.create",
        resource_type: "thread",
        resource_id: "thread-created",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:56Z",
        request_id: "request-thread-create",
      },
      {
        event_id: "event-thread-branch",
        actor_user_id: "user-1",
        action: "thread.branch",
        resource_type: "thread",
        resource_id: "thread-branch",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:56.100Z",
        request_id: "request-thread-branch",
      },
      {
        event_id: "event-thread-update",
        actor_user_id: "user-1",
        action: "thread.update",
        resource_type: "thread",
        resource_id: "thread-update",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:56.200Z",
        request_id: "request-thread-update",
      },
      {
        event_id: "event-thread-move",
        actor_user_id: "user-1",
        action: "thread.move",
        resource_type: "thread",
        resource_id: "thread-move",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:56.300Z",
        request_id: "request-thread-move",
      },
      {
        event_id: "event-upload-delete",
        actor_user_id: "user-1",
        action: "upload.delete",
        resource_type: "thread_upload",
        resource_id: "thread-2",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:58Z",
        request_id: "request-upload-delete",
      },
      {
        event_id: "event-upload-create",
        actor_user_id: "user-1",
        action: "upload.create",
        resource_type: "thread_upload",
        resource_id: "thread-4",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:58.500Z",
        request_id: "request-upload-create",
      },
      {
        event_id: "event-project-document-trash",
        actor_user_id: "user-1",
        action: "project.document.trash",
        resource_type: "project_document",
        resource_id: "document-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:00:59Z",
        request_id: "request-project-document-trash",
      },
      {
        event_id: "event-project-document-restore",
        actor_user_id: "user-1",
        action: "project.document.restore",
        resource_type: "project_document",
        resource_id: "document-2",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:00Z",
        request_id: "request-project-document-restore",
      },
      {
        event_id: "event-project-document-purge",
        actor_user_id: "user-1",
        action: "project.document.purge",
        resource_type: "project_document",
        resource_id: "document-3",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:01Z",
        request_id: "request-project-document-purge",
      },
      {
        event_id: "event-project-trash-empty",
        actor_user_id: "user-1",
        action: "project.trash.empty",
        resource_type: "project_trash",
        resource_id: null,
        outcome: "failure",
        occurred_at: "2026-09-27T08:01:02Z",
        request_id: "request-project-trash-empty",
      },
      {
        event_id: "event-project-create",
        actor_user_id: "user-1",
        action: "project.create",
        resource_type: "project",
        resource_id: "project-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:03Z",
        request_id: "request-project-create",
      },
      {
        event_id: "event-project-update",
        actor_user_id: "user-1",
        action: "project.update",
        resource_type: "project",
        resource_id: "project-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:04Z",
        request_id: "request-project-update",
      },
      {
        event_id: "event-project-archive",
        actor_user_id: "user-1",
        action: "project.archive",
        resource_type: "project",
        resource_id: "project-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:05Z",
        request_id: "request-project-archive",
      },
      {
        event_id: "event-project-restore",
        actor_user_id: "user-1",
        action: "project.restore",
        resource_type: "project",
        resource_id: "project-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:06Z",
        request_id: "request-project-restore",
      },
      {
        event_id: "event-project-delete",
        actor_user_id: "user-1",
        action: "project.delete",
        resource_type: "project",
        resource_id: "project-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:07Z",
        request_id: "request-project-delete",
      },
      {
        event_id: "event-scheduled-task-create",
        actor_user_id: "user-1",
        action: "scheduled_task.create",
        resource_type: "scheduled_task",
        resource_id: "task-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:08Z",
        request_id: "request-scheduled-task-create",
      },
      {
        event_id: "event-scheduled-task-update",
        actor_user_id: "user-1",
        action: "scheduled_task.update",
        resource_type: "scheduled_task",
        resource_id: "task-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:09Z",
        request_id: "request-scheduled-task-update",
      },
      {
        event_id: "event-scheduled-task-pause",
        actor_user_id: "user-1",
        action: "scheduled_task.pause",
        resource_type: "scheduled_task",
        resource_id: "task-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:10Z",
        request_id: "request-scheduled-task-pause",
      },
      {
        event_id: "event-scheduled-task-resume",
        actor_user_id: "user-1",
        action: "scheduled_task.resume",
        resource_type: "scheduled_task",
        resource_id: "task-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:11Z",
        request_id: "request-scheduled-task-resume",
      },
      {
        event_id: "event-scheduled-task-trigger",
        actor_user_id: "user-1",
        action: "scheduled_task.trigger",
        resource_type: "scheduled_task",
        resource_id: "task-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:12Z",
        request_id: "request-scheduled-task-trigger",
      },
      {
        event_id: "event-scheduled-task-delete",
        actor_user_id: "user-1",
        action: "scheduled_task.delete",
        resource_type: "scheduled_task",
        resource_id: "task-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:13Z",
        request_id: "request-scheduled-task-delete",
      },
      {
        event_id: "event-memory-clear",
        actor_user_id: "user-1",
        action: "memory.clear",
        resource_type: "memory",
        resource_id: "",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:14Z",
        request_id: "request-memory-clear",
      },
      {
        event_id: "event-memory-export",
        actor_user_id: "user-1",
        action: "memory.export",
        resource_type: "memory",
        resource_id: "",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:15Z",
        request_id: "request-memory-export",
      },
      {
        event_id: "event-memory-import",
        actor_user_id: "user-1",
        action: "memory.import",
        resource_type: "memory",
        resource_id: "",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:16Z",
        request_id: "request-memory-import",
      },
      {
        event_id: "event-memory-fact-create",
        actor_user_id: "user-1",
        action: "memory.fact.create",
        resource_type: "memory_fact",
        resource_id: "fact-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:17Z",
        request_id: "request-memory-fact-create",
      },
      {
        event_id: "event-memory-fact-update",
        actor_user_id: "user-1",
        action: "memory.fact.update",
        resource_type: "memory_fact",
        resource_id: "fact-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:18Z",
        request_id: "request-memory-fact-update",
      },
      {
        event_id: "event-memory-fact-delete",
        actor_user_id: "user-1",
        action: "memory.fact.delete",
        resource_type: "memory_fact",
        resource_id: "fact-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:19Z",
        request_id: "request-memory-fact-delete",
      },
      {
        event_id: "event-custom-agent-create",
        actor_user_id: "user-1",
        action: "custom_agent.create",
        resource_type: "custom_agent",
        resource_id: "researcher",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:20Z",
        request_id: "request-custom-agent-create",
      },
      {
        event_id: "event-custom-agent-update",
        actor_user_id: "user-1",
        action: "custom_agent.update",
        resource_type: "custom_agent",
        resource_id: "researcher",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:21Z",
        request_id: "request-custom-agent-update",
      },
      {
        event_id: "event-custom-agent-delete",
        actor_user_id: "user-1",
        action: "custom_agent.delete",
        resource_type: "custom_agent",
        resource_id: "researcher",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:22Z",
        request_id: "request-custom-agent-delete",
      },
      {
        event_id: "event-user-profile-update",
        actor_user_id: "user-1",
        action: "user_profile.update",
        resource_type: "user_profile",
        resource_id: "",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:23Z",
        request_id: "request-user-profile-update",
      },
      {
        event_id: "event-pat-create",
        actor_user_id: "user-1",
        action: "auth.pat.create",
        resource_type: "personal_access_token",
        resource_id: "pat-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:24Z",
        request_id: "request-pat-create",
      },
      {
        event_id: "event-pat-revoke",
        actor_user_id: "user-1",
        action: "auth.pat.revoke",
        resource_type: "personal_access_token",
        resource_id: "pat-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:25Z",
        request_id: "request-pat-revoke",
      },
      {
        event_id: "event-password-change",
        actor_user_id: "user-1",
        action: "auth.password.change",
        resource_type: "account",
        resource_id: "user-1",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:26Z",
        request_id: "request-password-change",
      },
      {
        event_id: "event-account-register",
        actor_user_id: "user-3",
        action: "auth.account.register",
        resource_type: "account",
        resource_id: "user-3",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:27Z",
        request_id: "request-account-register",
      },
      {
        event_id: "event-admin-initialize",
        actor_user_id: "user-4",
        action: "auth.admin.initialize",
        resource_type: "account",
        resource_id: "user-4",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:28Z",
        request_id: "request-admin-initialize",
      },
      {
        event_id: "event-oidc-provision",
        actor_user_id: "user-5",
        action: "auth.oidc.provision",
        resource_type: "account",
        resource_id: "user-5",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:29Z",
        request_id: "request-oidc-provision",
      },
      {
        event_id: "event-oidc-login",
        actor_user_id: "user-6",
        action: "auth.oidc.login",
        resource_type: "account",
        resource_id: "user-6",
        outcome: "success",
        occurred_at: "2026-09-27T08:01:30Z",
        request_id: "request-oidc-login",
      },
      {
        event_id: "event-unknown",
        actor_user_id: "user-2",
        action: "future.action",
        resource_type: "future_resource",
        resource_id: "item-2",
        outcome: "future_outcome",
        occurred_at: "2026-09-27T08:01:00Z",
        request_id: null,
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  document.cookie = "locale=; Max-Age=0; path=/";
  auth.userId = "admin-1";
  rs.clearAllMocks();
});

describe("ProductAdminPage activity audit", () => {
  it("hides another administrator's cached data after an account switch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["product", "admin-settings", "admin-1"], {
      api_version: 1,
      version: 7,
      product: {
        name: "Secret Admin One",
        name_zh: "管理员一私有配置",
        features: {
          overview: true,
          chats: true,
          agents: true,
          scheduled_tasks: true,
          capabilities: true,
          files: false,
          data_privacy: false,
          administration: true,
        },
      },
    });
    queryClient.setQueryData(["product", "admin-users", "admin-1", 50, 0], {
      users: [
        {
          id: "private-user",
          email: "private-admin-one@example.com",
          system_role: "user",
          is_active: true,
          needs_setup: false,
          created_at: "2026-09-26T08:00:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    queryClient.setQueryData(["product", "audit-events", "admin-1", 50, 0], {
      api_version: 1,
      limit: 50,
      offset: 0,
      events: [
        {
          event_id: "private-event",
          actor_user_id: "private-admin-one-actor",
          action: "settings.write",
          resource_type: "user_setting",
          resource_id: "display",
          outcome: "success",
          occurred_at: "2026-09-27T08:00:00Z",
          request_id: null,
        },
      ],
    });
    mocks.fetchAdminSettings.mockReturnValue(new Promise(() => undefined));
    mocks.fetchAdminUsers.mockReturnValue(new Promise(() => undefined));
    mocks.fetchAuditEvents.mockReturnValue(new Promise(() => undefined));
    function CachedWrapper({ children }: PropsWithChildren) {
      return <Wrapper queryClient={queryClient}>{children}</Wrapper>;
    }

    const view = render(<ProductAdminPage />, { wrapper: CachedWrapper });
    expect(
      await screen.findByRole("textbox", { name: "English product name" }),
    ).toHaveProperty("value", "Secret Admin One");
    expect(screen.getAllByText("private-admin-one@example.com")).toHaveLength(
      2,
    );
    expect(screen.getByText("private-admin-one-actor")).toBeDefined();

    auth.userId = "admin-2";
    view.rerender(<ProductAdminPage />);

    expect(screen.queryByDisplayValue("Secret Admin One")).toBeNull();
    expect(screen.queryByText("private-admin-one@example.com")).toBeNull();
    expect(screen.queryByText("private-admin-one-actor")).toBeNull();
    queryClient.clear();
  });

  it("keeps a late settings response in the administrator cache that started it", async () => {
    const cachedSettings = {
      api_version: 1,
      version: 7,
      product: {
        name: "Flow Desk",
        name_zh: "工作台",
        features: {
          overview: true,
          chats: true,
          agents: true,
          scheduled_tasks: true,
          capabilities: true,
          files: false,
          data_privacy: false,
          administration: true,
        },
      },
    };
    const savedSettings = {
      ...cachedSettings,
      version: 8,
      product: { ...cachedSettings.product, name: "Saved by Admin One" },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      ["product", "admin-settings", "admin-1"],
      cachedSettings,
    );
    mocks.fetchAdminSettings.mockReturnValue(new Promise(() => undefined));
    let resolveSave!: (settings: typeof savedSettings) => void;
    mocks.updateAdminSettings.mockReturnValue(
      new Promise<typeof savedSettings>((resolve) => {
        resolveSave = resolve;
      }),
    );
    function CachedWrapper({ children }: PropsWithChildren) {
      return <Wrapper queryClient={queryClient}>{children}</Wrapper>;
    }

    const view = render(<ProductAdminPage />, { wrapper: CachedWrapper });
    const nameInput = await screen.findByRole("textbox", {
      name: "English product name",
    });
    fireEvent.change(nameInput, {
      target: { value: "Requested by Admin One" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save product settings" }),
    );
    await waitFor(() => expect(mocks.updateAdminSettings).toHaveBeenCalled());

    auth.userId = "admin-2";
    view.rerender(<ProductAdminPage />);
    resolveSave(savedSettings);

    await waitFor(() =>
      expect(
        queryClient.getQueryData(["product", "admin-settings", "admin-1"]),
      ).toEqual(savedSettings),
    );
    expect(
      queryClient.getQueryData(["product", "admin-settings", "admin-2"]),
    ).toBeUndefined();
    expect(screen.queryByDisplayValue("Saved by Admin One")).toBeNull();
    queryClient.clear();
  });

  it("keeps cached admin data visible when a background refresh fails", async () => {
    const cachedSettings = {
      api_version: 1,
      version: 7,
      product: {
        name: "Flow Desk",
        name_zh: "工作台",
        features: {
          overview: true,
          chats: true,
          agents: true,
          scheduled_tasks: true,
          capabilities: true,
          files: false,
          data_privacy: false,
          administration: true,
        },
      },
    };
    const cachedUsers = {
      users: [
        {
          id: "cached-user",
          email: "cached@example.com",
          system_role: "user",
          is_active: true,
          needs_setup: false,
          created_at: "2026-09-26T08:00:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
    const cachedAudit = {
      api_version: 1,
      limit: 50,
      offset: 0,
      events: [
        {
          event_id: "cached-event",
          actor_user_id: "admin-1",
          action: "settings.write",
          resource_type: "user_setting",
          resource_id: "display",
          outcome: "success",
          occurred_at: "2026-09-27T08:00:00Z",
          request_id: null,
        },
      ],
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      ["product", "admin-settings", "admin-1"],
      cachedSettings,
    );
    queryClient.setQueryData(
      ["product", "admin-users", "admin-1", 50, 0],
      cachedUsers,
    );
    queryClient.setQueryData(
      ["product", "audit-events", "admin-1", 50, 0],
      cachedAudit,
    );
    mocks.fetchAdminSettings.mockRejectedValue(
      new Error("private settings transport failure"),
    );
    mocks.fetchAdminUsers.mockRejectedValue(
      new Error("private account transport failure"),
    );
    mocks.fetchAuditEvents.mockRejectedValue(
      new Error("private audit transport failure"),
    );
    function CachedWrapper({ children }: PropsWithChildren) {
      return <Wrapper queryClient={queryClient}>{children}</Wrapper>;
    }

    render(<ProductAdminPage />, { wrapper: CachedWrapper });

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(3));
    expect(screen.getAllByText("cached@example.com")).toHaveLength(2);
    expect(
      screen.getByRole("textbox", { name: "English product name" }),
    ).toHaveProperty("value", "Flow Desk");
    expect(screen.getAllByText("Saved a personal preference")).toHaveLength(2);
    expect(screen.queryByText(/private .* transport failure/)).toBeNull();
  });

  it("preserves edits and their base version when a newer server snapshot arrives", async () => {
    const cachedSettings = {
      api_version: 1,
      version: 7,
      product: {
        name: "Flow Desk",
        name_zh: "工作台",
        features: {
          overview: true,
          chats: true,
          agents: true,
          scheduled_tasks: true,
          capabilities: true,
          files: false,
          data_privacy: false,
          administration: true,
        },
      },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      ["product", "admin-settings", "admin-1"],
      cachedSettings,
    );
    // 保持后台请求 pending，让下面的缓存更新准确模拟跨管理员的配置刷新。
    let resolveSettings!: (settings: typeof cachedSettings) => void;
    mocks.fetchAdminSettings.mockReturnValue(
      new Promise<typeof cachedSettings>((resolve) => {
        resolveSettings = resolve;
      }),
    );
    mocks.updateAdminSettings.mockRejectedValue(new Error("version conflict"));
    function CachedWrapper({ children }: PropsWithChildren) {
      return <Wrapper queryClient={queryClient}>{children}</Wrapper>;
    }

    render(<ProductAdminPage />, { wrapper: CachedWrapper });

    const nameInput = await screen.findByRole("textbox", {
      name: "English product name",
    });
    fireEvent.change(nameInput, { target: { value: "My Flow Desk" } });
    const newerSettings = {
      ...cachedSettings,
      version: 8,
      product: { ...cachedSettings.product, name: "Updated elsewhere" },
    };
    queryClient.setQueryData(
      ["product", "admin-settings", "admin-1"],
      newerSettings,
    );

    expect(nameInput).toHaveProperty("value", "My Flow Desk");
    fireEvent.click(
      screen.getByRole("button", { name: "Save product settings" }),
    );
    await waitFor(() => expect(mocks.updateAdminSettings).toHaveBeenCalled());
    expect(mocks.updateAdminSettings.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        expected_version: 7,
        name: "My Flow Desk",
      }),
    );
    resolveSettings(newerSettings);
    await waitFor(() =>
      expect(nameInput).toHaveProperty("value", "My Flow Desk"),
    );
  });

  it("follows the server has_more flag when moving between exact audit pages", async () => {
    const events = Array.from({ length: 50 }, (_, index) => ({
      event_id: `event-${index}`,
      actor_user_id: "admin-1",
      action: "settings.write",
      resource_type: "user_setting",
      resource_id: "workspace.display",
      outcome: "success",
      occurred_at: "2026-09-27T10:00:00Z",
      request_id: null,
    }));
    mocks.fetchAuditEvents.mockImplementation(
      async (limit: number, offset: number) => ({
        api_version: 1,
        events: offset === 0 ? events : [events[0]],
        limit,
        offset,
        has_more: offset === 0,
      }),
    );
    render(<ProductAdminPage />, { wrapper: Wrapper });

    const older = await screen.findByRole("button", {
      name: "Older",
    });
    expect(older.hasAttribute("disabled")).toBe(false);
    fireEvent.click(older);
    await waitFor(() =>
      expect(mocks.fetchAuditEvents).toHaveBeenCalledWith(
        50,
        50,
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Older" }).hasAttribute("disabled"),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Newer" }));
    await waitFor(() =>
      expect(mocks.fetchAuditEvents).toHaveBeenCalledWith(
        50,
        0,
        expect.anything(),
      ),
    );
  });

  it("localizes stable audit codes and keeps mobile and desktop structures", async () => {
    const { container } = render(<ProductAdminPage />, { wrapper: Wrapper });

    expect(
      await screen.findByRole("list", { name: "Activity audit" }),
    ).toBeDefined();
    expect(screen.getAllByText("Saved a personal preference")).toHaveLength(2);
    expect(screen.getAllByText("Disabled an account")).toHaveLength(2);
    expect(screen.getAllByText("A personal data job failed")).toHaveLength(2);
    expect(screen.getAllByText("Cancelled a personal data job")).toHaveLength(
      2,
    );
    expect(
      screen.getAllByText("Requested a personal data export download"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Created a conversation")).toHaveLength(2);
    expect(screen.getAllByText("Created a conversation branch")).toHaveLength(
      2,
    );
    expect(screen.getAllByText("Updated conversation details")).toHaveLength(2);
    expect(
      screen.getAllByText("Changed a conversation's project"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Deleted a conversation")).toHaveLength(2);
    expect(screen.getAllByText("Uploaded a conversation file")).toHaveLength(2);
    expect(screen.getAllByText("Deleted a conversation file")).toHaveLength(2);
    expect(
      screen.getAllByText("Moved a project document to trash"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Restored a project document")).toHaveLength(2);
    expect(
      screen.getAllByText("Permanently deleted a project document"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Emptied the project trash")).toHaveLength(2);
    expect(screen.getAllByText("Created a project")).toHaveLength(2);
    expect(screen.getAllByText("Updated a project")).toHaveLength(2);
    expect(screen.getAllByText("Archived a project")).toHaveLength(2);
    expect(screen.getAllByText("Restored a project")).toHaveLength(2);
    expect(screen.getAllByText("Deleted a project")).toHaveLength(2);
    expect(screen.getAllByText("Created a scheduled task")).toHaveLength(2);
    expect(screen.getAllByText("Updated a scheduled task")).toHaveLength(2);
    expect(screen.getAllByText("Paused a scheduled task")).toHaveLength(2);
    expect(screen.getAllByText("Resumed a scheduled task")).toHaveLength(2);
    expect(
      screen.getAllByText("Manually triggered a scheduled task"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Deleted a scheduled task")).toHaveLength(2);
    expect(screen.getAllByText("Cleared memory")).toHaveLength(2);
    expect(screen.getAllByText("Exported memory")).toHaveLength(2);
    expect(screen.getAllByText("Imported memory")).toHaveLength(2);
    expect(screen.getAllByText("Added a memory fact")).toHaveLength(2);
    expect(screen.getAllByText("Updated a memory fact")).toHaveLength(2);
    expect(screen.getAllByText("Deleted a memory fact")).toHaveLength(2);
    expect(screen.getAllByText("Created a custom agent")).toHaveLength(2);
    expect(screen.getAllByText("Updated a custom agent")).toHaveLength(2);
    expect(screen.getAllByText("Deleted a custom agent")).toHaveLength(2);
    expect(screen.getAllByText("Edited custom Skill content")).toHaveLength(2);
    expect(screen.getAllByText("Updated the user profile")).toHaveLength(2);
    expect(screen.getAllByText("Created a personal access token")).toHaveLength(
      2,
    );
    expect(screen.getAllByText("Revoked a personal access token")).toHaveLength(
      2,
    );
    expect(screen.getAllByText("Changed the account password")).toHaveLength(2);
    expect(screen.getAllByText("Registered an account")).toHaveLength(2);
    expect(
      screen.getAllByText("Initialized the first administrator"),
    ).toHaveLength(2);
    expect(
      screen.getAllByText("Provisioned an account through OIDC"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Signed in through OIDC")).toHaveLength(2);
    expect(screen.getAllByText("Custom agent")).toHaveLength(3);
    expect(screen.getAllByText("Skill")).toHaveLength(1);
    expect(screen.getAllByText("User profile")).toHaveLength(1);
    expect(screen.getAllByText("Personal access token")).toHaveLength(2);
    expect(screen.getAllByText("Conversation file")).toHaveLength(2);
    expect(screen.getAllByText("Project document")).toHaveLength(3);
    expect(screen.getAllByText("Project trash")).toHaveLength(1);
    expect(screen.getAllByText("Project")).toHaveLength(5);
    expect(screen.getAllByText("Scheduled task")).toHaveLength(6);
    expect(
      within(screen.getByRole("list", { name: "Activity audit" })).getAllByText(
        "Memory",
      ),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("list", { name: "Activity audit" })).getAllByText(
        "Memory fact",
      ),
    ).toHaveLength(3);
    expect(screen.getAllByText("Account")).toHaveLength(6);
    expect(screen.getAllByText("Personal data job")).toHaveLength(3);
    expect(screen.getAllByText("Other activity")).toHaveLength(2);
    expect(screen.getByText("Personal preference")).toBeDefined();
    expect(screen.getByText("Other resource")).toBeDefined();
    expect(screen.getAllByText("Failed")).toHaveLength(4);
    expect(screen.getAllByText("Cancelled")).toHaveLength(2);
    expect(screen.getAllByText("Other result")).toHaveLength(2);

    // Mobile cards and the desktop table coexist; CSS selects the right view.
    expect(
      screen
        .getByRole("list", { name: "Activity audit" })
        .querySelectorAll("li"),
    ).toHaveLength(46);
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(container.querySelector("ul.md\\:hidden")).not.toBeNull();
    expect(container.querySelector("div.hidden.md\\:block")).not.toBeNull();
  });

  it("renders data job audit labels in Chinese", async () => {
    // 组件会从持久化语言 Cookie 恢复语言，测试也模拟该首屏行为。
    document.cookie = "locale=zh-CN; path=/";
    const ChineseWrapper = ({ children }: PropsWithChildren) => (
      <Wrapper locale="zh-CN">{children}</Wrapper>
    );
    render(<ProductAdminPage />, { wrapper: ChineseWrapper });

    expect(await screen.findByRole("list", { name: "操作审计" })).toBeDefined();
    expect(screen.getAllByText("个人数据任务失败")).toHaveLength(2);
    expect(screen.getAllByText("取消个人数据任务")).toHaveLength(2);
    expect(screen.getAllByText("请求下载个人数据导出")).toHaveLength(2);
    expect(screen.getAllByText("创建会话")).toHaveLength(2);
    expect(screen.getAllByText("创建会话分支")).toHaveLength(2);
    expect(screen.getAllByText("创建个人访问令牌")).toHaveLength(2);
    expect(screen.getAllByText("撤销个人访问令牌")).toHaveLength(2);
    expect(screen.getAllByText("修改账号密码")).toHaveLength(2);
    expect(screen.getAllByText("注册账号")).toHaveLength(2);
    expect(screen.getAllByText("初始化首个管理员")).toHaveLength(2);
    expect(screen.getAllByText("通过 OIDC 开通账号")).toHaveLength(2);
    expect(screen.getAllByText("通过 OIDC 登录")).toHaveLength(2);
    expect(screen.getAllByText("个人访问令牌")).toHaveLength(2);
    expect(screen.getAllByText("更新会话信息")).toHaveLength(2);
    expect(screen.getAllByText("调整会话所属项目")).toHaveLength(2);
    expect(screen.getAllByText("删除会话")).toHaveLength(2);
    expect(screen.getAllByText("上传会话文件")).toHaveLength(2);
    expect(screen.getAllByText("删除会话文件")).toHaveLength(2);
    expect(screen.getAllByText("将项目文档移入回收站")).toHaveLength(2);
    expect(screen.getAllByText("恢复项目文档")).toHaveLength(2);
    expect(screen.getAllByText("永久删除项目文档")).toHaveLength(2);
    expect(screen.getAllByText("清空项目回收站")).toHaveLength(2);
    expect(screen.getAllByText("创建项目")).toHaveLength(2);
    expect(screen.getAllByText("编辑项目")).toHaveLength(2);
    expect(screen.getAllByText("归档项目")).toHaveLength(2);
    expect(screen.getAllByText("恢复项目")).toHaveLength(2);
    expect(screen.getAllByText("删除项目")).toHaveLength(2);
    expect(screen.getAllByText("创建计划任务")).toHaveLength(2);
    expect(screen.getAllByText("编辑计划任务")).toHaveLength(2);
    expect(screen.getAllByText("暂停计划任务")).toHaveLength(2);
    expect(screen.getAllByText("恢复计划任务")).toHaveLength(2);
    expect(screen.getAllByText("手动触发计划任务")).toHaveLength(2);
    expect(screen.getAllByText("删除计划任务")).toHaveLength(2);
    expect(screen.getAllByText("清空记忆")).toHaveLength(2);
    expect(screen.getAllByText("导出记忆")).toHaveLength(2);
    expect(screen.getAllByText("导入记忆")).toHaveLength(2);
    expect(screen.getAllByText("新增记忆事实")).toHaveLength(2);
    expect(screen.getAllByText("更新记忆事实")).toHaveLength(2);
    expect(screen.getAllByText("删除记忆事实")).toHaveLength(2);
    expect(screen.getAllByText("创建自定义 Agent")).toHaveLength(2);
    expect(screen.getAllByText("更新自定义 Agent")).toHaveLength(2);
    expect(screen.getAllByText("删除自定义 Agent")).toHaveLength(2);
    expect(screen.getAllByText("编辑 Skill 内容")).toHaveLength(2);
    expect(screen.getAllByText("技能")).toHaveLength(1);
    expect(screen.getAllByText("更新用户资料")).toHaveLength(2);
    expect(screen.getAllByText("自定义 Agent")).toHaveLength(3);
    expect(screen.getAllByText("用户资料")).toHaveLength(1);
    expect(screen.getAllByText("会话文件")).toHaveLength(2);
    expect(screen.getAllByText("项目文档")).toHaveLength(3);
    expect(screen.getAllByText("项目回收站")).toHaveLength(1);
    expect(screen.getAllByText("项目")).toHaveLength(5);
    expect(
      within(screen.getByRole("list", { name: "操作审计" })).getAllByText(
        "计划任务",
      ),
    ).toHaveLength(6);
    expect(
      within(screen.getByRole("list", { name: "操作审计" })).getAllByText(
        "记忆",
      ),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("list", { name: "操作审计" })).getAllByText(
        "记忆事实",
      ),
    ).toHaveLength(3);
    expect(screen.getAllByText("失败")).toHaveLength(4);
    expect(screen.getAllByText("已取消")).toHaveLength(2);
  });

  it("explains why account-wide data controls remain unavailable", async () => {
    render(<ProductAdminPage />, { wrapper: Wrapper });

    const privacyToggle = await screen.findByRole("checkbox", {
      name: /Data and privacy/,
    });
    expect((privacyToggle as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Unavailable")).toBeDefined();
    expect(privacyToggle.getAttribute("aria-describedby")).toBe(
      "product-admin-unimplemented-features",
    );
    expect(
      screen.getByText(/account-wide export\/deletion are still pending/),
    ).toBeDefined();
  });

  it("requires confirmation before changing an account and refreshes server state", async () => {
    mocks.updateAdminUserStatus.mockResolvedValue({
      id: "user-2",
      email: "member@example.com",
      system_role: "user",
      is_active: false,
      needs_setup: false,
      created_at: "2026-09-26T08:00:00Z",
      active_runs_stopped: 1,
      active_runs_stop_pending: 0,
      active_runs_stop_failed: 0,
    });
    render(<ProductAdminPage />, { wrapper: Wrapper });

    expect(await screen.findAllByText("member@example.com")).toHaveLength(2);
    const disableButton = screen
      .getAllByRole("button", {
        name: "Disable account member@example.com",
      })
      .at(0);
    if (!disableButton) throw new Error("Expected an account disable action");
    fireEvent.click(disableButton);
    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(
      screen.getByText(/Gateway will also stop running tasks/),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    await waitFor(() =>
      expect(mocks.updateAdminUserStatus).toHaveBeenCalledWith("user-2", false),
    );
    expect(
      await screen.findByText(
        "Account disabled: 1 task(s) stopped, 0 cancellation request(s) pending across Gateway workers, and 0 task(s) could not be confirmed stopped.",
      ),
    ).toBeDefined();
  });

  it("keeps the account-status dialog visible and locked while the request is pending", async () => {
    let resolveUpdate!: (value: {
      id: string;
      email: string;
      system_role: string;
      is_active: boolean;
      needs_setup: boolean;
      created_at: string;
      active_runs_stopped: number;
      active_runs_stop_pending: number;
      active_runs_stop_failed: number;
    }) => void;
    mocks.updateAdminUserStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    render(<ProductAdminPage />, { wrapper: Wrapper });

    expect(await screen.findAllByText("member@example.com")).toHaveLength(2);
    const disableButton = screen
      .getAllByRole("button", {
        name: "Disable account member@example.com",
      })
      .at(0);
    if (!disableButton) throw new Error("Expected an account disable action");
    fireEvent.click(disableButton);
    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.getAttribute("aria-busy")).toBe("true"));
    expect(
      within(dialog)
        .getByRole("button", { name: "Cancel" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();

    resolveUpdate({
      id: "user-2",
      email: "member@example.com",
      system_role: "user",
      is_active: false,
      needs_setup: false,
      created_at: "2026-09-26T08:00:00Z",
      active_runs_stopped: 0,
      active_runs_stop_pending: 0,
      active_runs_stop_failed: 0,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("discards an account-status confirmation when the acting administrator changes", async () => {
    const view = render(<ProductAdminPage />, { wrapper: Wrapper });
    expect(await screen.findAllByText("member@example.com")).toHaveLength(2);
    const disableButton = screen
      .getAllByRole("button", {
        name: "Disable account member@example.com",
      })
      .at(0);
    if (!disableButton) throw new Error("Expected an account disable action");
    fireEvent.click(disableButton);
    expect(await screen.findByRole("dialog")).toBeDefined();

    auth.userId = "admin-2";
    view.rerender(<ProductAdminPage />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.updateAdminUserStatus).not.toHaveBeenCalled();
  });
});
