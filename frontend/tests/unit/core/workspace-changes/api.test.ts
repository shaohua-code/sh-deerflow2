import { afterEach, expect, test, rs } from "@rstest/core";

afterEach(() => {
  rs.unstubAllGlobals();
});

test("fetchWorkspaceChanges can request file metadata without diffs", async () => {
  let requestedUrl = "";
  const fetchMock = rs.fn(async (input: RequestInfo | URL) => {
    if (typeof input === "string") {
      requestedUrl = input;
    } else if (input instanceof URL) {
      requestedUrl = input.toString();
    } else {
      requestedUrl = input.url;
    }
    return new Response(
      JSON.stringify({
        available: true,
        version: 1,
        summary: {
          created: 1,
          modified: 0,
          deleted: 0,
          additions: 1,
          deletions: 0,
          truncated: false,
        },
        files: [],
        limits: {},
      }),
      { status: 200 },
    );
  });
  rs.stubGlobal("fetch", fetchMock);

  const { fetchWorkspaceChanges } =
    await import("@/core/workspace-changes/api");

  await fetchWorkspaceChanges({
    threadId: "thread-1",
    runId: "run-1",
    includeFiles: true,
    includeDiff: false,
  });

  const url = new URL(requestedUrl, "http://localhost");
  expect(url.searchParams.get("include_files")).toBe("true");
  expect(url.searchParams.get("include_diff")).toBe("false");
  expect(fetchMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ credentials: "include" }),
  );
});

test("fetchWorkspaceChanges forwards its cancellation signal", async () => {
  let requestInit: RequestInit | undefined;
  const fetchMock = rs.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init;
      return new Response(
        JSON.stringify({
          available: true,
          version: 1,
          summary: {
            created: 0,
            modified: 0,
            deleted: 0,
            symlink_created: 0,
            additions: 0,
            deletions: 0,
            truncated: false,
          },
          files: [],
          limits: {},
        }),
        { status: 200 },
      );
    },
  );
  rs.stubGlobal("fetch", fetchMock);
  const { fetchWorkspaceChanges } =
    await import("@/core/workspace-changes/api");
  const signal = new AbortController().signal;

  await fetchWorkspaceChanges({
    threadId: "thread-1",
    runId: "run-1",
    signal,
  });

  expect(requestInit?.signal).toBe(signal);
});
