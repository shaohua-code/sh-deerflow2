import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
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
}));

rs.mock("@/core/features", () => ({
  useMcpTasksEnabled: () => ({ enabled: true }),
}));
rs.mock("@/core/background-tasks", () => ({
  isActiveBackgroundTask: () => false,
  useBackgroundTask: () => mocks.detailQuery,
  useBackgroundTasks: () => mocks.listQuery,
  useCancelBackgroundTask: () => ({ mutate: rs.fn(), isPending: false }),
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
  mocks.listQuery.data = [];
  mocks.listQuery.error = null;
  mocks.listQuery.isError = false;
  mocks.listQuery.isLoading = false;
  mocks.detailQuery.data = undefined;
  mocks.detailQuery.error = null;
  mocks.detailQuery.isError = false;
  mocks.detailQuery.isLoading = false;
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
});
