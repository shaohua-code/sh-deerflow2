import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  create: rs.fn(),
  delete: rs.fn(),
  fetchScheduledTasks: rs.fn(),
  fetchThreadScheduledTasks: rs.fn(),
  pause: rs.fn(),
  resume: rs.fn(),
  toastError: rs.fn(),
  trigger: rs.fn(),
  update: rs.fn(),
}));

rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
rs.mock("@/core/scheduled-tasks/api", () => ({
  createScheduledTask: mocks.create,
  deleteScheduledTask: mocks.delete,
  fetchScheduledTasks: mocks.fetchScheduledTasks,
  fetchThreadScheduledTasks: mocks.fetchThreadScheduledTasks,
  pauseScheduledTask: mocks.pause,
  resumeScheduledTask: mocks.resume,
  triggerScheduledTask: mocks.trigger,
  updateScheduledTask: mocks.update,
}));

import { I18nProvider } from "@/core/i18n/context";
import {
  useCreateScheduledTask,
  useDeleteScheduledTask,
  usePauseScheduledTask,
  useResumeScheduledTask,
  useScheduledTasks,
  useThreadScheduledTasks,
  useTriggerScheduledTask,
  useUpdateScheduledTask,
} from "@/core/scheduled-tasks/hooks";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale="en-US">{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  return { client, Wrapper };
}

afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
  for (const mutation of [
    mocks.create,
    mocks.delete,
    mocks.pause,
    mocks.resume,
    mocks.trigger,
    mocks.update,
  ]) {
    mutation.mockReset();
  }
  mocks.fetchScheduledTasks.mockReset();
  mocks.fetchThreadScheduledTasks.mockReset();
  mocks.toastError.mockReset();
});

it("does not expose cached task lists or fetch after read permission is revoked", () => {
  const { client, Wrapper } = createWrapper();
  client.setQueryData(["scheduled-tasks"], [{ id: "private-task" }]);
  client.setQueryData(
    ["scheduled-tasks", "thread", "thread-a"],
    [{ id: "private-thread-task" }],
  );

  const { result, unmount } = renderHook(
    () => ({
      all: useScheduledTasks({ enabled: false }),
      thread: useThreadScheduledTasks("thread-a", { enabled: false }),
    }),
    { wrapper: Wrapper },
  );
  try {
    expect(result.current.all.data).toBeUndefined();
    expect(result.current.thread.data).toBeUndefined();
    expect(mocks.fetchScheduledTasks).not.toHaveBeenCalled();
    expect(mocks.fetchThreadScheduledTasks).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

describe("scheduled task mutation error copy", () => {
  it.each([
    ["create", "Failed to create scheduled task"],
    ["update", "Failed to update scheduled task"],
    ["pause", "Failed to pause scheduled task"],
    ["resume", "Failed to resume scheduled task"],
    ["trigger", "Failed to trigger scheduled task"],
    ["delete", "Failed to delete scheduled task"],
  ])("does not expose backend details when %s fails", async (action, copy) => {
    const errorText = "private scheduler storage detail";
    const mutation = mocks[action as keyof typeof mocks];
    mutation.mockRejectedValue(new Error(errorText));
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, Wrapper } = createWrapper();
    const hooks = {
      create: useCreateScheduledTask,
      update: function useUpdateTaskHook() {
        return useUpdateScheduledTask("task-1");
      },
      pause: usePauseScheduledTask,
      resume: useResumeScheduledTask,
      trigger: useTriggerScheduledTask,
      delete: useDeleteScheduledTask,
    } as const;
    // 各个 mutation hook 的输入参数不同；这里只统一成 unknown，避免测试表格
    // 把所有 hook 的参数交叉成一个难以调用的联合类型。
    const selectedHook = hooks[
      action as keyof typeof hooks
    ] as unknown as () => {
      mutate: (input: unknown) => void;
    };
    const { result } = renderHook(selectedHook, {
      wrapper: Wrapper,
    });

    act(() => {
      if (action === "create") result.current.mutate({});
      else if (action === "update") result.current.mutate({ title: "Updated" });
      else result.current.mutate("task-1");
    });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(copy));
    expect(mocks.toastError).not.toHaveBeenCalledWith(errorText);
    client.clear();
  });
});
