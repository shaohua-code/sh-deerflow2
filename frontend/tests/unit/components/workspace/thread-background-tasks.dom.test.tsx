import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  authState: {
    user: {
      id: "user-1",
      permissions: ["threads:read", "threads:write"] as string[],
    },
  },
  detailQuery: {
    data: undefined as unknown,
    error: null as Error | null,
    isError: false,
    isLoading: false,
    refetch: rs.fn(),
  },
  listQuery: {
    data: [] as Array<Record<string, unknown>> | undefined,
    error: null as Error | null,
    isError: false,
    isLoading: false,
    refetch: rs.fn(),
  },
  listEnabled: false,
  cancelEnabled: false,
  cancelMutation: {
    mutate: rs.fn(),
    isPending: false,
    variables: undefined as
      | { threadId: string; taskId: string; cacheScope?: string }
      | undefined,
  },
}));

rs.mock("@/core/features", () => ({
  useMcpTasksEnabled: () => ({ enabled: true }),
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.authState.user }),
}));
rs.mock("@/core/background-tasks", () => ({
  isActiveBackgroundTask: (task: { status: string }) =>
    ["submitted", "working"].includes(task.status),
  useBackgroundTask: () => mocks.detailQuery,
  useBackgroundTasks: (_threadId: string, options: { enabled: boolean }) => {
    mocks.listEnabled = options.enabled;
    return mocks.listQuery;
  },
  useCancelBackgroundTask: (
    _threadId: string,
    options: { enabled: boolean },
  ) => {
    mocks.cancelEnabled = options.enabled;
    return mocks.cancelMutation;
  },
}));

import { ThreadBackgroundTasks } from "@/components/workspace/thread-background-tasks";
import { I18nProvider } from "@/core/i18n/context";

const completedTask = {
  task_id: "task-1",
  task_name: "Research summary",
  status: "completed",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:01:00Z",
  cancel_requested: false,
  tracking_degraded: false,
};

function renderTasks() {
  return render(
    <I18nProvider initialLocale="en-US">
      <ThreadBackgroundTasks threadId="thread-1" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.authState.user.permissions = ["threads:read", "threads:write"];
  mocks.listQuery.data = [];
  mocks.listQuery.error = null;
  mocks.listQuery.isError = false;
  mocks.listQuery.isLoading = false;
  mocks.detailQuery.data = undefined;
  mocks.detailQuery.error = null;
  mocks.detailQuery.isError = false;
  mocks.detailQuery.isLoading = false;
  mocks.listEnabled = false;
  mocks.cancelEnabled = false;
  mocks.cancelMutation.isPending = false;
  mocks.cancelMutation.variables = undefined;
  mocks.cancelMutation.mutate.mockReset();
});

afterEach(() => cleanup());

describe("ThreadBackgroundTasks query errors", () => {
  it("shows a localized list error without exposing backend details", () => {
    mocks.listQuery.isError = true;
    mocks.listQuery.error = new Error("private database connection string");
    renderTasks();

    fireEvent.click(screen.getByRole("button", { name: "Background tasks" }));

    expect(screen.getByText("Couldn't load background tasks")).toBeDefined();
    expect(screen.queryByText("private database connection string")).toBeNull();
  });

  it("shows a localized detail error without exposing backend details", () => {
    mocks.listQuery.data = [completedTask];
    mocks.detailQuery.isError = true;
    mocks.detailQuery.error = new Error("private task storage path");
    renderTasks();

    fireEvent.click(screen.getByRole("button", { name: "Background tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "View details" }));

    expect(screen.getByText("Couldn't load task details")).toBeDefined();
    expect(screen.queryByText("private task storage path")).toBeNull();
  });

  it("does not load or show tasks without threads:read", () => {
    mocks.authState.user.permissions = ["threads:write"];
    mocks.listQuery.data = [completedTask];
    renderTasks();

    expect(mocks.listEnabled).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Background tasks" }),
    ).toBeNull();
  });

  it("keeps history readable but hides cancellation without threads:write", () => {
    mocks.authState.user.permissions = ["threads:read"];
    mocks.listQuery.data = [{ ...completedTask, status: "working" }];
    renderTasks();

    expect(mocks.listEnabled).toBe(true);
    expect(mocks.cancelEnabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Background tasks" }));
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("matches a pending cancellation to its task ID", () => {
    mocks.listQuery.data = [{ ...completedTask, status: "working" }];
    mocks.cancelMutation.isPending = true;
    mocks.cancelMutation.variables = {
      threadId: "thread-1",
      taskId: "task-1",
      cacheScope: "user-1",
    };
    renderTasks();

    fireEvent.click(screen.getByRole("button", { name: "Background tasks" }));

    expect(screen.getAllByText("Cancelling…")).toHaveLength(2);
  });
});
