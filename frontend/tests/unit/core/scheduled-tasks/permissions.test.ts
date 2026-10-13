import { describe, expect, it } from "@rstest/core";

import { getScheduledTaskPermissionAccess } from "@/core/scheduled-tasks/permissions";

describe("scheduled-task route permission mapping", () => {
  it("maps read, mutation, deletion, agent, and run-history routes", () => {
    const access = getScheduledTaskPermissionAccess({
      permissions: [
        "threads:read",
        "threads:write",
        "runs:create",
        "runs:read",
        "agents:read",
      ],
    });

    expect(access.canReadTasks).toBe(true);
    expect(access.canReadRunHistory).toBe(true);
    expect(access.canCreateTask).toBe(true);
    expect(access.canUpdateTask).toBe(true);
    expect(access.canPauseTask).toBe(true);
    expect(access.canResumeTask).toBe(true);
    expect(access.canTriggerTask).toBe(true);
    expect(access.canDeleteTask).toBe(false);
    expect(access.canReadAgents).toBe(true);
    expect(access.canReuseThread).toBe(true);
  });

  it("keeps pause independent from run creation and blocks other run mutations", () => {
    const access = getScheduledTaskPermissionAccess({
      permissions: ["threads:read", "threads:write", "runs:read"],
    });

    expect(access.canPauseTask).toBe(true);
    expect(access.canCreateTask).toBe(false);
    expect(access.canUpdateTask).toBe(false);
    expect(access.canResumeTask).toBe(false);
    expect(access.canTriggerTask).toBe(false);
    expect(access.canReadRunHistory).toBe(true);
    expect(access.canReadAgents).toBe(false);
  });

  it("preserves older Gateway behavior while permissions are unresolved", () => {
    const access = getScheduledTaskPermissionAccess({ permissions: null });

    expect(access.canReadTasks).toBe(true);
    expect(access.canReadRunHistory).toBe(true);
    expect(access.canCreateTask).toBe(true);
    expect(access.canDeleteTask).toBe(true);
    expect(access.canReadAgents).toBe(true);
  });
});
