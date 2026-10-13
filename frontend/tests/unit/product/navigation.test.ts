import { describe, expect, it } from "@rstest/core";

import {
  getVisibleProductNavigation,
  productNavigation,
} from "@/product/navigation";

describe("product workspace navigation", () => {
  it("keeps product routes in one directory and hides only disabled entries", () => {
    expect(productNavigation.map((item) => item.id)).toEqual([
      "overview",
      "chats",
      "agents",
      "scheduledTasks",
      "files",
      "capabilities",
    ]);

    const visible = getVisibleProductNavigation(
      {
        overview: true,
        chats: false,
        agents: true,
        scheduled_tasks: false,
        files: true,
        capabilities: false,
      },
      "/workspace",
    );

    expect(visible.map((item) => item.id)).toEqual([
      "overview",
      "agents",
      "files",
    ]);
  });

  it("matches detail pages without making the overview active for nested routes", () => {
    const agentPage = getVisibleProductNavigation(
      { overview: true, agents: true },
      "/workspace/agents/researcher",
    );

    expect(agentPage.find((item) => item.id === "agents")?.isActive).toBe(true);
    expect(agentPage.find((item) => item.id === "overview")?.isActive).toBe(
      false,
    );
  });

  it("keeps the Agent capability separate from the product display switch", () => {
    const agent = getVisibleProductNavigation(
      { agents: true },
      "/workspace/agents",
    ).find((item) => item.id === "agents");

    expect(agent?.gatewayCapability).toBe("agents");
    expect(agent?.isActive).toBe(true);
  });

  it("hides Agents only when the resolved route permissions explicitly deny access", () => {
    expect(
      getVisibleProductNavigation({ agents: true }, "/workspace/agents", {
        permissions: ["threads:read"],
      }),
    ).toHaveLength(0);

    expect(
      getVisibleProductNavigation({ agents: true }, "/workspace/agents", {
        permissions: null,
      }).map((item) => item.id),
    ).toEqual(["agents"]);
  });

  it("uses route permission groups for chats and scheduled tasks independently", () => {
    const visible = getVisibleProductNavigation(
      { chats: true, agents: true, scheduled_tasks: true },
      "/workspace/chats",
      { permissions: ["agents:read"] },
    );

    expect(visible.map((item) => item.id)).toEqual(["agents"]);

    const threadsAllowed = getVisibleProductNavigation(
      { chats: true, agents: true, scheduled_tasks: true },
      "/workspace/scheduled-tasks",
      { permissions: ["threads:read"] },
    );

    expect(threadsAllowed.map((item) => item.id)).toEqual([
      "chats",
      "scheduledTasks",
    ]);
    expect(
      threadsAllowed.find((item) => item.id === "scheduledTasks")?.isActive,
    ).toBe(true);

    const createOnly = getVisibleProductNavigation(
      { chats: true, scheduled_tasks: true },
      "/workspace/scheduled-tasks",
      { permissions: ["threads:write", "runs:create"] },
    );
    expect(createOnly.map((item) => item.id)).toEqual(["scheduledTasks"]);

    const noTaskAccess = getVisibleProductNavigation(
      { scheduled_tasks: true },
      "/workspace/scheduled-tasks",
      { permissions: ["threads:write", "runs:read"] },
    );
    expect(noTaskAccess).toEqual([]);
  });

  it("keeps read-protected entries visible while permissions are unresolved", () => {
    expect(
      getVisibleProductNavigation(
        { chats: true, agents: true, scheduled_tasks: true },
        "/workspace",
        { permissions: null },
      ).map((item) => item.id),
    ).toEqual(["chats", "agents", "scheduledTasks"]);
  });

  it("requires both verified read permissions before showing the file center", () => {
    expect(
      getVisibleProductNavigation({ files: true }, "/workspace/files", {
        permissions: ["threads:read"],
      }),
    ).toHaveLength(0);

    const files = getVisibleProductNavigation(
      { files: true },
      "/workspace/files",
      { permissions: ["threads:read", "projects:read"] },
    );

    expect(files.map((item) => item.id)).toEqual(["files"]);
    expect(files[0]?.isActive).toBe(true);
  });
});
