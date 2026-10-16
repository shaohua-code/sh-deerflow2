import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  cancel: rs.fn(),
  fetchTask: rs.fn(),
  fetchTasks: rs.fn(),
  toastError: rs.fn(),
}));

rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
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
  it("does not expose or retain cached task rows or details while a query is disabled", async () => {
    const { client, Wrapper } = createWrapper();
    const privateTask = { task_id: "task-private" };
    client.setQueryData(backgroundTasksQueryKey("thread-1", "user-1"), [
      privateTask,
    ]);
    client.setQueryData(
      backgroundTaskQueryKey("thread-1", "task-private", "user-1"),
      privateTask,
    );

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

    expect(list.result.current.data).toBeUndefined();
    expect(detail.result.current.data).toBeUndefined();
    expect(mocks.fetchTasks).not.toHaveBeenCalled();
    expect(mocks.fetchTask).not.toHaveBeenCalled();
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
    cleanup();
    client.clear();
  });

  it("passes cancellation signals to authorized list and detail reads", async () => {
    const { client, Wrapper } = createWrapper();
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
