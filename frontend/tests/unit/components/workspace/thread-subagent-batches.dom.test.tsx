import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const featureState = rs.hoisted(() => ({
  repositoryAvailable: true,
  workerRunning: false,
}));
const authState = rs.hoisted(() => ({
  user: { id: "user-1", permissions: ["threads:read"] as string[] },
}));
const batchState = rs.hoisted(() => ({
  batches: [] as Array<Record<string, unknown>>,
  control: rs.fn(),
  itemPages: [] as Array<Array<Record<string, unknown>>>,
  fetchNextPage: rs.fn(),
  hasNextPage: false,
  error: undefined as Error | undefined,
  isError: false,
  itemError: undefined as Error | undefined,
  itemsIsError: false,
  readEnabled: true,
  cacheScope: undefined as string | undefined,
}));

rs.mock("@/core/features", () => ({
  useSubagentBatchesCapability: () => ({
    ...featureState,
    maxRunning: 3,
    isLoading: false,
  }),
}));

rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      common: { loading: "Loading", loadMore: "Load more" },
      subagentBatches: {
        label: "Batches",
        title: "Subagent batches",
        description: "Durable batch work",
        workerUnavailable:
          "The batch worker is not running. Historical batches are read-only.",
        empty: "No batches",
        emptyHint: "Submit a batch",
        loadFailed: "Load failed",
        pause: "Pause",
        resume: "Resume",
        cancel: "Cancel",
        retryItem: "Retry",
        exportResults: "Export JSONL",
        viewItems: "View items",
        hideItems: "Hide items",
        itemsFailed: "Items failed",
        progress: (completed: number, total: number) =>
          `${completed} of ${total}`,
        limits: (live: number, running: number) =>
          `Live ${live} running ${running}`,
        status: {
          queued: "Queued",
          running: "Running",
          paused: "Paused",
          completed: "Completed",
          failed: "Failed",
          cancelled: "Cancelled",
        },
      },
    },
  }),
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: authState.user }),
}));

rs.mock("@/core/subagent-batches", () => ({
  completedSubagentBatchItems: () => 1,
  isActiveSubagentBatch: (batch: { status: string }) =>
    ["queued", "running", "paused"].includes(batch.status),
  subagentBatchProgress: () => 50,
  subagentBatchResultsUrl: () => "/results.jsonl",
  useControlSubagentBatch: () => ({
    isPending: false,
    variables: undefined,
    mutate: batchState.control,
  }),
  useRetrySubagentBatchItem: () => ({
    isPending: false,
    variables: undefined,
    mutate: rs.fn(),
  }),
  useSubagentBatchItems: () => ({
    data: { pages: batchState.itemPages },
    isLoading: false,
    isError: batchState.itemsIsError,
    error: batchState.itemError,
    hasNextPage: batchState.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: batchState.fetchNextPage,
  }),
  useSubagentBatches: (
    _threadId: string,
    options: { enabled: boolean; cacheScope?: string },
  ) => {
    batchState.readEnabled = options.enabled;
    batchState.cacheScope = options.cacheScope;
    return {
      data: batchState.batches,
      isLoading: false,
      isError: batchState.isError,
      error: batchState.error,
    };
  },
}));

import { ThreadSubagentBatches } from "@/components/workspace/thread-subagent-batches";

const HISTORICAL_BATCH = {
  id: "batch-1",
  title: "Historical records",
  subagent_type: "general-purpose",
  status: "running",
  total_items: 2,
  max_live_items: 2,
  max_running_items: 1,
  max_attempts: 3,
  counts: {
    pending: 0,
    queued: 0,
    leased: 0,
    running: 1,
    succeeded: 1,
    failed: 0,
    cancelled: 0,
  },
  created_at: "2026-08-24T00:00:00Z",
  updated_at: "2026-08-24T00:01:00Z",
  completed_at: null,
};

afterEach(() => {
  cleanup();
  featureState.repositoryAvailable = true;
  featureState.workerRunning = false;
  authState.user.permissions = ["threads:read"];
  batchState.batches = [];
  batchState.control.mockReset();
  batchState.itemPages = [];
  batchState.fetchNextPage.mockReset();
  batchState.hasNextPage = false;
  batchState.error = undefined;
  batchState.isError = false;
  batchState.itemError = undefined;
  batchState.itemsIsError = false;
  batchState.readEnabled = true;
  batchState.cacheScope = undefined;
});

describe("ThreadSubagentBatches capability gating", () => {
  it("scopes batch history to the authenticated user", () => {
    render(<ThreadSubagentBatches threadId="thread-1" />);

    expect(batchState.cacheScope).toBe("user-1");
  });

  it("keeps historical batches readable when the worker is stopped", async () => {
    batchState.batches = [HISTORICAL_BATCH];
    render(<ThreadSubagentBatches threadId="thread-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Batches" }));

    expect(
      await screen.findByText(
        "The batch worker is not running. Historical batches are read-only.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Pause" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByRole("link", { name: "Export JSONL" }).getAttribute("href"),
    ).toBe("/results.jsonl");
  });

  it("hides an unused batch surface when neither worker nor history exists", () => {
    render(<ThreadSubagentBatches threadId="thread-1" />);
    expect(screen.queryByRole("button", { name: "Batches" })).toBeNull();
  });

  it("does not request or show batch data without threads:read", () => {
    authState.user.permissions = ["threads:write"];
    batchState.batches = [HISTORICAL_BATCH];
    render(<ThreadSubagentBatches threadId="thread-1" />);

    expect(batchState.readEnabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Batches" })).toBeNull();
  });

  it("keeps history and export available while disabling all write actions", async () => {
    featureState.workerRunning = true;
    batchState.batches = [HISTORICAL_BATCH];
    batchState.itemPages = [
      [
        {
          id: "failed-item",
          item_key: "record-1",
          status: "failed",
          result_preview: null,
        },
      ],
    ];
    render(<ThreadSubagentBatches threadId="thread-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Batches" }));
    expect(screen.getByRole("button", { name: "Pause" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("link", { name: "Export JSONL" })).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "View items" }));
    expect(screen.getByRole("button", { name: "Retry" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("loads the next page of batch items", async () => {
    batchState.batches = [HISTORICAL_BATCH];
    batchState.itemPages = [
      [
        {
          id: "item-1",
          item_key: "record-1",
          status: "succeeded",
          result_preview: "done",
        },
      ],
    ];
    batchState.hasNextPage = true;
    render(<ThreadSubagentBatches threadId="thread-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Batches" }));
    fireEvent.click(screen.getByRole("button", { name: "View items" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(batchState.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("uses a safe message when the batch list query fails", async () => {
    batchState.isError = true;
    batchState.error = new Error("private database connection string");
    render(<ThreadSubagentBatches threadId="thread-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Batches" }));

    expect(await screen.findByText("Load failed")).toBeDefined();
    expect(screen.queryByText("private database connection string")).toBeNull();
  });

  it("does not show raw API details when loading batch items fails", async () => {
    batchState.batches = [HISTORICAL_BATCH];
    batchState.itemsIsError = true;
    batchState.itemError = new Error("private batch storage detail");
    render(<ThreadSubagentBatches threadId="thread-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Batches" }));
    fireEvent.click(await screen.findByRole("button", { name: "View items" }));

    expect(await screen.findByText("Items failed")).toBeDefined();
    expect(screen.queryByText("private batch storage detail")).toBeNull();
  });
});
