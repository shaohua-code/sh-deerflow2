import { describe, expect, it } from "@rstest/core";

import {
  getVisibleProductNavigation,
  productNavigation,
} from "@/product/navigation";

/** IAM 侧登记的全部菜单码（与 productNavigation.iamMenuCode 一一对应）。 */
const ALL_MENU_CODES = productNavigation.map((item) => item.iamMenuCode);

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

    // 菜单未受控（null）时只按产品展示开关过滤。
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
      null,
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
      null,
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
      null,
    ).find((item) => item.id === "agents");

    expect(agent?.gatewayCapability).toBe("agents");
    expect(agent?.isActive).toBe(true);
  });

  it("shows every entry when the IAM control is unavailable", () => {
    // null = 未受控（请求失败 / 纯本地账号 / IAM 明示不受控）：
    // 菜单管控降级为全量显示，不能因为 IAM 抖动吞掉整个侧栏。
    const visible = getVisibleProductNavigation(
      { chats: true, agents: true, scheduled_tasks: true },
      "/workspace",
      null,
    );
    const visibleIds = visible.map((item) => item.id);
    expect(visibleIds).toEqual(
      expect.arrayContaining(["chats", "agents", "scheduledTasks"]),
    );
  });

  it("renders nothing while the IAM control is still resolving", () => {
    // undefined = 解析中：未授权菜单不能先全量闪现再收起，等结果出来再渲染。
    const visible = getVisibleProductNavigation(
      { chats: true, agents: true, scheduled_tasks: true },
      "/workspace",
      undefined,
    );
    expect(visible).toEqual([]);
  });

  it("hides only the menus the IAM resource tree did not grant", () => {
    // IAM 勾选里没有 agents：智能体入口隐藏，其余照常。
    const visible = getVisibleProductNavigation(
      { chats: true, agents: true, scheduled_tasks: true },
      "/workspace",
      {
        menus: ALL_MENU_CODES.filter((code) => code !== "deerflow.agents"),
        buttons: [],
      },
    );
    const visibleIds = visible.map((item) => item.id);
    expect(visibleIds).not.toContain("agents");
    expect(visibleIds).toEqual(
      expect.arrayContaining(["chats", "scheduledTasks"]),
    );
  });

  it("keeps every granted menu visible and active with full IAM grants", () => {
    const visible = getVisibleProductNavigation(
      { chats: true, agents: true, scheduled_tasks: true, files: true },
      "/workspace/files",
      { menus: ALL_MENU_CODES, buttons: [] },
    );

    expect(visible.map((item) => item.id)).toEqual([
      "overview",
      "chats",
      "agents",
      "scheduledTasks",
      "files",
      "capabilities",
    ]);
    expect(visible.find((item) => item.id === "files")?.isActive).toBe(true);
  });

  it("keeps the IAM menu code list aligned with the directory", () => {
    // 每个导航项必须带唯一的 IAM 菜单码，否则资源树勾选无法对应侧栏入口。
    const codes = productNavigation.map((item) => item.iamMenuCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([
      "deerflow.overview",
      "deerflow.chats",
      "deerflow.agents",
      "deerflow.scheduled-tasks",
      "deerflow.files",
      "deerflow.capabilities",
    ]);
  });
});
