import { beforeEach, describe, expect, it, rs } from "@rstest/core";

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
}));

rs.mock("@/core/config", () => ({
  getBackendBaseURL: () => "/backend",
}));

import { fetch as fetcher } from "@/core/api/fetcher";
import {
  archiveProject,
  getProject,
  patchProject,
  ProjectAPIError,
} from "@/core/projects/api";

const mockedFetch = rs.mocked(fetcher);

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("getProject error status", () => {
  it("preserves 404 so the page can distinguish a missing project", async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Project not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await getProject("project-1").catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ProjectAPIError);
    expect(error).toMatchObject({ status: 404, message: "Project not found" });
  });

  it("preserves temporary Gateway statuses instead of treating them as 404", async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Gateway unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await getProject("project-1").catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ProjectAPIError);
    expect(error).toMatchObject({
      status: 503,
      message: "Gateway unavailable",
    });
  });
});

describe("project mutation error status", () => {
  it("preserves a 422 from the configured instructions limit", async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: "instructions exceeds the configured limit" }),
        {
          status: 422,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const error = await patchProject("project-1", {
      instructions: "too long",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ProjectAPIError);
    expect(error).toMatchObject({ status: 422 });
  });

  it("preserves archive failures for diagnostics without changing the API contract", async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "private gateway details" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await archiveProject("project-1").catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ProjectAPIError);
    expect(error).toMatchObject({
      status: 503,
      message: "private gateway details",
    });
  });
});
