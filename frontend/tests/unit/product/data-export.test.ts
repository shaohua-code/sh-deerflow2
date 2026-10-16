import { describe, expect, it, rs } from "@rstest/core";

const {
  searchThreads,
  fetchThreadHistoryPage,
  listAgents,
  listProjects,
  fetchScheduledTasks,
  exportMemory,
  fetchProductSettings,
  fetchProductFiles,
  listUploadedFiles,
  loadProjectFilePage,
  loadThreadFilePage,
  mergeFileCenterRows,
  fetchWithAuth,
} = rs.hoisted(() => ({
  searchThreads: rs.fn(),
  fetchThreadHistoryPage: rs.fn(),
  listAgents: rs.fn(),
  listProjects: rs.fn(),
  fetchScheduledTasks: rs.fn(),
  exportMemory: rs.fn(),
  fetchProductSettings: rs.fn(),
  fetchProductFiles: rs.fn(),
  listUploadedFiles: rs.fn(),
  loadProjectFilePage: rs.fn(),
  loadThreadFilePage: rs.fn(),
  mergeFileCenterRows: rs.fn(),
  fetchWithAuth: rs.fn(),
}));

rs.mock("@/core/threads/api", () => ({
  fetchThreadHistoryPage,
  searchThreads,
}));
rs.mock("@/core/agents/api", () => ({ listAgents }));
rs.mock("@/core/projects/api", () => ({ listProjects }));
rs.mock("@/core/scheduled-tasks/api", () => ({ fetchScheduledTasks }));
rs.mock("@/core/memory/api", () => ({ exportMemory }));
rs.mock("@/product/api", () => ({ fetchProductSettings, fetchProductFiles }));
rs.mock("@/core/uploads/api", () => ({ listUploadedFiles }));
rs.mock("@/product/file-center-data", () => ({
  loadProjectFilePage,
  loadThreadFilePage,
  mergeFileCenterRows,
}));
rs.mock("@/core/api/fetcher", () => ({ fetch: fetchWithAuth }));

import { createUserDataExport } from "@/product/data-export";

