import { afterEach, expect, test, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const authState = rs.hoisted(() => ({
  userId: "owner-a" as string | null,
  permissions: null as string[] | null,
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));

rs.mock("@/core/scheduled-tasks/api", () => ({
  fetchScheduledTaskRuns: rs.fn(),
}));

import { fetchScheduledTaskRuns } from "@/core/scheduled-tasks/api";
import {
  scheduledTaskRunHistoryQueryKey,
  useScheduledTaskRunHistory,
} from "@/core/scheduled-tasks/run-history";
import type { ScheduledTaskRun } from "@/core/scheduled-tasks/types";

const fetchRuns = rs.mocked(fetchScheduledTaskRuns);
const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
const rows = (count: number, prefix = "run") =>
  Array.from(
    { length: count },
    (_, index) => ({ id: `${prefix}-${index}` }) as ScheduledTaskRun,
  );
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  fetchRuns.mockReset();
  authState.userId = "owner-a";
  authState.permissions = null;
});

test("a full final page does not expose the next-page sentinel", async () => {
  fetchRuns.mockImplementation(async (_task, page) =>
    rows(page?.offset === 0 ? 51 : 50),
  );
  const { result } = renderHook(() => useScheduledTaskRunHistory("task-a"), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(result.current.hasOlder).toBe(true));
  expect(result.current.data).toHaveLength(50);
  act(() => {
    void result.current.older();
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.hasOlder).toBe(false);
  expect(result.current.data).toHaveLength(50);
  expect(fetchRuns).toHaveBeenLastCalledWith("task-a", {
    limit: 51,
    offset: 50,
    signal: expect.any(AbortSignal),
  });
});

test("switching tasks aborts an in-flight older page and rejects its late result", async () => {
  let oldSignal: AbortSignal | undefined;
  let finishOld!: (data: ScheduledTaskRun[]) => void;
  fetchRuns.mockImplementation(async (id, page) => {
    if (id === "task-a" && page?.offset === 50) {
      oldSignal = page.signal;
      return new Promise((resolve) => {
        finishOld = resolve;
      });
    }
    return rows(id === "task-a" ? 51 : 1, id);
  });
  const { result, rerender } = renderHook(
    ({ taskId }) => useScheduledTaskRunHistory(taskId),
    { initialProps: { taskId: "task-a" }, wrapper: wrapper() },
  );
  await waitFor(() => expect(result.current.hasOlder).toBe(true));
  act(() => {
    void result.current.older();
  });
  await waitFor(() => expect(oldSignal).toBeDefined());
  expect(result.current.isPending).toBe(true);
  rerender({ taskId: "task-b" });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe("task-b-0"));
  expect(result.current.page).toBe(0);
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => finishOld(rows(50, "stale-task-a")));
  expect(result.current.data?.[0]?.id).toBe("task-b-0");
});

test("an empty older page retains a route back to the latest records", async () => {
  fetchRuns.mockImplementation(async (_id, page) =>
    rows(page?.offset === 0 ? 51 : 0),
  );
  const { result } = renderHook(() => useScheduledTaskRunHistory("task-a"), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(result.current.hasOlder).toBe(true));
  act(() => {
    void result.current.older();
  });
  await waitFor(() => expect(result.current.data).toEqual([]));
  expect(result.current.page).toBe(1);
  fetchRuns.mockImplementation(async () => rows(1, "new"));
  act(() => {
    void result.current.latest();
  });
  await waitFor(() => expect(result.current.data?.[0]?.id).toBe("new-0"));
  expect(result.current.page).toBe(0);
});

test("disabled run history hides cached rows and does not issue a request", () => {
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  client.setQueryData(
    scheduledTaskRunHistoryQueryKey("owner-a", "task-a", 0),
    rows(1),
  );

  const { result, unmount } = renderHook(
    () => useScheduledTaskRunHistory("task-a", { enabled: false }),
    { wrapper: testWrapper },
  );
  try {
    expect(result.current.data).toBeUndefined();
    expect(result.current.hasOlder).toBe(false);
    expect(fetchRuns).not.toHaveBeenCalled();
  } finally {
    unmount();
  }
});

test("revoking runs:read hides and clears only this owner's history", async () => {
  const testWrapper = wrapper();
  const client = clients.at(-1)!;
  const currentKey = scheduledTaskRunHistoryQueryKey("owner-a", "task-a", 0);
  const otherKey = scheduledTaskRunHistoryQueryKey("owner-b", "task-a", 0);
  client.setQueryData(currentKey, rows(1, "mine"));
  client.setQueryData(otherKey, rows(1, "other"));
  authState.permissions = ["threads:read"];

  const { result } = renderHook(() => useScheduledTaskRunHistory("task-a"), {
    wrapper: testWrapper,
  });

  expect(result.current.accessDenied).toBe(true);
  expect(result.current.data).toBeUndefined();
  await waitFor(() => {
    expect(client.getQueryData(currentKey)).toBeUndefined();
  });
  expect(client.getQueryData(otherKey)).toEqual(rows(1, "other"));
  expect(fetchRuns).not.toHaveBeenCalled();
});

test("revoking threads:read aborts an in-flight history read", async () => {
  let signal: AbortSignal | undefined;
  fetchRuns.mockImplementation((_taskId, page) => {
    signal = page?.signal;
    return new Promise(() => undefined);
  });
  authState.permissions = ["threads:read", "runs:read"];
  const { result, rerender } = renderHook(
    () => useScheduledTaskRunHistory("task-a"),
    { wrapper: wrapper() },
  );

  await waitFor(() => {
    expect(signal?.aborted).toBe(false);
  });
  authState.permissions = ["runs:read"];
  rerender();

  await waitFor(() => {
    expect(result.current.accessDenied).toBe(true);
    expect(signal?.aborted).toBe(true);
  });
  expect(result.current.data).toBeUndefined();
});
