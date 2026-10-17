import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  cancel: rs.fn(),
  fetchTask: rs.fn(),
  fetchTasks: rs.fn(),
  toastError: rs.fn(),
  user: {
    current: { id: "user-1", permissions: null as string[] | null },
  },
}));

rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));
rs.mock("@/core/background-tasks/api", () => ({
  cancelBackgroundTask: mocks.cancel,
  fetchBackgroundTask: mocks.fetchTask,
  fetchBackgroundTasks: mocks.fetchTasks,
}));

import {
  backgroundTaskQueryKey,
  backgroundTasksQueryKey,
  useBackgroundTask,
  useBackgroundTasks,
  useCancelBackgroundTask,
} from "@/core/background-tasks/hooks";
import { I18nProvider } from "@/core/i18n/context";

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
  mocks.cancel.mockReset();
  mocks.fetchTask.mockReset();
  mocks.fetchTasks.mockReset();
  mocks.toastError.mockReset();
  mocks.user.current = { id: "user-1", permissions: null };
});

describe("background task mutation error copy", () => {
  it("does not expose backend details when cancellation fails", async () => {
    mocks.cancel.mockRejectedValue(new Error("private task storage detail"));
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useCancelBackgroundTask("thread-1", { enabled: true }),
      { wrapper: Wrapper },
    );

    act(() => {
      void result.current.mutate({
        threadId: "thread-1",
        taskId: "task-1",
        enabled: true,
      });
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Failed to cancel task"),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private task storage detail",
    );
    client.clear();
  });

  it("does not call the Gateway after cancellation permission is denied", async () => {
    const { client, Wrapper } = createWrapper();
    rs.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(
      () => useCancelBackgroundTask("thread-1", { enabled: false }),
      { wrapper: Wrapper },
    );

    act(() => {
      void result.current.mutate({
        threadId: "thread-1",
        taskId: "task-1",
        enabled: false,
      });
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Failed to cancel task"),
    );
    expect(mocks.cancel).not.toHaveBeenCalled();
    client.clear();
  });
});

describe("background task read permissions", () => {
  it("hides a caller-disabled list and detail without removing the owner caches", () => {
    const { client, Wrapper } = createWrapper();
    const ownerTask = { task_id: "task-private" };
    const otherTask = { task_id: "task-other" };
    client.setQueryData(backgroundTasksQueryKey("thread-1", "user-1"), [
      ownerTask,
      otherTask,
    ]);
    client.setQueryData(
      backgroundTaskQueryKey("thread-1", "task-private", "user-1"),
      ownerTask,
    );
    client.setQueryData(
      backgroundTaskQueryKey("thread-1", "task-other", "user-1"),
      otherTask,
    );
    mocks.user.current = { id: "user-1", permissions: ["threads:read"] };

    const list = renderHook(
      () =>
        useBackgroundTasks("thread-1", {
          enabled: false,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    const detail = renderHook(
      () =>
        useBackgroundTask("thread-1", "task-private", {
          enabled: false,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );

    // 功能开关或调用方停用只隐藏结果，不删该账号的列表或任何详情。
    expect(list.result.current.data).toBeUndefined();
    expect(list.result.current.isLoading).toBe(false);
    expect(list.result.current.isFetching).toBe(false);
    expect(list.result.current.error).toBeNull();
    expect(detail.result.current.data).toBeUndefined();
    expect(detail.result.current.isLoading).toBe(false);
    expect(detail.result.current.isFetching).toBe(false);
    expect(detail.result.current.error).toBeNull();
    expect(
      client.getQueryData(backgroundTasksQueryKey("thread-1", "user-1")),
    ).toEqual([ownerTask, otherTask]);
    expect(
      client.getQueryData(
        backgroundTaskQueryKey("thread-1", "task-private", "user-1"),
      ),
    ).toEqual(ownerTask);
    expect(
      client.getQueryData(
        backgroundTaskQueryKey("thread-1", "task-other", "user-1"),
      ),
    ).toEqual(otherTask);
    expect(mocks.fetchTasks).not.toHaveBeenCalled();
    expect(mocks.fetchTask).not.toHaveBeenCalled();
    list.unmount();
    detail.unmount();
    client.clear();
  });

  it("clears only this owner's list and details when threads:read is denied", async () => {
    const { client, Wrapper } = createWrapper();
    const ownerTask = { task_id: "task-private" };
    const otherOwnerTask = { task_id: "other-owner-task" };
    client.setQueryData(backgroundTasksQueryKey("thread-1", "user-1"), [
      ownerTask,
    ]);
    client.setQueryData(
      backgroundTaskQueryKey("thread-1", "task-private", "user-1"),
      ownerTask,
    );
    client.setQueryData(backgroundTasksQueryKey("thread-1", "user-2"), [
      otherOwnerTask,
    ]);
    client.setQueryData(
      backgroundTaskQueryKey("thread-1", "other-owner-task", "user-2"),
      otherOwnerTask,
    );
    client.setQueryData(backgroundTasksQueryKey("thread-2", "user-1"), []);
    mocks.user.current = { id: "user-1", permissions: [] };

    const list = renderHook(
      () =>
        useBackgroundTasks("thread-1", {
          enabled: true,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    try {
      expect(list.result.current.data).toBeUndefined();
      expect(list.result.current.isLoading).toBe(false);
      expect(list.result.current.error).toBeNull();
      await waitFor(() => {
        expect(
          client.getQueryData(backgroundTasksQueryKey("thread-1", "user-1")),
        ).toBeUndefined();
        expect(
          client.getQueryData(
            backgroundTaskQueryKey("thread-1", "task-private", "user-1"),
          ),
        ).toBeUndefined();
      });
      // 其他账号和当前账号的其他线程缓存保持不动。
      expect(
        client.getQueryData(backgroundTasksQueryKey("thread-1", "user-2")),
      ).toEqual([otherOwnerTask]);
      expect(
        client.getQueryData(
          backgroundTaskQueryKey("thread-1", "other-owner-task", "user-2"),
        ),
      ).toEqual(otherOwnerTask);
      expect(
        client.getQueryData(backgroundTasksQueryKey("thread-2", "user-1")),
      ).toEqual([]);
      expect(mocks.fetchTasks).not.toHaveBeenCalled();
    } finally {
      list.unmount();
      client.clear();
    }
  });

  it("hides a denied detail without removing the owner list", async () => {
    const { client, Wrapper } = createWrapper();
    const ownerTask = { task_id: "task-private" };
    const otherTask = { task_id: "task-other" };
    client.setQueryData(backgroundTasksQueryKey("thread-1", "user-1"), [
      ownerTask,
      otherTask,
    ]);
    client.setQueryData(
      backgroundTaskQueryKey("thread-1", "task-private", "user-1"),
      ownerTask,
    );
    client.setQueryData(
      backgroundTaskQueryKey("thread-1", "task-other", "user-1"),
      otherTask,
    );
    mocks.user.current = { id: "user-1", permissions: [] };

    const detail = renderHook(
      () =>
        useBackgroundTask("thread-1", "task-private", {
          enabled: true,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    try {
      expect(detail.result.current.data).toBeUndefined();
      expect(detail.result.current.isLoading).toBe(false);
      expect(detail.result.current.error).toBeNull();
      await waitFor(() => {
        expect(
          client.getQueryData(
            backgroundTaskQueryKey("thread-1", "task-private", "user-1"),
          ),
        ).toBeUndefined();
        expect(
          client.getQueryData(
            backgroundTaskQueryKey("thread-1", "task-other", "user-1"),
          ),
        ).toBeUndefined();
      });
      // 详情撤权只清理详情；列表由列表 hook 负责清理。
      expect(
        client.getQueryData(backgroundTasksQueryKey("thread-1", "user-1")),
      ).toEqual([ownerTask, otherTask]);
      expect(mocks.fetchTask).not.toHaveBeenCalled();
    } finally {
      detail.unmount();
      client.clear();
    }
  });

  it("passes cancellation signals to authorized list and detail reads", async () => {
    const { client, Wrapper } = createWrapper();
    // 权限快照缺失时继续请求，保持旧 Gateway 兼容。
    mocks.user.current = { id: "user-1", permissions: null };
    mocks.fetchTasks.mockResolvedValueOnce([]);
    mocks.fetchTask.mockResolvedValueOnce({
      task_id: "task-1",
      status: "completed",
    });
    const list = renderHook(
      () =>
        useBackgroundTasks("thread-1", {
          enabled: true,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    const detail = renderHook(
      () =>
        useBackgroundTask("thread-1", "task-1", {
          enabled: true,
          cacheScope: "user-1",
        }),
      { wrapper: Wrapper },
    );
    try {
      await waitFor(() => {
        expect(list.result.current.isSuccess).toBe(true);
        expect(detail.result.current.isSuccess).toBe(true);
      });
      expect(mocks.fetchTasks.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
      expect(mocks.fetchTask.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    } finally {
      list.unmount();
      detail.unmount();
      client.clear();
    }
  });
});
