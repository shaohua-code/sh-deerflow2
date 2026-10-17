import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type AnchorHTMLAttributes, type ReactNode } from "react";

const mocks = rs.hoisted(() => ({
  agentsApiEnabled: false,
  agentsCapabilityError: false,
  agentsCapabilityLoading: false,
  features: { chats: true, agents: true, capabilities: false, files: false },
  fetchProductFiles: rs.fn(),
  listAgents: rs.fn(),
  searchThreads: rs.fn(),
  recentThreads: [] as unknown[],
  staticMode: false,
  failRecentThreads: false,
  failBusyThreads: false,
}));
const authState = rs.hoisted(() => ({
  userId: "user-a" as string | null,
  permissions: null as string[] | null,
}));

rs.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
rs.mock("@/components/workspace/workspace-container", () => ({
  WorkspaceContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  WorkspaceBody: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  WorkspaceHeader: () => null,
}));
rs.mock("@/core/agents", () => ({
  useAgentsApiEnabled: () => ({
    enabled: mocks.agentsApiEnabled,
    isError: mocks.agentsCapabilityError,
    isLoading: mocks.agentsCapabilityLoading,
  }),
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user:
      authState.userId === null
        ? null
        : { id: authState.userId, permissions: authState.permissions },
  }),
}));
rs.mock("@/core/static-mode", () => ({
  isStaticWebsiteOnly: () => mocks.staticMode,
}));
rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: { capabilities: { title: "能力中心", description: "可用能力" } },
  }),
}));
rs.mock("@/core/threads/api", () => ({
  branchThreadFromTurn: rs.fn(),
  fetchThreadTokenUsage: rs.fn(),
  moveThreadToProject: rs.fn(),
  patchThreadMetadata: rs.fn(),
  searchThreads: (...args: unknown[]) => mocks.searchThreads(...args),
  searchThreadsByArchive: (args: unknown) => mocks.searchThreads(args),
}));
rs.mock("@/core/agents/api", () => ({
  listAgents: (...args: unknown[]) => mocks.listAgents(...args),
}));
rs.mock("@/product/hooks", () => ({
  useProductBootstrap: () => ({ data: { features: mocks.features } }),
  useProductBrandName: () => "Flow Desk",
}));
rs.mock("@/product/api", () => ({
  fetchProductFiles: (...args: unknown[]) => mocks.fetchProductFiles(...args),
}));

import { infiniteThreadsQueryKey } from "@/core/threads/hooks";
import { workspaceRecentThreadListParams } from "@/core/threads/workspace-thread-list";
import { WorkspaceHome } from "@/product/workspace-home";

function recentThreadQueryKey(userId: string) {
  return infiniteThreadsQueryKey(userId, workspaceRecentThreadListParams());
}

const recentFile = {
  file_id: "thread-upload:thread-a:report.pdf",
  source: "thread_upload",
  name: "report.pdf",
  size_bytes: 2048,
  artifact_url: "/api/threads/thread-a/uploads/report.pdf",
  modified_at: "2026-10-08T12:00:00Z",
  storage_name: "report.pdf",
  thread_id: "thread-a",
  thread_name: "季度报告对话",
  project_id: null,
  project_name: null,
  document_id: null,
};

function recentFilePage() {
  return {
    api_version: 1,
    files: [recentFile],
    total: 1,
    limit: 5,
    offset: 0,
    has_more: false,
    next_offset: null,
    truncated: false,
    failed_count: 0,
    coverage_notes: [],
  };
}

