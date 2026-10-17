import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  user: {
    id: "admin-1",
    system_role: "admin",
    permissions: undefined as string[] | undefined,
  },
  create: rs.fn(),
  remove: rs.fn(),
  refetch: rs.fn(),
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
  update: rs.fn(),
  useSubagents: rs.fn(),
}));

rs.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
rs.mock("@/core/models/hooks", () => ({ useModels: () => ({ models: [] }) }));
rs.mock("@/core/subagents", () => ({
  useSubagents: (enabled: boolean) => mocks.useSubagents(enabled),
  useCreateManagedSubagent: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useDeleteManagedSubagent: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
  }),
  useUpdateManagedSubagent: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
}));

import { SubagentSettingsPage } from "@/components/workspace/settings/subagent-settings-page";
import { I18nProvider } from "@/core/i18n/context";

const managedSubagent = {
  name: "researcher",
  display_name: "Researcher",
  description: "Research helper",
  system_prompt: "",
  model: "inherit",
  tools: null,
  skills: null,
  max_turns: 10,
  timeout_seconds: 60,
  enabled: true,
  source: "managed",
  editable: true,
  conflict: false,
  config_overrides: {},
};

function renderPage(locale: "en-US" | "zh-CN" = "en-US") {
  return render(
    <I18nProvider initialLocale={locale}>
      <SubagentSettingsPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.user.permissions = undefined;
  mocks.create.mockReset();
  mocks.refetch.mockReset().mockResolvedValue({ data: [] });
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.update.mockReset();
  mocks.useSubagents.mockReset().mockReturnValue({
    subagents: [managedSubagent],
    isLoading: false,
    isFetching: false,
    error: undefined,
    refetch: mocks.refetch,
  });
});

afterEach(() => {
  cleanup();
  mocks.remove.mockReset();
  mocks.create.mockReset();
  mocks.refetch.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.update.mockReset();
  mocks.useSubagents.mockReset();
  document.cookie = "locale=; max-age=0; path=/";
});

describe("SubagentSettingsPage read error state", () => {
  it("localizes the initial load failure and retries without exposing server details", () => {
    document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
    mocks.useSubagents.mockReturnValue({
      subagents: [],
      isLoading: false,
      isFetching: false,
      error: new Error("private backend detail"),
      refetch: mocks.refetch,
    });

    renderPage("zh-CN");

    expect(screen.getByText("暂时无法加载子智能体。")).toBeDefined();
    expect(screen.queryByText("private backend detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps cached subagents visible when a background refresh fails", () => {
    mocks.useSubagents.mockReturnValue({
      subagents: [managedSubagent],
      isLoading: false,
      isFetching: false,
      error: new Error("private backend detail"),
      refetch: mocks.refetch,
    });

    renderPage("en-US");

    expect(screen.getByRole("alert").textContent).toContain(
      "Refresh failed. Showing the last successfully loaded subagents.",
    );
    expect(screen.getByText("Researcher")).toBeDefined();
    expect(screen.queryByText("private backend detail")).toBeNull();
  });
});

describe("SubagentSettingsPage permission boundaries", () => {
  it("does not render a cached catalog when read permission is denied", () => {
    mocks.user.permissions = ["runs:create"];
    renderPage();

    expect(screen.getByRole("alert").textContent).toContain("subagents:read");
    expect(screen.queryByText("Researcher")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add subagent" })).toBeNull();
    expect(mocks.useSubagents).toHaveBeenCalledWith(false);
  });

  it("shows the catalog but hides write actions without the admin grant", () => {
    mocks.user.permissions = ["subagents:read"];
    renderPage();

    expect(screen.getByText("Researcher")).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("subagents:admin");
    expect(screen.queryByRole("button", { name: "Add subagent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("SubagentSettingsPage deletion confirmation", () => {
  it("does not delete until the product dialog is confirmed", async () => {
    mocks.remove.mockResolvedValue(undefined);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      "Custom Agents may keep referencing its name",
    );
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith("researcher"),
    );
  });

  it("shows localized feedback for delete errors without exposing server details", async () => {
    mocks.remove.mockRejectedValue(new Error("private database detail"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to delete subagent",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private database detail",
    );
  });

  it("keeps the managed subagent when the dialog is cancelled", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("localizes the deletion title for Chinese users", () => {
    document.cookie = "locale=zh-CN; path=/";
    renderPage("zh-CN");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(screen.getByRole("dialog").textContent).toContain("删除子智能体");
  });
});

describe("SubagentSettingsPage mutation error copy", () => {
  it("starts a fresh create draft after closing the editor", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add subagent" }));
    const firstDialog = screen.getByRole("dialog");
    const firstName = within(firstDialog).getAllByRole("textbox")[0]!;
    fireEvent.change(firstName, { target: { value: "temporary-agent" } });
    fireEvent.click(
      within(firstDialog).getByRole("button", { name: "Cancel" }),
    );

    // 统一 unsaved-changes 契约：草稿脏时取消先弹放弃确认，"Discard
    // changes"才真正关闭编辑器（P347/P348 系列交互契约的回归覆盖）。
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    fireEvent.click(screen.getByRole("button", { name: "Add subagent" }));
    const reopenedDialog = screen.getByRole("dialog");
    expect(within(reopenedDialog).getAllByRole("textbox")[0]).toHaveProperty(
      "value",
      "",
    );
  });

  it("shows localized feedback for update errors", async () => {
    mocks.update.mockRejectedValue(new Error("private update detail"));
    renderPage();

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to save subagent changes",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith("private update detail");
  });

  it("uses the Chinese operation copy when the interface is localized", async () => {
    document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
    mocks.update.mockRejectedValue(new Error("private update detail"));
    renderPage("zh-CN");

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("保存子智能体失败"),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith("private update detail");
  });

  it("shows localized feedback for create errors", async () => {
    mocks.create.mockRejectedValue(new Error("private create detail"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add subagent" }));
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0]!, {
      target: { value: "new-worker" },
    });
    fireEvent.change(textboxes[2]!, {
      target: { value: "A focused helper" },
    });
    fireEvent.change(textboxes[3]!, {
      target: { value: "Help with a bounded task." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to create subagent",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith("private create detail");
  });
});