describe("account data export", () => {
  it("keeps the package partial even when every available read succeeds", async () => {
    searchThreads.mockResolvedValue([
      {
        thread_id: "thread-1",
        status: "idle",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        metadata: {},
        values: { title: "Research" },
      },
    ]);
    fetchThreadHistoryPage
      .mockResolvedValueOnce({
        data: [{ seq: 2, type: "ai", content: "world" }],
        has_more: true,
        next_before_seq: 2,
      })
      .mockResolvedValueOnce({
        data: [{ seq: 1, type: "human", content: "hello" }],
        has_more: false,
        next_before_seq: null,
      });
    listAgents.mockResolvedValue([]);
    listProjects.mockResolvedValue([]);
    fetchScheduledTasks.mockResolvedValue([]);
    exportMemory.mockResolvedValue({ memories: [] });
    fetchProductSettings.mockResolvedValue({ settings: [] });
    fetchProductFiles.mockResolvedValue({
      api_version: 1,
      files: [],
      total: 0,
      limit: 100,
      offset: 0,
      has_more: false,
      next_offset: null,
      truncated: false,
      failed_count: 0,
      coverage_notes: [],
    });
    listUploadedFiles.mockResolvedValue({ files: [], count: 0 });
    loadProjectFilePage.mockResolvedValue({
      rows: [],
      failedProjectIds: [],
      truncated: false,
    });
    loadThreadFilePage.mockResolvedValue({
      rows: [],
      failedThreadIds: [],
      truncatedThreadIds: [],
    });
    mergeFileCenterRows.mockImplementation((threadRows, projectRows) => [
      ...threadRows,
      ...projectRows,
    ]);
    fetchWithAuth.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const progress = rs.fn();
    const controller = new AbortController();
    const result = await createUserDataExport("owner-1", progress, {
      signal: controller.signal,
    });

    expect(result.format).toBe("flow-desk-user-data-v1");
    expect(result.owner_user_id).toBe("owner-1");
    expect(result.completeness).toBe("partial");
    expect(result.failures).toEqual([]);
    expect(result.coverage_notes).toContain(
      "Even with no item-level failures, this package covers only sources exposed by the current account APIs; it is not a complete account export.",
    );
    expect(
      result.resources.conversations[0]?.messages.map((message) => message.seq),
    ).toEqual([1, 2]);
    expect(searchThreads).toHaveBeenCalledWith({
      limit: 1000,
      offset: 0,
      signal: controller.signal,
    });
    expect(fetchThreadHistoryPage).toHaveBeenCalledWith("thread-1", {
      beforeSeq: undefined,
      signal: controller.signal,
    });
    expect(fetchThreadHistoryPage).toHaveBeenCalledWith("thread-1", {
      beforeSeq: 2,
      signal: controller.signal,
    });
    expect(listProjects).toHaveBeenCalledWith("active", {
      signal: controller.signal,
    });
    expect(listProjects).toHaveBeenCalledWith("archived", {
      signal: controller.signal,
    });
    expect(listAgents).toHaveBeenCalledWith({ signal: controller.signal });
    expect(fetchScheduledTasks).toHaveBeenCalledWith(controller.signal);
    expect(exportMemory).toHaveBeenCalledWith("owner-1", controller.signal);
    expect(fetchProductSettings).toHaveBeenCalledWith(controller.signal);
    expect(loadProjectFilePage).toHaveBeenCalledWith([], 3, {
      signal: controller.signal,
    });
    expect(loadThreadFilePage.mock.calls[0]?.[4]).toBe(controller.signal);
    expect(fetchProductFiles.mock.calls[0]?.[3]).toBe(controller.signal);
    expect(progress.mock.calls.map(([event]) => event.stage)).toEqual(
      expect.arrayContaining(["inventory", "history", "files", "package"]),
    );
  });

  it("marks inaccessible history as partial and records the affected thread", async () => {
    searchThreads.mockResolvedValue([
      {
        thread_id: "thread-private",
        status: "idle",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        metadata: {},
        values: { title: "Private" },
      },
    ]);
    fetchThreadHistoryPage.mockRejectedValue(new Error("forbidden"));
    listAgents.mockResolvedValue([]);
    listProjects.mockResolvedValue([]);
    fetchScheduledTasks.mockResolvedValue([]);
    exportMemory.mockResolvedValue({ memories: [] });
    fetchProductSettings.mockResolvedValue({ settings: [] });
    fetchProductFiles.mockResolvedValue({
      api_version: 1,
      files: [],
      total: 0,
      limit: 100,
      offset: 0,
      has_more: false,
      next_offset: null,
      truncated: false,
      failed_count: 0,
      coverage_notes: [],
    });
    listUploadedFiles.mockResolvedValue({ files: [], count: 0 });
    loadProjectFilePage.mockResolvedValue({
      rows: [],
      failedProjectIds: [],
      truncated: false,
    });
    loadThreadFilePage.mockResolvedValue({
      rows: [],
      failedThreadIds: [],
      truncatedThreadIds: [],
    });
    mergeFileCenterRows.mockImplementation((threadRows, projectRows) => [
      ...threadRows,
      ...projectRows,
    ]);

    const result = await createUserDataExport("owner-1");

    expect(result.completeness).toBe("partial");
    expect(result.failures).toContainEqual({
      resource: "thread_history",
      resource_id: "thread-private",
      reason: "unavailable",
    });
    expect(result.resources.conversations[0]?.messages).toEqual([]);
  });

  it("includes eligible owner workspace files from one bounded Gateway catalog read", async () => {
    fetchProductFiles.mockClear();
    fetchWithAuth.mockClear();
    searchThreads.mockResolvedValue([]);
    listAgents.mockResolvedValue([]);
    listProjects.mockResolvedValue([]);
    fetchScheduledTasks.mockResolvedValue([]);
    exportMemory.mockResolvedValue({ memories: [] });
    fetchProductSettings.mockResolvedValue({ settings: [] });
    loadThreadFilePage.mockResolvedValue({
      rows: [],
      failedThreadIds: [],
      truncatedThreadIds: [],
    });
    loadProjectFilePage.mockResolvedValue({
      rows: [],
      failedProjectIds: [],
      truncated: false,
    });
    mergeFileCenterRows.mockImplementation((threadRows, projectRows) => [
      ...threadRows,
      ...projectRows,
    ]);
    fetchProductFiles.mockResolvedValueOnce({
      api_version: 1,
      files: [
        {
          file_id: "workspace:thread-1:docs/guide.md",
          source: "thread_workspace",
          name: "docs/guide.md",
          size_bytes: 14,
          artifact_url: "/api/threads/thread-1/files/workspace/docs%2Fguide.md",
          modified_at: null,
          storage_name: null,
          thread_id: "thread-1",
          thread_name: "Research",
          project_id: null,
          project_name: null,
          document_id: null,
        },
        {
          file_id: "workspace:thread-1:.env",
          source: "thread_workspace",
          name: ".env",
          size_bytes: 12,
          artifact_url: "/api/threads/thread-1/files/workspace/.env",
          modified_at: null,
          storage_name: null,
          thread_id: "thread-1",
          thread_name: "Research",
          project_id: null,
          project_name: null,
          document_id: null,
        },
        {
          file_id: "workspace:thread-1:C:/outside.txt",
          source: "thread_workspace",
          name: "C:/outside.txt",
          size_bytes: 15,
          artifact_url:
            "/api/threads/thread-1/files/workspace/C%3A%2Foutside.txt",
          modified_at: null,
          storage_name: null,
          thread_id: "thread-1",
          thread_name: "Research",
          project_id: null,
          project_name: null,
          document_id: null,
        },
      ],
      total: 3,
      limit: 10_000,
      offset: 0,
      has_more: false,
      next_offset: null,
      truncated: true,
      failed_count: 1,
      coverage_notes: ["Gateway workspace scan limit reached."],
    });
    fetchWithAuth.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () =>
        new TextEncoder().encode("workspace note").buffer,
    });

    const result = await createUserDataExport("owner-1");

    expect(fetchProductFiles).toHaveBeenCalledExactlyOnceWith(
      10_000,
      0,
      "",
      undefined,
    );
    expect(result.resources.files).toHaveLength(1);
    expect(result.resources.files[0]?.source.kind).toBe("workspace");
    expect(result.resources.files[0]?.name).toBe("docs/guide.md");
    expect(atob(result.resources.files[0]?.content_base64 ?? "")).toBe(
      "workspace note",
    );
    expect(result.coverage_notes).toContain(
      "Gateway workspace scan limit reached.",
    );
    expect(result.coverage_notes).toContain(
      "Sensitive-looking workspace paths were omitted from the export.",
    );
    expect(result.coverage_notes).toContain(
      "Workspace paths that were not safe portable relative paths were omitted.",
    );
    expect(result.failures).toContainEqual({
      resource: "workspace_file_catalog_truncated",
      reason: "size_limit",
    });
    expect(result.failures).toContainEqual({
      resource: "workspace_file_catalog",
      reason: "unavailable",
    });
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("passes cancellation through history reads and stops before the next batch", async () => {
    searchThreads.mockClear();
    fetchThreadHistoryPage.mockClear();
    loadThreadFilePage.mockClear();
    const threads = Array.from({ length: 5 }, (_, index) => ({
      thread_id: `thread-${index}`,
      status: "idle",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      metadata: {},
      values: { title: `Thread ${index}` },
    }));
    searchThreads.mockResolvedValue(threads);
    fetchThreadHistoryPage.mockResolvedValue({
      data: [],
      has_more: false,
      next_before_seq: null,
    });
    listAgents.mockResolvedValue([]);
    listProjects.mockResolvedValue([]);
    fetchScheduledTasks.mockResolvedValue([]);
    exportMemory.mockResolvedValue({ memories: [] });
    fetchProductSettings.mockResolvedValue({ settings: [] });

    const controller = new AbortController();
    await expect(
      createUserDataExport(
        "owner-1",
        (progress) => {
          if (progress.stage === "history" && progress.completed === 4) {
            controller.abort();
          }
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchThreadHistoryPage).toHaveBeenCalledTimes(4);
    expect(fetchThreadHistoryPage.mock.calls[0]?.[1].signal).toBe(
      controller.signal,
    );
    expect(searchThreads.mock.calls[0]?.[0].signal).toBe(controller.signal);
    expect(loadThreadFilePage).not.toHaveBeenCalled();
  });

  it("aborts a file download when the owner cancels the export", async () => {
    searchThreads.mockResolvedValue([]);
    listAgents.mockResolvedValue([]);
    listProjects.mockResolvedValue([]);
    fetchScheduledTasks.mockResolvedValue([]);
    exportMemory.mockResolvedValue({ memories: [] });
    fetchProductSettings.mockResolvedValue({ settings: [] });
    fetchProductFiles.mockResolvedValue({
      api_version: 1,
      files: [],
      total: 0,
      limit: 100,
      offset: 0,
      has_more: false,
      next_offset: null,
      truncated: false,
      failed_count: 0,
      coverage_notes: [],
    });
    loadThreadFilePage.mockResolvedValue({
      rows: [],
      failedThreadIds: [],
      truncatedThreadIds: [],
    });
    loadProjectFilePage.mockResolvedValue({
      rows: [
        {
          id: "project-document:project-1:file-1",
          name: "notes.txt",
          size: 12,
          artifactUrl: "/api/projects/project-1/files/file-1",
          kind: "project-document",
          projectId: "project-1",
          documentId: "file-1",
        },
      ],
      failedProjectIds: [],
      truncated: false,
    });
    mergeFileCenterRows.mockImplementation((threadRows, projectRows) => [
      ...threadRows,
      ...projectRows,
    ]);

    let markRequestStarted:
      | ((signal: AbortSignal | undefined) => void)
      | undefined;
    const requestStarted = new Promise<AbortSignal | undefined>((resolve) => {
      markRequestStarted = resolve;
    });
    fetchWithAuth.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          markRequestStarted?.(init.signal ?? undefined);
          init.signal?.addEventListener(
            "abort",
            () =>
              reject(new DOMException("Data export cancelled", "AbortError")),
            { once: true },
          );
        }),
    );

    const controller = new AbortController();
    const pending = createUserDataExport("owner-1", undefined, {
      signal: controller.signal,
    });
    const downloadSignal = await requestStarted;
    expect(downloadSignal).toBe(controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