function renderHome(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  const result = render(
    <QueryClientProvider client={client}>
      <WorkspaceHome />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  mocks.agentsApiEnabled = false;
  mocks.agentsCapabilityError = false;
  mocks.agentsCapabilityLoading = false;
  mocks.recentThreads = [];
  mocks.features = {
    chats: true,
    agents: true,
    capabilities: false,
    files: false,
  };
  mocks.failRecentThreads = false;
  mocks.failBusyThreads = false;
  authState.userId = "user-a";
  authState.permissions = null;
  mocks.searchThreads
    .mockReset()
    .mockImplementation(async (params: { status?: string }) => {
      if (params.status === "busy") {
        if (mocks.failBusyThreads) throw new Error("offline");
        return [];
      }
      if (mocks.failRecentThreads) throw new Error("offline");
      return mocks.recentThreads;
    });
  mocks.listAgents.mockReset().mockResolvedValue([]);
  mocks.fetchProductFiles.mockReset();
  mocks.fetchProductFiles.mockResolvedValue(recentFilePage());
  mocks.staticMode = false;
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("WorkspaceHome feature entry cards", () => {
  it("hides the agent card when Gateway reports the API as disabled", () => {
    mocks.agentsApiEnabled = false;

    renderHome();

    expect(screen.queryByRole("link", { name: /浏览智能体/ })).toBeNull();
    expect(screen.getByRole("link", { name: /查看对话/ })).toBeDefined();
    expect(mocks.listAgents).not.toHaveBeenCalled();
  });

  it("shows the agent card when both product and Gateway switches allow it", () => {
    mocks.agentsApiEnabled = true;

    renderHome();

    expect(screen.getByRole("link", { name: /浏览智能体/ })).toBeDefined();
  });

  it("links to the retry page when availability is unknown without fetching agents", () => {
    mocks.agentsApiEnabled = false;
    mocks.agentsCapabilityError = true;

    renderHome();

    const link = screen.getByRole("link", { name: /浏览智能体/ });
    expect(link.getAttribute("href")).toBe("/workspace/agents");
    expect(link.textContent).toContain("暂时无法确认智能体状态");
    expect(mocks.listAgents).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "常用智能体" })).toBeNull();
  });

  it("does not fetch the agent directory before availability is checked", () => {
    mocks.agentsApiEnabled = true;
    mocks.agentsCapabilityLoading = true;

    renderHome();

    expect(
      screen.getByRole("link", { name: /浏览智能体.*正在确认智能体是否可用/ }),
    ).toBeDefined();
    expect(mocks.listAgents).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "常用智能体" })).toBeNull();
  });

  it("keeps the agent card hidden when the product switch is disabled", () => {
    mocks.agentsApiEnabled = true;
    mocks.agentsCapabilityError = true;
    mocks.features = { ...mocks.features, agents: false };

    renderHome();

    expect(screen.queryByRole("link", { name: /浏览智能体/ })).toBeNull();
  });

  it("omits the quick-entry region when every product entry is disabled", () => {
    mocks.agentsApiEnabled = false;
    mocks.features = {
      chats: false,
      agents: false,
      capabilities: false,
      files: false,
    };

    renderHome();

    expect(screen.queryByRole("region", { name: "工作总览" })).toBeNull();
  });

  it("shows a small recent-file list through the Gateway owner-checked URL", async () => {
    mocks.features = { ...mocks.features, files: true };

    renderHome();

    const fileLink = await screen.findByRole("link", {
      name: "打开文件: report.pdf",
    });
    expect(fileLink.getAttribute("href")).toBe(
      "/api/threads/thread-a/uploads/report.pdf",
    );
    expect(screen.getByRole("heading", { name: "最近文件" })).toBeDefined();
    expect(mocks.fetchProductFiles.mock.calls[0]?.slice(0, 3)).toEqual([
      5,
      0,
      "",
    ]);
    expect(mocks.fetchProductFiles.mock.calls[0]?.[3]).toBeDefined();
  });

  it("does not fetch personal files for a static demo", () => {
    mocks.features = { ...mocks.features, files: true };
    mocks.staticMode = true;

    renderHome();

    expect(screen.getByText(/公开演示不会加载个人文件/)).toBeDefined();
    expect(mocks.fetchProductFiles).not.toHaveBeenCalled();
  });

  it("shows a retry when the recent-file catalog cannot load", async () => {
    mocks.features = { ...mocks.features, files: true };
    mocks.fetchProductFiles
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(recentFilePage());

    renderHome();

    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(
      await screen.findByRole("link", { name: "打开文件: report.pdf" }),
    ).toBeDefined();
    await waitFor(() =>
      expect(mocks.fetchProductFiles).toHaveBeenCalledTimes(2),
    );
  });

  it("keeps the last file list visible and offers retry after refresh fails", async () => {
    mocks.features = { ...mocks.features, files: true };
    mocks.fetchProductFiles
      .mockResolvedValueOnce(recentFilePage())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(recentFilePage());

    const { client } = renderHome();
    const fileLink = await screen.findByRole("link", {
      name: "打开文件: report.pdf",
    });

    await client.invalidateQueries({
      queryKey: ["product", "dashboard-files", "user-a"],
    });

    expect(
      await screen.findByText("最近文件刷新失败，当前显示的是上次加载的列表。"),
    ).toBeDefined();
    expect(fileLink.isConnected).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(mocks.fetchProductFiles).toHaveBeenCalledTimes(3),
    );
    expect(
      screen.queryByText("最近文件刷新失败，当前显示的是上次加载的列表。"),
    ).toBeNull();
  });

  it("explains incomplete coverage when the partial scan has no files", async () => {
    mocks.features = { ...mocks.features, files: true };
    mocks.fetchProductFiles.mockResolvedValue({
      ...recentFilePage(),
      files: [],
      total: 0,
      truncated: true,
    });

    renderHome();

    expect(
      await screen.findByText(/部分文件来源不可用或扫描已达到上限/),
    ).toBeDefined();
  });

  it("shows Gateway-reported active conversations with owner-scoped links", async () => {
    mocks.searchThreads.mockImplementation(
      async (params: { status?: string }) =>
        params.status === "busy"
          ? [
              {
                thread_id: "busy-thread",
                status: "busy",
                updated_at: "2026-10-09T10:00:00Z",
                values: { title: "正在整理项目资料" },
                metadata: { agent_name: "research" },
              },
            ]
          : [],
    );

    const { client } = renderHome();

    const activeLink = await screen.findByRole("link", {
      name: "智能体正在执行: 正在整理项目资料",
    });
    expect(activeLink.getAttribute("href")).toBe(
      "/workspace/agents/research/chats/busy-thread",
    );
    expect(
      mocks.searchThreads.mock.calls.some(
        ([params]) => params.status === "busy" && params.limit === 5,
      ),
    ).toBe(true);
    expect(
      client.getQueryCache().find({
        queryKey: ["product", "dashboard-active-threads", "user-a"],
      }),
    ).toBeDefined();
  });

  it("keeps cached recent conversations visible when a refresh fails", async () => {
    mocks.recentThreads = [
      {
        thread_id: "recent-a",
        values: { title: "上次读取的对话" },
      },
    ];

    const { client } = renderHome();
    const cachedThread = await screen.findByRole("link", {
      name: /上次读取的对话/,
    });
    mocks.failRecentThreads = true;

    await client.invalidateQueries({
      queryKey: recentThreadQueryKey("user-a"),
    });

    expect(
      await screen.findByText("最近对话刷新失败，当前显示的是上次加载的内容。"),
    ).toBeDefined();
    expect(cachedThread.isConnected).toBe(true);
  });

  it("keeps cached active tasks visible when a refresh fails", async () => {
    mocks.searchThreads.mockImplementation(
      async (params: { status?: string }) => {
        if (params.status === "busy") {
          if (mocks.failBusyThreads) throw new Error("offline");
          return [
            {
              thread_id: "busy-thread",
              status: "busy",
              values: { title: "缓存中的运行任务" },
            },
          ];
        }
        return [];
      },
    );

    const { client } = renderHome();
    const cachedTask = await screen.findByRole("link", {
      name: "智能体正在执行: 缓存中的运行任务",
    });
    mocks.failBusyThreads = true;

    await client.invalidateQueries({
      queryKey: ["product", "dashboard-active-threads", "user-a"],
    });

    expect(
      await screen.findByText("任务状态刷新失败，当前显示的是上次读取的结果。"),
    ).toBeDefined();
    expect(cachedTask.isConnected).toBe(true);
  });

  it("ranks custom Agent shortcuts and keeps them visible after refresh failure", async () => {
    mocks.agentsApiEnabled = true;
    mocks.recentThreads = [
      { thread_id: "r1", metadata: { agent_name: "research" } },
      { thread_id: "r2", metadata: { agent_name: "research" } },
      { thread_id: "r3", metadata: { agent_name: "research" } },
      { thread_id: "w1", metadata: { agent_name: "writer" } },
    ];
    mocks.listAgents.mockResolvedValue([
      { name: "writer", display_name: "写作助手", description: "整理文字" },
      { name: "research", display_name: "研究助手", description: "分析资料" },
    ]);

    const { client } = renderHome();

    expect(
      await screen.findByRole("heading", { name: "常用智能体" }),
    ).toBeDefined();
    await waitFor(() =>
      expect(
        client.getQueryCache().find({
          queryKey: ["product", "dashboard-agents", "user-a"],
        }),
      ).toBeDefined(),
    );
    const customAgentLinks = screen
      .getAllByRole("link")
      .filter((link) =>
        link
          .getAttribute("href")
          ?.match(/^\/workspace\/agents\/[^/]+\/chats\/new$/),
      );
    expect(customAgentLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/workspace/agents/research/chats/new",
      "/workspace/agents/writer/chats/new",
    ]);
    expect(screen.getByText("近 3 个对话使用")).toBeDefined();
    expect(screen.getByText("近 1 个对话使用")).toBeDefined();

    const cachedResearchAgent = customAgentLinks[0];
    mocks.listAgents.mockRejectedValue(new Error("offline"));
    await client.invalidateQueries({
      queryKey: ["product", "dashboard-agents", "user-a"],
    });

    expect(
      await screen.findByText(
        "智能体列表刷新失败，当前显示的是上次加载的内容。",
      ),
    ).toBeDefined();
    expect(cachedResearchAgent?.isConnected).toBe(true);
  });

  it("keeps personal task and Agent queries disabled in a static demo", () => {
    mocks.staticMode = true;
    mocks.agentsApiEnabled = true;

    renderHome();

    expect(mocks.listAgents).not.toHaveBeenCalled();
    expect(
      mocks.searchThreads.mock.calls.some(
        ([params]) => params.status === "busy",
      ),
    ).toBe(false);
    expect(
      screen.getByText("公开演示不会加载个人任务的实时状态。"),
    ).toBeDefined();
  });
});

