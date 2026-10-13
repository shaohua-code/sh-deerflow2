import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { AgentThread } from "@/core/threads";
import type { ListFilesResponse } from "@/core/uploads/api";
import {
  getFileCenterEmptyState,
  loadProjectFilePage,
  loadThreadFilePage,
  mergeFileCenterRows,
} from "@/product/file-center-data";

const {
  listProjectDocuments,
  listProjectThreadFiles,
  urlOfProjectDocumentContent,
} = rs.hoisted(() => ({
  listProjectDocuments: rs.fn(),
  listProjectThreadFiles: rs.fn(),
  urlOfProjectDocumentContent: rs.fn(() => "/project-document"),
}));

rs.mock("@/core/projects/api", () => ({
  listProjectDocuments,
  listProjectThreadFiles,
  urlOfProjectDocumentContent,
}));

beforeEach(() => {
  listProjectDocuments.mockReset();
  listProjectThreadFiles.mockReset();
  urlOfProjectDocumentContent.mockClear();
});

function thread(thread_id: string) {
  return { thread_id } as AgentThread;
}

describe("file center empty state", () => {
  it("does not claim the inventory is empty when a source failed", () => {
    expect(getFileCenterEmptyState("", true)).toBe("partial");
    expect(getFileCenterEmptyState("", false)).toBe("empty");
  });

  it("keeps a filtered no-match message distinct from an empty inventory", () => {
    expect(getFileCenterEmptyState("proposal", true)).toBe("filtered");
  });
});

describe("file center thread inventory", () => {
  it("deduplicates project uploads while retaining projects and outputs", () => {
    const directUpload = {
      id: "thread:thread-1:stored-name",
      name: "friendly-name.pdf",
      size: 12,
      artifactUrl: "/thread-upload",
      kind: "upload" as const,
      threadId: "thread-1",
      deleteName: "stored-name",
    };
    const projectUpload = {
      id: "project-thread:project-1:thread-1:upload:stored-name",
      name: "stored-name",
      size: 12,
      artifactUrl: "/project-upload",
      kind: "upload" as const,
      threadId: "thread-1",
      deleteName: "stored-name",
      projectName: "Research",
    };
    const output = {
      ...projectUpload,
      id: "project-thread:project-1:thread-1:output:result.md",
      name: "result.md",
      kind: "output" as const,
      deleteName: undefined,
    };
    const directOutput = {
      ...output,
      id: "thread-output:thread-1:result.md",
      artifactUrl: "/direct-output",
      thread: thread("thread-1"),
    };
    const shelfDocument = {
      ...projectUpload,
      id: "project-document:project-1:document-1",
      name: "reference.pdf",
      kind: "project-document" as const,
      documentId: "document-1",
    };

    const rows = mergeFileCenterRows(
      [directUpload, directOutput],
      [projectUpload, output, shelfDocument],
    );

    expect(rows.map((row) => row.id)).toEqual([
      directUpload.id,
      directOutput.id,
      shelfDocument.id,
    ]);
  });

  it("limits concurrent requests and keeps successful results when one thread fails", async () => {
    const threads = [
      thread("a"),
      thread("b"),
      thread("c"),
      thread("d"),
      thread("e"),
    ];
    let active = 0;
    let peak = 0;
    const loadFiles = async (threadId: string): Promise<ListFilesResponse> => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      if (threadId === "c") throw new Error("forbidden");
      return {
        count: 1,
        files: [
          {
            filename: `${threadId}.txt`,
            size: 4,
            path: `/private/${threadId}.txt`,
            virtual_path: `${threadId}.txt`,
            artifact_url: `/artifact/${threadId}.txt`,
          },
        ],
      };
    };

    const result = await loadThreadFilePage(threads, loadFiles, 2);

    expect(peak).toBe(2);
    expect(result.failedThreadIds).toEqual(["c"]);
    expect(
      result.rows.map(
        ({ thread: owner, name }) => `${owner?.thread_id}:${name}`,
      ),
    ).toEqual(["a:a.txt", "b:b.txt", "d:d.txt", "e:e.txt"]);
  });

  it("includes unprojected generated outputs and reports per-thread truncation", async () => {
    const result = await loadThreadFilePage(
      [thread("thread-output")],
      async () => ({ files: [], count: 0 }),
      1,
      async () => ({
        count: 201,
        truncated: true,
        files: [
          {
            filename: "answer.md",
            size: 16,
            modified: 1_790_000_000,
            artifact_url: "/generated/answer.md",
          },
        ],
      }),
    );

    expect(result.failedThreadIds).toEqual([]);
    expect(result.truncatedThreadIds).toEqual(["thread-output"]);
    expect(result.rows).toMatchObject([
      {
        id: "thread-output:thread-output:answer.md",
        kind: "output",
        threadId: "thread-output",
      },
    ]);
    expect(result.rows[0]).not.toHaveProperty("deleteName");
  });

  it("rejects invalid concurrency values instead of creating a stalled loop", async () => {
    await expect(
      loadThreadFilePage([], async () => ({ files: [], count: 0 }), 0),
    ).rejects.toThrow("positive integer");
  });

  it("loads every project document page and reports capped thread file groups", async () => {
    listProjectDocuments
      .mockResolvedValueOnce({
        total: 2,
        documents: [
          {
            id: "doc-1",
            name: "brief.md",
            size_bytes: 12,
            updated_at: "2026-09-01T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 2,
        documents: [
          {
            id: "doc-2",
            name: "table.csv",
            size_bytes: 30,
            updated_at: "2026-09-02T00:00:00Z",
          },
        ],
      });
    listProjectThreadFiles
      .mockResolvedValueOnce({
        groups: [
          {
            thread_id: "thread-1",
            files: [
              {
                kind: "output",
                name: "report.pdf",
                size_bytes: 100,
                modified_at: "2026-09-03T00:00:00Z",
                artifact_url: "/thread-output",
              },
            ],
          },
        ],
        next_offset: 50,
        truncated: true,
      })
      .mockResolvedValueOnce({
        groups: [],
        next_offset: null,
        truncated: false,
      });

    const result = await loadProjectFilePage([
      {
        id: "project-1",
        name: "Research",
        status: "active",
        instructions: "",
        presentation: {},
        created_at: "",
        updated_at: "",
      },
    ]);

    expect(listProjectDocuments).toHaveBeenCalledTimes(2);
    expect(listProjectThreadFiles).toHaveBeenCalledTimes(2);
    expect(result.rows.map((row) => row.name)).toEqual([
      "brief.md",
      "table.csv",
      "report.pdf",
    ]);
    expect(result.truncated).toBe(true);
    expect(result.failedProjectIds).toEqual([]);
  });

  it("keeps project thread files when the project document service fails", async () => {
    listProjectDocuments.mockRejectedValue(new Error("documents unavailable"));
    listProjectThreadFiles.mockResolvedValue({
      groups: [
        {
          thread_id: "thread-2",
          files: [
            {
              kind: "output",
              name: "summary.md",
              size_bytes: 40,
              modified_at: "2026-09-04T00:00:00Z",
              artifact_url: "/summary",
            },
          ],
        },
      ],
      next_offset: null,
      truncated: false,
    });

    const result = await loadProjectFilePage([
      {
        id: "project-2",
        name: "Design",
        status: "active",
        instructions: "",
        presentation: {},
        created_at: "",
        updated_at: "",
      },
    ]);

    expect(result.rows.map((row) => row.name)).toEqual(["summary.md"]);
    expect(result.failedProjectIds).toEqual(["project-2"]);
  });
});
