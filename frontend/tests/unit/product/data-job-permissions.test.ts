import { describe, expect, it } from "@rstest/core";

import { getDataJobRequiredPermissions } from "@/product/data-job-permissions";

describe("data job route permission mapping", () => {
  it("requires every read permission for combined account exports", () => {
    expect(getDataJobRequiredPermissions("export", "account")).toEqual([
      "preferences:read",
      "threads:read",
      "runs:read",
      "projects:read",
      "agents:read",
      "memory:read",
    ]);
  });

  it("covers both sources when exporting or deleting files", () => {
    expect(getDataJobRequiredPermissions("export", "files")).toEqual([
      "threads:read",
      "projects:read",
    ]);
    expect(getDataJobRequiredPermissions("deletion", "files")).toEqual([
      "threads:delete",
      "projects:delete",
    ]);
  });

  it("uses Gateway scheduled-task grants and fails closed for unknown scopes", () => {
    expect(
      getDataJobRequiredPermissions("deletion", "scheduled_tasks"),
    ).toEqual(["threads:delete"]);
    expect(getDataJobRequiredPermissions("export", "future_scope")).toBeNull();
  });
});
