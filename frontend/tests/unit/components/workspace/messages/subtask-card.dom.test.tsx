import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { SubtaskCard } from "@/components/workspace/messages/subtask-card";
import type { Subtask } from "@/core/tasks/types";

const mocks = rs.hoisted(() => ({
  fetchSteps: rs.fn(),
  updateSubtask: rs.fn(),
  auth: {
    user: {
      current: {
        id: "owner-a",
        permissions: ["runs:read"] as string[] | null,
      },
    },
  },
  task: {
    current: {
      id: "task-1",
      status: "completed" as const,
      subagent_type: "general-purpose",
      description: "Research task",
      steps: [],
      prompt: "",
      result: "Done",
    } as Subtask,
  },
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.auth.user.current }),
}));
rs.mock("@/core/models/hooks", () => ({
  useModels: () => ({ models: [], tokenUsageEnabled: false }),
}));
rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      tokenUsage: {},
      subtasks: {
        historyUnavailable: "History requires runs:read permission.",
        completed: "Subtask completed",
        in_progress: "Running subtask",
        failed: "Subtask failed",
      },
    },
  }),
}));
rs.mock("@/core/tasks/api", () => ({
  fetchSubtaskSteps: mocks.fetchSteps,
}));
rs.mock("@/core/tasks/context", () => ({
  useSubtask: () => mocks.task.current,
  useUpdateSubtask: () => mocks.updateSubtask,
}));

function renderCard() {
  return render(
    <SubtaskCard
      taskId="task-1"
      threadId="thread-1"
      runId="run-1"
      isLoading={false}
    />,
  );
}

afterEach(() => {
  cleanup();
  mocks.fetchSteps.mockReset();
  mocks.updateSubtask.mockReset();
  mocks.auth.user.current = { id: "owner-a", permissions: ["runs:read"] };
  mocks.task.current = {
    id: "task-1",
    status: "completed",
    subagent_type: "general-purpose",
    description: "Research task",
    steps: [],
    prompt: "",
    result: "Done",
  };
});

describe("SubtaskCard historical step permissions", () => {
  it("does not fetch history and explains missing runs:read", async () => {
    mocks.auth.user.current.permissions = [];
    renderCard();

    fireEvent.click(screen.getByRole("button"));

    expect(
      await screen.findByText("History requires runs:read permission."),
    ).toBeTruthy();
    expect(mocks.fetchSteps).not.toHaveBeenCalled();
  });

  it("aborts a history backfill and ignores its late response after revoke", async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.fetchSteps.mockImplementation(
      (
        _threadId: string,
        _runId: string,
        _taskId: string,
        _pageSize: number | undefined,
        signal?: AbortSignal,
      ) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const view = renderCard();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(requestSignal).toBeDefined());

    mocks.auth.user.current.permissions = [];
    view.rerender(
      <SubtaskCard
        taskId="task-1"
        threadId="thread-1"
        runId="run-1"
        isLoading={false}
      />,
    );

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(mocks.updateSubtask).not.toHaveBeenCalled();
    expect(
      screen.getByText("History requires runs:read permission."),
    ).toBeTruthy();
  });

  it("keeps historical paging active when live SSE adds a step", async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.fetchSteps.mockImplementation(
      (
        _threadId: string,
        _runId: string,
        _taskId: string,
        _pageSize: number | undefined,
        signal?: AbortSignal,
      ) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const view = renderCard();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(requestSignal).toBeDefined());

    // 夹具保证 steps 已初始化为空数组；noUncheckedIndexedAccess 之外的可选字段在此显式断言。
    mocks.task.current.steps!.push({
      kind: "tool",
      message_index: 1,
      text: "",
      tool_name: "web_search",
    });
    view.rerender(
      <SubtaskCard
        taskId="task-1"
        threadId="thread-1"
        runId="run-1"
        isLoading={false}
      />,
    );

    expect(requestSignal?.aborted).toBe(false);
    expect(mocks.fetchSteps).toHaveBeenCalledTimes(1);
  });
});