describe("WorkspaceHome route permissions", () => {
  it("stops thread and file reads and clears their cached data after access is denied", async () => {
    authState.permissions = ["agents:read", "runs:create"];
    mocks.features = { ...mocks.features, files: true };
    mocks.agentsApiEnabled = true;

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const threadKey = recentThreadQueryKey("user-a");
    const activeTaskKey = ["product", "dashboard-active-threads", "user-a"];
    const otherThreadKey = recentThreadQueryKey("user-b");
    const otherActiveKey = ["product", "dashboard-active-threads", "user-b"];
    const fileKey = ["product", "dashboard-files", "user-a"];
    const otherFileKey = ["product", "dashboard-files", "user-b"];
    client.setQueryData(threadKey, {
      pages: [
        [{ thread_id: "old-thread", values: { title: "撤权后的旧对话" } }],
      ],
      pageParams: [0],
    });
    client.setQueryData(activeTaskKey, [
      { thread_id: "old-task", values: { title: "撤权后的旧任务" } },
    ]);
    client.setQueryData(otherThreadKey, {
      pages: [
        [{ thread_id: "other-thread", values: { title: "其他账号对话" } }],
      ],
      pageParams: [0],
    });
    client.setQueryData(otherActiveKey, [
      { thread_id: "other-task", values: { title: "其他账号任务" } },
    ]);
    client.setQueryData(fileKey, recentFilePage());
    client.setQueryData(otherFileKey, recentFilePage());

    const { client: renderedClient } = renderHome(client);

    expect(screen.queryByRole("heading", { name: "最近的工作" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "执行中的任务" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "最近文件" })).toBeNull();
    expect(screen.queryByText("撤权后的旧对话")).toBeNull();
    expect(screen.queryByText("撤权后的旧任务")).toBeNull();
    expect(screen.queryByText("report.pdf")).toBeNull();
    expect(screen.queryByRole("link", { name: /查看对话/ })).toBeNull();
    expect(mocks.searchThreads).not.toHaveBeenCalled();
    expect(mocks.fetchProductFiles).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(renderedClient.getQueryData(threadKey)).toBeUndefined();
      expect(renderedClient.getQueryData(activeTaskKey)).toBeUndefined();
      expect(renderedClient.getQueryData(fileKey)).toBeUndefined();
    });
    expect(renderedClient.getQueryData(otherThreadKey)).toEqual({
      pages: [
        [{ thread_id: "other-thread", values: { title: "其他账号对话" } }],
      ],
      pageParams: [0],
    });
    expect(renderedClient.getQueryData(otherActiveKey)).toEqual([
      { thread_id: "other-task", values: { title: "其他账号任务" } },
    ]);
    expect(renderedClient.getQueryData(otherFileKey)).toEqual(recentFilePage());
  });

  it("still fetches recent and active threads when permissions are unresolved", async () => {
    authState.permissions = null;

    renderHome();

    await waitFor(() => expect(mocks.searchThreads).toHaveBeenCalled());
    const calls = mocks.searchThreads.mock.calls.map(
      (call) => call[0] as { status?: string; signal?: AbortSignal },
    );
    expect(calls.filter((params) => params.status === undefined)).toHaveLength(
      1,
    );
    expect(calls.some((params) => params.status === "busy")).toBe(true);
    expect(calls.every((params) => params.signal instanceof AbortSignal)).toBe(
      true,
    );
  });

  it("aborts in-flight dashboard thread searches when threads:read is revoked", async () => {
    const signals: AbortSignal[] = [];
    authState.permissions = ["threads:read"];
    mocks.searchThreads.mockImplementation(
      (params: { signal?: AbortSignal }) => {
        if (params.signal) signals.push(params.signal);
        return new Promise((_resolve, reject) => {
          params.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      },
    );
    const { rerender, client } = renderHome();

    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    expect(signals.every((signal) => signal.aborted)).toBe(false);
    authState.permissions = [];
    rerender(
      <QueryClientProvider client={client}>
        <WorkspaceHome />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(signals.every((signal) => signal.aborted)).toBe(true),
    );
    expect(screen.queryByRole("heading", { name: "最近的工作" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "执行中的任务" })).toBeNull();
  });

  it("hides dashboard threads when chats are disabled without removing the owner cache", () => {
    authState.permissions = ["threads:read"];
    mocks.features = { ...mocks.features, chats: false };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const threadKey = recentThreadQueryKey("user-a");
    const activeTaskKey = ["product", "dashboard-active-threads", "user-a"];
    client.setQueryData(threadKey, {
      pages: [[{ thread_id: "kept-thread", values: { title: "保留的对话" } }]],
      pageParams: [0],
    });
    client.setQueryData(activeTaskKey, [
      { thread_id: "kept-task", values: { title: "保留的任务" } },
    ]);

    const { client: renderedClient } = renderHome(client);

    expect(screen.queryByRole("heading", { name: "最近的工作" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "执行中的任务" })).toBeNull();
    expect(screen.queryByText("保留的对话")).toBeNull();
    expect(renderedClient.getQueryData(threadKey)).toEqual({
      pages: [[{ thread_id: "kept-thread", values: { title: "保留的对话" } }]],
      pageParams: [0],
    });
    expect(renderedClient.getQueryData(activeTaskKey)).toEqual([
      { thread_id: "kept-task", values: { title: "保留的任务" } },
    ]);
    expect(mocks.searchThreads).not.toHaveBeenCalled();
  });

  it("still fetches recent files when permissions are unresolved", async () => {
    authState.permissions = null;
    mocks.features = { ...mocks.features, files: true };

    renderHome();

    await waitFor(() => expect(mocks.fetchProductFiles).toHaveBeenCalled());
    const signal = mocks.fetchProductFiles.mock.calls[0]?.[3];
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("hides recent files and clears only this owner when projects:read is denied", async () => {
    authState.permissions = ["threads:read", "agents:read", "runs:create"];
    mocks.features = { ...mocks.features, files: true };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fileKey = ["product", "dashboard-files", "user-a"];
    const otherFileKey = ["product", "dashboard-files", "user-b"];
    client.setQueryData(fileKey, recentFilePage());
    client.setQueryData(otherFileKey, recentFilePage());

    const { client: renderedClient } = renderHome(client);

    expect(screen.queryByRole("heading", { name: "最近文件" })).toBeNull();
    expect(screen.queryByText("report.pdf")).toBeNull();
    expect(mocks.fetchProductFiles).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(renderedClient.getQueryData(fileKey)).toBeUndefined();
    });
    expect(renderedClient.getQueryData(otherFileKey)).toEqual(recentFilePage());
  });

  it("aborts an in-flight recent-file read when a required grant is revoked", async () => {
    const signals: AbortSignal[] = [];
    authState.permissions = ["threads:read", "projects:read"];
    mocks.features = { ...mocks.features, files: true };
    mocks.fetchProductFiles.mockImplementation(
      (
        _limit: number,
        _offset: number,
        _query: string,
        signal?: AbortSignal,
      ) => {
        if (signal) signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      },
    );
    const { rerender, client } = renderHome();

    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    expect(signals.every((signal) => signal.aborted)).toBe(false);
    authState.permissions = ["threads:read"];
    rerender(
      <QueryClientProvider client={client}>
        <WorkspaceHome />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(signals.every((signal) => signal.aborted)).toBe(true),
    );
    expect(screen.queryByRole("heading", { name: "最近文件" })).toBeNull();
  });

  it("hides recent files when the files switch is off without removing the owner cache", () => {
    authState.permissions = ["threads:read", "projects:read"];
    mocks.features = { ...mocks.features, files: false };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fileKey = ["product", "dashboard-files", "user-a"];
    client.setQueryData(fileKey, recentFilePage());

    const { client: renderedClient } = renderHome(client);

    expect(screen.queryByRole("heading", { name: "最近文件" })).toBeNull();
    expect(screen.queryByText("report.pdf")).toBeNull();
    expect(renderedClient.getQueryData(fileKey)).toEqual(recentFilePage());
    expect(mocks.fetchProductFiles).not.toHaveBeenCalled();
  });

  it("hides the Agent entry, stops its query, and clears cached definitions after read access is denied", async () => {
    authState.permissions = ["threads:read", "runs:create"];
    mocks.agentsApiEnabled = true;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const agentsKey = ["product", "dashboard-agents", "user-a"];
    const otherAgentsKey = ["product", "dashboard-agents", "user-b"];
    client.setQueryData(agentsKey, [
      { name: "private-agent", display_name: "撤权后的智能体" },
    ]);
    client.setQueryData(otherAgentsKey, [
      { name: "other-agent", display_name: "其他账号智能体" },
    ]);

    const { client: renderedClient } = renderHome(client);

    expect(screen.queryByRole("link", { name: /浏览智能体/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "常用智能体" })).toBeNull();
    expect(screen.queryByText("撤权后的智能体")).toBeNull();
    expect(mocks.listAgents).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(renderedClient.getQueryData(agentsKey)).toBeUndefined(),
    );
    expect(renderedClient.getQueryData(otherAgentsKey)).toEqual([
      { name: "other-agent", display_name: "其他账号智能体" },
    ]);
  });

  it("still fetches frequent agents when permissions are unresolved", async () => {
    authState.permissions = null;
    mocks.agentsApiEnabled = true;

    renderHome();

    await waitFor(() => expect(mocks.listAgents).toHaveBeenCalled());
    const options = mocks.listAgents.mock.calls[0]?.[0] as
      | { signal?: AbortSignal }
      | undefined;
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts an in-flight frequent-agent read when agents:read is revoked", async () => {
    const signals: AbortSignal[] = [];
    authState.permissions = ["agents:read", "threads:read", "runs:create"];
    mocks.agentsApiEnabled = true;
    mocks.listAgents.mockImplementation(
      (options?: { signal?: AbortSignal }) => {
        if (options?.signal) signals.push(options.signal);
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      },
    );
    const { rerender, client } = renderHome();

    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    expect(signals.every((signal) => signal.aborted)).toBe(false);
    authState.permissions = ["threads:read", "runs:create"];
    rerender(
      <QueryClientProvider client={client}>
        <WorkspaceHome />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(signals.every((signal) => signal.aborted)).toBe(true),
    );
    expect(screen.queryByRole("heading", { name: "常用智能体" })).toBeNull();
  });

  it("hides frequent agents when the agents switch is off without removing the owner cache", () => {
    authState.permissions = ["agents:read", "threads:read", "runs:create"];
    mocks.agentsApiEnabled = true;
    mocks.features = { ...mocks.features, agents: false };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const agentsKey = ["product", "dashboard-agents", "user-a"];
    client.setQueryData(agentsKey, [
      { name: "kept-agent", display_name: "保留的智能体" },
    ]);

    const { client: renderedClient } = renderHome(client);

    expect(screen.queryByRole("heading", { name: "常用智能体" })).toBeNull();
    expect(screen.queryByText("保留的智能体")).toBeNull();
    expect(renderedClient.getQueryData(agentsKey)).toEqual([
      { name: "kept-agent", display_name: "保留的智能体" },
    ]);
    expect(mocks.listAgents).not.toHaveBeenCalled();
  });

  it("keeps chat history available but hides chat creation when runs:create is denied", async () => {
    authState.permissions = ["threads:read", "agents:read"];
    mocks.agentsApiEnabled = true;

    renderHome();

    expect(screen.getByRole("link", { name: /查看对话/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: "开始一段对话" })).toBeNull();
    expect(mocks.searchThreads).toHaveBeenCalled();
  });
});
