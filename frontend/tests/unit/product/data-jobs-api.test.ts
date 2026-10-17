import { beforeEach, describe, expect, it, rs } from "@rstest/core";

const mocks = rs.hoisted(() => ({ fetch: rs.fn() }));

rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));

import {
  cancelProductDataJob,
  createProductDataDeletion,
  createProductDataExport,
  downloadProductDataJobArtifact,
  fetchProductDataJobs,
  ProductDataJobsApiError,
} from "@/product/api";

const job = {
  job_id: "123e4567-e89b-12d3-a456-426614174000",
  kind: "export",
  scope: ["preferences"],
  status: "queued",
  progress: { stage: "queued", completed: 0, total: 0 },
  result: null,
  error_code: null,
  attempt: 0,
  max_attempts: 3,
  cancel_requested: false,
  request_id: null,
  created_at: "2026-09-28T09:00:00Z",
  updated_at: "2026-09-28T09:00:00Z",
} as const;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function jsonBody(init: RequestInit): unknown {
  if (typeof init.body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  return JSON.parse(init.body);
}

beforeEach(() => {
  mocks.fetch.mockReset();
});

describe("product preference data-job API", () => {
  it("submits scoped exports and explicit deletion ranges with idempotency", async () => {
    const threadJob = { ...job, scope: ["threads"] as ["threads"] };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: threadJob }),
    );
    await createProductDataExport("threads");
    const [exportUrl, exportInit] = mocks.fetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(exportUrl).toBe("/api/product/v1/data-exports");
    expect(exportInit.method).toBe("POST");
    expect(jsonBody(exportInit)).toEqual({ scope: ["threads"] });
    const exportHeaders = new Headers(exportInit.headers);
    expect(exportHeaders.get("Idempotency-Key")).toBeTruthy();

    mocks.fetch.mockResolvedValueOnce(jsonResponse({ api_version: 1, job }));
    await createProductDataExport();
    expect(jsonBody(mocks.fetch.mock.calls[1]?.[1] as RequestInit)).toEqual({
      scope: ["preferences"],
    });

    const projectJob = { ...job, scope: ["projects"] as ["projects"] };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: projectJob }),
    );
    await createProductDataExport("projects");
    expect(jsonBody(mocks.fetch.mock.calls[2]?.[1] as RequestInit)).toEqual({
      scope: ["projects"],
    });

    const scheduledTaskJob = {
      ...job,
      scope: ["scheduled_tasks"] as ["scheduled_tasks"],
    };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: scheduledTaskJob }),
    );
    await createProductDataExport("scheduled_tasks");
    expect(jsonBody(mocks.fetch.mock.calls[3]?.[1] as RequestInit)).toEqual({
      scope: ["scheduled_tasks"],
    });

    const agentsJob = { ...job, scope: ["agents"] as ["agents"] };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: agentsJob }),
    );
    await createProductDataExport("agents");
    expect(jsonBody(mocks.fetch.mock.calls[4]?.[1] as RequestInit)).toEqual({
      scope: ["agents"],
    });

    const memoryJob = { ...job, scope: ["memory"] as ["memory"] };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: memoryJob }),
    );
    await createProductDataExport("memory");
    expect(jsonBody(mocks.fetch.mock.calls[5]?.[1] as RequestInit)).toEqual({
      scope: ["memory"],
    });

    const filesJob = { ...job, scope: ["files"] as ["files"] };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: filesJob }),
    );
    await createProductDataExport("files");
    expect(jsonBody(mocks.fetch.mock.calls[6]?.[1] as RequestInit)).toEqual({
      scope: ["files"],
    });

    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: { ...job, kind: "deletion" } }),
    );
    await createProductDataDeletion();
    const [deleteUrl, deleteInit] = mocks.fetch.mock.calls[7] as [
      string,
      RequestInit,
    ];
    expect(deleteUrl).toBe("/api/product/v1/data-deletions");
    expect(jsonBody(deleteInit)).toEqual({
      scope: ["preferences"],
      confirmation: "DELETE PREFERENCES",
    });
    expect(new Headers(deleteInit.headers).get("Idempotency-Key")).toBeTruthy();

    const taskDeletionJob = {
      ...job,
      kind: "deletion" as const,
      scope: ["scheduled_tasks"] as ["scheduled_tasks"],
    };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: taskDeletionJob }),
    );
    await createProductDataDeletion("scheduled_tasks");
    expect(jsonBody(mocks.fetch.mock.calls[8]?.[1] as RequestInit)).toEqual({
      scope: ["scheduled_tasks"],
      confirmation: "DELETE SCHEDULED TASKS",
    });

    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        api_version: 1,
        job: { ...taskDeletionJob, scope: ["agents"] },
      }),
    );
    await createProductDataDeletion("agents");
    expect(jsonBody(mocks.fetch.mock.calls[9]?.[1] as RequestInit)).toEqual({
      scope: ["agents"],
      confirmation: "DELETE CUSTOM AGENTS",
    });

    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        api_version: 1,
        job: { ...taskDeletionJob, scope: ["threads"] },
      }),
    );
    await createProductDataDeletion("threads");
    expect(jsonBody(mocks.fetch.mock.calls[10]?.[1] as RequestInit)).toEqual({
      scope: ["threads"],
      confirmation: "DELETE THREAD HISTORY",
    });

    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        api_version: 1,
        job: { ...taskDeletionJob, scope: ["memory"] },
      }),
    );
    await createProductDataDeletion("memory");
    expect(jsonBody(mocks.fetch.mock.calls[11]?.[1] as RequestInit)).toEqual({
      scope: ["memory"],
      confirmation: "DELETE MY MEMORY",
    });

    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        api_version: 1,
        job: { ...taskDeletionJob, scope: ["projects"] },
      }),
    );
    await createProductDataDeletion("projects");
    expect(jsonBody(mocks.fetch.mock.calls[12]?.[1] as RequestInit)).toEqual({
      scope: ["projects"],
      confirmation: "DELETE MY PROJECTS",
    });

    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        api_version: 1,
        job: { ...taskDeletionJob, scope: ["files"] },
      }),
    );
    await createProductDataDeletion("files");
    expect(jsonBody(mocks.fetch.mock.calls[13]?.[1] as RequestInit)).toEqual({
      scope: ["files"],
      confirmation: "DELETE MY FILES",
    });

    const accountJob = { ...job, scope: ["account"] as ["account"] };
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: accountJob }),
    );
    await createProductDataExport("account");
    expect(jsonBody(mocks.fetch.mock.calls[14]?.[1] as RequestInit)).toEqual({
      scope: ["account"],
    });
  });

  it("preserves the HTTP status when the data-job route is unavailable", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ detail: "not enabled" }, 404),
    );

    let error: unknown;
    try {
      await fetchProductDataJobs();
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(ProductDataJobsApiError);
    expect((error as ProductDataJobsApiError).status).toBe(404);
  });

  it("reuses a caller-provided idempotency key when replaying a task request", async () => {
    const stableKey = "same-request-after-network-timeout";
    const threadJob = { ...job, scope: ["threads"] as ["threads"] };
    // 每次调用返回新的 Response：mockResolvedValue 复用同一实例会让第二
    // 次读取报 "Body has already been read"（真实 fetch 每次都给新响应）。
    mocks.fetch.mockImplementation(async () =>
      jsonResponse({ api_version: 1, job: threadJob }),
    );

    await createProductDataExport("threads", stableKey);
    await createProductDataExport("threads", stableKey);

    const exportKeys = mocks.fetch.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit).headers).get("Idempotency-Key"),
    );
    expect(exportKeys).toEqual([stableKey, stableKey]);

    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation(async () =>
      jsonResponse({
        api_version: 1,
        job: { ...threadJob, kind: "deletion" },
      }),
    );
    await createProductDataDeletion("threads", stableKey);
    await createProductDataDeletion("threads", stableKey);

    const deletionCalls = mocks.fetch.mock.calls;
    expect(
      deletionCalls.map(([, init]) =>
        new Headers((init as RequestInit).headers).get("Idempotency-Key"),
      ),
    ).toEqual([stableKey, stableKey]);
    expect(
      deletionCalls.map(([, init]) => jsonBody(init as RequestInit)),
    ).toEqual([
      { scope: ["threads"], confirmation: "DELETE THREAD HISTORY" },
      { scope: ["threads"], confirmation: "DELETE THREAD HISTORY" },
    ]);
  });

  it("keeps reads, cancellation, and downloads on owner-checked product routes", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        api_version: 1,
        jobs: [job],
        limit: 20,
        offset: 0,
        has_more: true,
      }),
    );
    await fetchProductDataJobs(20, 0);
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe(
      "/api/product/v1/data-jobs?limit=20&offset=0",
    );

    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: { ...job, status: "cancelled" } }),
    );
    await cancelProductDataJob(job.job_id);
    expect(mocks.fetch.mock.calls[1]?.[0]).toBe(
      `/api/product/v1/data-jobs/${job.job_id}/cancel`,
    );
    expect((mocks.fetch.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");

    const artifact = new Blob(["preferences"]);
    mocks.fetch.mockResolvedValueOnce(new Response(artifact, { status: 200 }));
    const controller = new AbortController();
    expect(
      await downloadProductDataJobArtifact(job.job_id, controller.signal),
    ).toBeInstanceOf(Blob);
    expect(mocks.fetch.mock.calls[2]?.[0]).toBe(
      `/api/product/v1/data-jobs/${job.job_id}/artifact`,
    );
    expect((mocks.fetch.mock.calls[2]?.[1] as RequestInit).signal).toBe(
      controller.signal,
    );
  });

  it("accepts an account bundle in the export job feed", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        api_version: 1,
        jobs: [{ ...job, scope: ["account"] }],
        limit: 20,
        offset: 0,
      }),
    );
    const page = await fetchProductDataJobs();
    expect(page.jobs[0]?.scope).toEqual(["account"]);
  });

  it("rejects an unexpected job response rather than trusting API JSON", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ api_version: 1, job: { ...job, scope: ["unknown"] } }),
    );
    await expect(createProductDataExport("threads")).rejects.toThrow(
      "unsupported response",
    );
  });
});
