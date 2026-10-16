import { beforeEach, expect, test, rs } from "@rstest/core";

import { GatewayApiError } from "@/core/api/errors";

const fetchWithAuth = rs.fn();
const isStaticWebsiteOnly = rs.fn(() => false);
const loadStaticDemoThreads = rs.fn();

rs.mock("@/core/api/fetcher", () => ({
  fetch: fetchWithAuth,
}));
rs.mock("@/core/static-mode", () => ({ isStaticWebsiteOnly }));
rs.mock("@/core/threads/static-demo", () => ({ loadStaticDemoThreads }));

beforeEach(() => {
  fetchWithAuth.mockReset();
  isStaticWebsiteOnly.mockReturnValue(false);
  loadStaticDemoThreads.mockReset();
});

test("fetchThreadTokenUsage uses shared auth fetch without JSON GET headers", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => ({
      thread_id: "thread-1",
      total_input_tokens: 3,
      total_output_tokens: 4,
      total_tokens: 7,
      total_runs: 1,
      by_model: { unknown: { tokens: 7, runs: 1 } },
      by_caller: {
        lead_agent: 0,
        subagent: 0,
        middleware: 0,
      },
    }),
  });

  const { fetchThreadTokenUsage } = await import("@/core/threads/api");

  await expect(fetchThreadTokenUsage("thread-1")).resolves.toMatchObject({
    thread_id: "thread-1",
    total_tokens: 7,
  });

  expect(fetchWithAuth).toHaveBeenCalledWith(
    expect.stringContaining("/api/threads/thread-1/token-usage"),
    {
      method: "GET",
    },
  );
});

test("fetchThreadTokenUsage returns null for unavailable token usage", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: false,
    status: 404,
  });

  const { fetchThreadTokenUsage } = await import("@/core/threads/api");

  await expect(fetchThreadTokenUsage("thread-1")).resolves.toBeNull();
});

test("fetchThreadTokenUsage forwards the React Query abort signal", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => ({ thread_id: "thread-1" }),
  });
  const controller = new AbortController();

  const { fetchThreadTokenUsage } = await import("@/core/threads/api");
  await fetchThreadTokenUsage("thread-1", controller.signal);

  expect(fetchWithAuth).toHaveBeenCalledWith(
    expect.stringContaining("/api/threads/thread-1/token-usage"),
    { method: "GET", signal: controller.signal },
  );
});

test("searchThreads can inventory active and archived conversations together", async () => {
  fetchWithAuth.mockResolvedValue({ ok: true, json: async () => [] });

  const { searchThreads } = await import("@/core/threads/api");
  await expect(searchThreads({ limit: 25, offset: 50 })).resolves.toEqual([]);

  const request = fetchWithAuth.mock.calls[0]?.[1];
  expect(request.method).toBe("POST");
  expect(JSON.parse(request.body)).toEqual({ limit: 25, offset: 50 });
});

test("searchThreads reads public fixtures in static demo mode", async () => {
  isStaticWebsiteOnly.mockReturnValue(true);
  loadStaticDemoThreads.mockResolvedValue([
    { thread_id: "active", metadata: {} },
    { thread_id: "archived", metadata: { deerflow_archived: true } },
  ]);

  const { searchThreads } = await import("@/core/threads/api");
  await expect(
    searchThreads({ archived: false, limit: 1, offset: 0 }),
  ).resolves.toEqual([{ thread_id: "active", metadata: {} }]);
  expect(loadStaticDemoThreads).toHaveBeenCalledWith();
  expect(fetchWithAuth).not.toHaveBeenCalled();
});

test("branchThreadFromTurn posts the selected turn ids to the gateway", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => ({
      thread_id: "branch-thread",
      parent_thread_id: "thread/1",
      parent_checkpoint_id: "checkpoint-2",
      branched_from_message_id: "ai-2",
      workspace_clone_mode: "current_thread_best_effort",
    }),
  });

  const { branchThreadFromTurn } = await import("@/core/threads/api");

  await expect(
    branchThreadFromTurn("thread/1", {
      messageId: "ai-2",
      messageIds: ["ai-1", "ai-2"],
      title: "Branch: original",
    }),
  ).resolves.toMatchObject({
    thread_id: "branch-thread",
    parent_checkpoint_id: "checkpoint-2",
  });

  expect(fetchWithAuth).toHaveBeenCalledWith(
    expect.stringContaining("/api/threads/thread%2F1/branches"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message_id: "ai-2",
        message_ids: ["ai-1", "ai-2"],
        title: "Branch: original",
      }),
    },
  );
});

test("branchThreadFromTurn surfaces gateway detail on failure", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: false,
    json: async () => ({
      detail: "This turn can no longer be branched from.",
    }),
  });

  const { branchThreadFromTurn } = await import("@/core/threads/api");

  await expect(
    branchThreadFromTurn("thread-1", {
      messageId: "ai-2",
      messageIds: ["ai-2"],
    }),
  ).rejects.toThrow("This turn can no longer be branched from.");
});

test("compactThreadContext posts agent attribution and abort signal", async () => {
  const controller = new AbortController();
  fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => ({
      thread_id: "thread-1",
      compacted: true,
      removed_message_count: 4,
      preserved_message_count: 2,
      summary_updated: true,
      checkpoint_id: "checkpoint-3",
      total_tokens: 123,
    }),
  });

  const { compactThreadContext } = await import("@/core/threads/api");

  await expect(
    compactThreadContext("thread-1", {
      agentName: "research-agent",
      signal: controller.signal,
    }),
  ).resolves.toMatchObject({
    compacted: true,
    checkpoint_id: "checkpoint-3",
  });

  expect(fetchWithAuth).toHaveBeenCalledWith(
    expect.stringContaining("/api/threads/thread-1/compact"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        force: true,
        agent_name: "research-agent",
      }),
      signal: controller.signal,
    },
  );
});

test("compactThreadContext surfaces an active-run conflict", async () => {
  fetchWithAuth.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      detail: "Thread has a run in flight. Compact after the run finishes.",
    }),
  });

  const { compactThreadContext } = await import("@/core/threads/api");
  const failedRequest = compactThreadContext("thread-1");

  await expect(failedRequest).rejects.toBeInstanceOf(GatewayApiError);
  await expect(failedRequest).rejects.toMatchObject({
    status: 409,
    message: "Thread has a run in flight. Compact after the run finishes.",
  });
});
