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
import { type ReactNode } from "react";

const mocks = rs.hoisted(() => ({
  fetchScheduledTasks: rs.fn(),
  fetchThreadScheduledTasks: rs.fn(),
  fetchScheduledTaskRuns: rs.fn(),
  createScheduledTask: rs.fn(),
  updateScheduledTask: rs.fn(),
  pauseScheduledTask: rs.fn(),
  resumeScheduledTask: rs.fn(),
  triggerScheduledTask: rs.fn(),
  deleteScheduledTask: rs.fn(),
  listAgents: rs.fn(),
  userPermissions: null as string[] | null,
}));

rs.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));
rs.mock("@/core/agents/hooks", () => ({
  useAgentsApiEnabled: () => ({ enabled: false, isLoading: false }),
  // 页面会无条件调用 useAgents；测试里返回空目录即可。
  useAgents: () => ({ data: undefined, isLoading: false, isError: false }),
}));
rs.mock("@/core/agents/api", () => ({
  listAgents: (...args: unknown[]) => mocks.listAgents(...args),
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1", permissions: mocks.userPermissions },
  }),
}));
rs.mock("@/core/scheduled-tasks/api", () => ({
  fetchScheduledTasks: (...args: unknown[]) =>
    mocks.fetchScheduledTasks(...args),
  fetchThreadScheduledTasks: (...args: unknown[]) =>
    mocks.fetchThreadScheduledTasks(...args),
  fetchScheduledTaskRuns: (...args: unknown[]) =>
    mocks.fetchScheduledTaskRuns(...args),
  createScheduledTask: (...args: unknown[]) =>
    mocks.createScheduledTask(...args),
  updateScheduledTask: (...args: unknown[]) =>
    mocks.updateScheduledTask(...args),
  pauseScheduledTask: (...args: unknown[]) => mocks.pauseScheduledTask(...args),
  resumeScheduledTask: (...args: unknown[]) =>
    mocks.resumeScheduledTask(...args),
  triggerScheduledTask: (...args: unknown[]) =>
    mocks.triggerScheduledTask(...args),
  deleteScheduledTask: (...args: unknown[]) =>
    mocks.deleteScheduledTask(...args),
}));
rs.mock("@/components/workspace/workspace-container", () => ({
  WorkspaceContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  WorkspaceBody: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  WorkspaceHeader: () => null,
}));
rs.mock("@/components/workspace/scheduled-task-schedule-input", () => ({
  ScheduledTaskScheduleInput: () => null,
}));

import ScheduledTasksPage from "@/app/workspace/scheduled-tasks/page";
import { I18nProvider } from "@/core/i18n/context";

function renderPage({
  permissions = null,
  cachedTasks,
}: {
  permissions?: string[] | null;
  cachedTasks?: unknown[];
} = {}) {
  document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
  mocks.userPermissions = permissions;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cachedTasks) {
    client.setQueryData(["scheduled-tasks", "user-1"], cachedTasks);
  }
  const result = render(
    <I18nProvider initialLocale="zh-CN">
      <QueryClientProvider client={client}>
        <ScheduledTasksPage />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { ...result, client };
}

