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

const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));
rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));
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
  scheduledTasksQueryKey,
  threadScheduledTasksQueryKey,
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
  authState.userId = "owner-a";
  authState.permissions = null;
});

it("hides a caller-disabled task list without removing the owner cache", () => {
  const { client, Wrapper } = createWrapper();
  const cached = [{ id: "private-task" }];
  const key = scheduledTasksQueryKey("owner-a");
  const threadCached = [{ id: "private-thread-task" }];
  const threadKey = threadScheduledTasksQueryKey("thread-a", "owner-a");
  client.setQueryData(key, cached);
  client.setQueryData(threadKey, threadCached);

  const { result, unmount } = renderHook(
    () => ({
      all: useScheduledTasks({ enabled: false }),
      thread: useThreadScheduledTasks("thread-a", { enabled: false }),
    }),
    { wrapper: Wrapper },
  );
  try {
    expect(result.current.all.data).toBeUndefined();
    expect(result.current.all.isLoading).toBe(false);
    expect(result.current.all.error).toBeNull();
    expect(result.current.thread.data).toBeUndefined();
    expect(result.current.thread.isLoading).toBe(false);
    expect(result.current.thread.error).toBeNull();
    expect(mocks.fetchScheduledTasks).not.toHaveBeenCalled();
    expect(mocks.fetchThreadScheduledTasks).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual(cached);
    expect(client.getQueryData(threadKey)).toEqual(threadCached);
  } finally {
    unmount();
    client.clear();
  }
});

it("passes React Query cancellation signals to both authorized task inventories", async () => {
  authState.permissions = null;
  mocks.fetchScheduledTasks.mockResolvedValue([]);
  mocks.fetchThreadScheduledTasks.mockResolvedValue([]);
  const { client, Wrapper } = createWrapper();
  const { result, unmount } = renderHook(
    () => ({
      all: useScheduledTasks({ enabled: true }),
      thread: useThreadScheduledTasks("thread-a", { enabled: true }),
    }),
    { wrapper: Wrapper },
  );
  try {
    await waitFor(() => {
      expect(result.current.all.isSuccess).toBe(true);
      expect(result.current.thread.isSuccess).toBe(true);
    });
    expect(mocks.fetchScheduledTasks.mock.calls[0]?.[0]).toBeInstanceOf(
      AbortSignal,
    );
    expect(mocks.fetchThreadScheduledTasks.mock.calls[0]?.[1]).toBeInstanceOf(
      AbortSignal,
    );
    expect(client.getQueryData(scheduledTasksQueryKey("owner-a"))).toEqual([]);
    expect(
      client.getQueryData(threadScheduledTasksQueryKey("thread-a", "owner-a")),
    ).toEqual([]);
  } finally {
    unmount();
    client.clear();
  }
});

it("clears only this owner's task list when threads:read is denied", async () => {
  const { client, Wrapper } = createWrapper();
  const cached = [{ id: "private-task" }];
  const currentKey = scheduledTasksQueryKey("owner-a");
  const otherKey = scheduledTasksQueryKey("owner-b");
  const threadKey = ["scheduled-tasks", "thread", "thread-a"] as const;
  const historyKey = [
    "scheduled-tasks",
    "runs",
    "task-1",
    "owner-a",
    0,
  ] as const;
  client.setQueryData(currentKey, cached);
  client.setQueryData(otherKey, cached);
  client.setQueryData(threadKey, cached);
  client.setQueryData(historyKey, { runs: [] });
  authState.permissions = [];

  const { result, unmount } = renderHook(() => useScheduledTasks(), {
    wrapper: Wrapper,
  });
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherKey)).toEqual(cached);
    expect(client.getQueryData(threadKey)).toEqual(cached);
    expect(client.getQueryData(historyKey)).toEqual({ runs: [] });
    expect(mocks.fetchScheduledTasks).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

it("aborts an in-flight task list when threads:read is revoked", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["threads:read"];
  mocks.fetchScheduledTasks.mockImplementation((next: AbortSignal) => {
    signal = next;
    return new Promise(() => undefined);
  });
  const { client, Wrapper } = createWrapper();
  const { result, rerender, unmount } = renderHook(() => useScheduledTasks(), {
    wrapper: Wrapper,
  });
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  } finally {
    unmount();
    client.clear();
  }
});

it("clears only this owner's thread tasks when threads:read is denied", async () => {
  const { client, Wrapper } = createWrapper();
  const cached = [{ id: "private-thread-task" }];
  const currentKey = threadScheduledTasksQueryKey("thread-a", "owner-a");
  const otherKey = threadScheduledTasksQueryKey("thread-a", "owner-b");
  const listKey = scheduledTasksQueryKey("owner-a");
  const historyKey = [
    "scheduled-tasks",
    "runs",
    "task-1",
    "owner-a",
    0,
  ] as const;
  client.setQueryData(currentKey, cached);
  client.setQueryData(otherKey, cached);
  client.setQueryData(listKey, cached);
  client.setQueryData(historyKey, { runs: [] });
  authState.permissions = [];

  const { result, unmount } = renderHook(
    () => useThreadScheduledTasks("thread-a"),
    { wrapper: Wrapper },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(currentKey)).toBeUndefined(),
    );
    expect(client.getQueryData(otherKey)).toEqual(cached);
    expect(client.getQueryData(listKey)).toEqual(cached);
    expect(client.getQueryData(historyKey)).toEqual({ runs: [] });
    expect(mocks.fetchThreadScheduledTasks).not.toHaveBeenCalled();
  } finally {
    unmount();
    client.clear();
  }
});

it("aborts an in-flight thread task list when threads:read is revoked", async () => {
  let signal: AbortSignal | undefined;
  authState.permissions = ["threads:read"];
  mocks.fetchThreadScheduledTasks.mockImplementation(
    (_threadId: string, next: AbortSignal) => {
      signal = next;
      return new Promise(() => undefined);
    },
  );
  const { client, Wrapper } = createWrapper();
  const { result, rerender, unmount } = renderHook(
    () => useThreadScheduledTasks("thread-a"),
    { wrapper: Wrapper },
  );
  try {
    await waitFor(() => expect(signal?.aborted).toBe(false));
    authState.permissions = [];
    rerender();
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
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