const scheduledTask = {
  id: "task-a",
  thread_id: null,
  context_mode: "fresh_thread_per_run" as const,
  assistant_id: "lead_agent",
  title: "每日项目摘要",
  prompt: "整理项目更新",
  schedule_type: "cron" as const,
  schedule_spec: { cron: "0 9 * * *" },
  timezone: "UTC",
  status: "enabled" as const,
  next_run_at: null,
  last_run_at: null,
  last_run_id: null,
  last_thread_id: null,
  last_error: null,
  run_count: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const scheduledTaskB = {
  ...scheduledTask,
  id: "task-b",
  title: "每周备份",
  prompt: "备份数据库",
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn !== "function") continue;
    const mock = fn as unknown as {
      mockReset: () => void;
      mockResolvedValue: (value: unknown) => void;
    };
    mock.mockReset();
    mock.mockResolvedValue([]);
  }
  mocks.userPermissions = null;
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("ScheduledTasksPage list states", () => {
  it("hides cached task rows without read permission while preserving allowed creation", () => {
    const { client } = renderPage({
      permissions: ["threads:write", "runs:create"],
      cachedTasks: [scheduledTask],
    });

    expect(screen.queryByTestId("scheduled-task-item-task-a")).toBeNull();
    expect(screen.getByTestId("scheduled-task-create-form")).toBeDefined();
    expect(
      screen.getByRole("status").textContent?.includes("threads:read"),
    ).toBe(true);
    expect(mocks.fetchScheduledTasks).not.toHaveBeenCalled();
    client.clear();
  });

  it("shows read-only tasks but hides create and mutation actions", async () => {
    mocks.fetchScheduledTasks.mockResolvedValue([scheduledTask]);
    renderPage({ permissions: ["threads:read", "runs:read"] });

    expect(
      await screen.findByTestId("scheduled-task-item-task-a"),
    ).toBeDefined();
    expect(screen.queryByTestId("scheduled-task-create-form")).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "暂停" })).toBeNull();
    expect(screen.queryByRole("button", { name: "立即触发" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("shows a localized retry when loading fails and then explains the empty list", async () => {
    mocks.fetchScheduledTasks
      .mockRejectedValueOnce(new Error("backend internal detail"))
      .mockResolvedValueOnce([]);

    renderPage();

    expect(
      await screen.findByTestId("scheduled-task-load-error"),
    ).toBeDefined();
    expect(screen.getByText("暂时无法加载定时任务。")).toBeDefined();
    expect(screen.queryByText("backend internal detail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(
      await screen.findByText("还没有定时任务。创建后，任务会显示在这里。"),
    ).toBeDefined();
    expect(mocks.fetchScheduledTasks).toHaveBeenCalledTimes(2);
  });

  it("keeps the last task visible when a background refresh fails", async () => {
    mocks.fetchScheduledTasks
      .mockResolvedValueOnce([scheduledTask])
      .mockRejectedValueOnce(new Error("backend internal detail"));

    const { client } = renderPage();
    const taskButton = await screen.findByTestId("scheduled-task-item-task-a");

    await client.invalidateQueries({ queryKey: ["scheduled-tasks"] });

    expect(
      await screen.findByText("刷新失败，当前仍显示上次成功加载的数据。"),
    ).toBeDefined();
    expect(taskButton.isConnected).toBe(true);
  });

  it("lets the user clear filters when no scheduled tasks match", async () => {
    mocks.fetchScheduledTasks.mockResolvedValue([scheduledTask]);

    renderPage();

    await screen.findByTestId("scheduled-task-item-task-a");
    const allStatuses = screen.getByRole("button", { name: "全部状态" });
    const pausedStatus = screen.getByRole("button", { name: "已暂停" });
    expect(allStatuses.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pausedStatus);
    expect(pausedStatus.getAttribute("aria-pressed")).toBe("true");
    expect(allStatuses.getAttribute("aria-pressed")).toBe("false");

    expect(
      await screen.findByText("没有符合当前筛选条件的定时任务。"),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByTestId("scheduled-task-item-task-a")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "全部状态" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "全部类型" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps the delete dialog locked until the scheduled-task request settles", async () => {
    mocks.fetchScheduledTasks.mockResolvedValue([scheduledTask]);
    let resolveDelete!: () => void;
    mocks.deleteScheduledTask.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("scheduled-task-item-task-a"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(dialog.getAttribute("aria-busy")).toBe("true"));
    expect(
      within(dialog)
        .getByRole("button", { name: "取消" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();

    resolveDelete();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("ScheduledTasksPage edit dirty guards", () => {
  const EDIT_PERMISSIONS = [
    "threads:read",
    "threads:write",
    "runs:create",
  ] as const;

  async function openEditor(
    tasks: Array<{ id: string }> = [scheduledTask],
  ): Promise<void> {
    mocks.fetchScheduledTasks.mockResolvedValue(tasks);
    renderPage({ permissions: [...EDIT_PERMISSIONS] });
    // 所有调用方都传入非空任务数组；noUncheckedIndexedAccess 需要显式断言。
    await screen.findByTestId(`scheduled-task-item-${tasks[0]!.id}`);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByPlaceholderText("编辑标题");
  }

  it("disables save until the edit draft actually changes", async () => {
    await openEditor();

    const save = screen.getByRole("button", { name: "保存编辑" });
    // 不变量①：草稿与服务器值一致时禁止重复保存。
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("编辑标题"), {
      target: { value: "新标题" },
    });
    expect(save.hasAttribute("disabled")).toBe(false);

    // 改回原值后草稿不再脏，保存重新禁用。
    fireEvent.change(screen.getByPlaceholderText("编辑标题"), {
      target: { value: "每日项目摘要" },
    });
    expect(save.hasAttribute("disabled")).toBe(true);
  });

  it("confirms before switching tasks while edits are unsaved", async () => {
    await openEditor([scheduledTask, scheduledTaskB]);

    fireEvent.change(screen.getByPlaceholderText("编辑标题"), {
      target: { value: "新标题" },
    });
    fireEvent.click(screen.getByTestId("scheduled-task-item-task-b"));

    // 不变量②：切换任务前弹出放弃确认。
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("放弃未保存的编辑？")).toBeDefined();

    // 继续编辑：留在原任务且草稿保留。
    fireEvent.click(
      within(dialog).getByTestId("scheduled-task-discard-continue"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByTestId("scheduled-task-item-task-b").getAttribute("class"),
    ).not.toContain("border-foreground");
    expect(screen.getByPlaceholderText("编辑标题").getAttribute("value")).toBe(
      "新标题",
    );

    // 再次切换并放弃：草稿丢弃并切到目标任务。
    fireEvent.click(screen.getByTestId("scheduled-task-item-task-b"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "scheduled-task-discard-confirm",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const detail = within(screen.getByTestId("scheduled-task-detail"));
    expect(detail.getByText("每周备份")).toBeDefined();
    expect(screen.getByPlaceholderText("编辑标题").getAttribute("value")).toBe(
      "每周备份",
    );
  });

  it("confirms before leaving edit mode and reseeds drafts on discard", async () => {
    await openEditor();

    fireEvent.change(screen.getByPlaceholderText("编辑标题"), {
      target: { value: "新标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));

    // 不变量②：退出编辑前弹出放弃确认。
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("放弃未保存的编辑？")).toBeDefined();

    fireEvent.click(
      within(dialog).getByTestId("scheduled-task-discard-confirm"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByPlaceholderText("编辑标题")).toBeNull();

    // 重新进入编辑时草稿从服务器值重新播种。
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByPlaceholderText("编辑标题").getAttribute("value")).toBe(
      "每日项目摘要",
    );
  });
});
