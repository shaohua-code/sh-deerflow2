import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";

const mocks = rs.hoisted(() => ({
  userId: "alice",
  canReadProjects: true,
  fetchOwnerData: rs.fn(),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      id: mocks.userId,
      permissions: mocks.canReadProjects ? ["projects:read"] : [],
    },
  }),
}));

import { WorkspaceQueryBoundary } from "@/product/workspace-query-boundary";

function OwnerData() {
  const { data } = useQuery({
    // 模拟尚未按账号分区的旧业务查询键；隔离必须由工作台边界保证。
    queryKey: ["owner-data"],
    queryFn: () => mocks.fetchOwnerData(mocks.userId),
    staleTime: Infinity,
  });
  return (
    <>
      <p>{data ?? "正在加载"}</p>
      <input aria-label="账号草稿" defaultValue="" />
    </>
  );
}

afterEach(() => {
  cleanup();
  mocks.fetchOwnerData.mockReset();
  mocks.userId = "alice";
  mocks.canReadProjects = true;
});

describe("WorkspaceQueryBoundary", () => {
  it("drops the previous account's cache before the new account responds", async () => {
    let completeBob: (value: string) => void = () => undefined;
    mocks.fetchOwnerData.mockImplementation((userId: string) =>
      userId === "bob"
        ? new Promise<string>((resolve) => {
            completeBob = resolve;
          })
        : Promise.resolve(`数据：${userId}`),
    );

    const view = render(
      <WorkspaceQueryBoundary>
        <OwnerData />
      </WorkspaceQueryBoundary>,
    );
    expect(await screen.findByText("数据：alice")).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "账号草稿" }), {
      target: { value: "Alice 未提交内容" },
    });

    mocks.userId = "bob";
    view.rerender(
      <WorkspaceQueryBoundary>
        <OwnerData />
      </WorkspaceQueryBoundary>,
    );

    expect(screen.queryByText("数据：alice")).toBeNull();
    expect(screen.getByText("正在加载")).toBeDefined();
    expect(
      (screen.getByRole("textbox", { name: "账号草稿" }) as HTMLInputElement)
        .value,
    ).toBe("");
    completeBob("数据：bob");
    expect(await screen.findByText("数据：bob")).toBeDefined();

    mocks.userId = "alice";
    view.rerender(
      <WorkspaceQueryBoundary>
        <OwnerData />
      </WorkspaceQueryBoundary>,
    );
    await waitFor(() => expect(mocks.fetchOwnerData).toHaveBeenCalledTimes(3));
  });

  it("clears project and trash query caches when project read permission is revoked", async () => {
    mocks.fetchOwnerData.mockImplementation((scope: string) =>
      Promise.resolve(`private ${scope}`),
    );

    function ProjectAndTrashData() {
      const project = useQuery({
        queryKey: ["projects", mocks.userId, { status: "active" }],
        queryFn: () => mocks.fetchOwnerData("projects"),
        enabled: mocks.canReadProjects,
        staleTime: Infinity,
      });
      const trash = useQuery({
        queryKey: ["trash", "documents", mocks.userId],
        queryFn: () => mocks.fetchOwnerData("trash"),
        enabled: mocks.canReadProjects,
        staleTime: Infinity,
      });
      return (
        <>
          {mocks.canReadProjects ? <p>{project.data}</p> : null}
          {mocks.canReadProjects ? <p>{trash.data}</p> : null}
        </>
      );
    }

    const view = render(
      <WorkspaceQueryBoundary>
        <ProjectAndTrashData />
      </WorkspaceQueryBoundary>,
    );
    expect(await screen.findByText("private projects")).toBeDefined();
    expect(await screen.findByText("private trash")).toBeDefined();

    mocks.canReadProjects = false;
    view.rerender(
      <WorkspaceQueryBoundary>
        <ProjectAndTrashData />
      </WorkspaceQueryBoundary>,
    );
    expect(screen.queryByText("private projects")).toBeNull();
    expect(screen.queryByText("private trash")).toBeNull();

    mocks.canReadProjects = true;
    view.rerender(
      <WorkspaceQueryBoundary>
        <ProjectAndTrashData />
      </WorkspaceQueryBoundary>,
    );
    await waitFor(() => expect(mocks.fetchOwnerData).toHaveBeenCalledTimes(4));
  });

  it("clears only the current owner's project threads when project read is revoked", async () => {
    mocks.fetchOwnerData.mockImplementation((scope: string) =>
      Promise.resolve(`private ${scope}`),
    );

    function ProjectThreadData() {
      const client = useQueryClient();
      const [stamp, setStamp] = useState(0);
      useQuery({
        queryKey: ["projects", "threads", "proj-1", mocks.userId],
        queryFn: () => mocks.fetchOwnerData("threads"),
        enabled: mocks.canReadProjects,
        staleTime: Infinity,
      });
      useQuery({
        queryKey: ["projects", "threads", "proj-1", "other"],
        queryFn: () => Promise.resolve("other threads"),
        staleTime: Infinity,
      });
      const aliceCached = client.getQueryData([
        "projects",
        "threads",
        "proj-1",
        "alice",
      ]);
      const otherCached = client.getQueryData([
        "projects",
        "threads",
        "proj-1",
        "other",
      ]);
      return (
        <>
          <button type="button" onClick={() => setStamp((value) => value + 1)}>
            读取缓存
          </button>
          <p>{aliceCached ? "alice-cached" : "alice-cleared"}</p>
          <p>{otherCached ? "other-cached" : "other-cleared"}</p>
          <p>{stamp}</p>
        </>
      );
    }

    const view = render(
      <WorkspaceQueryBoundary>
        <ProjectThreadData />
      </WorkspaceQueryBoundary>,
    );
    expect(await screen.findByText("alice-cached")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();

    mocks.canReadProjects = false;
    view.rerender(
      <WorkspaceQueryBoundary>
        <ProjectThreadData />
      </WorkspaceQueryBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "读取缓存" }));
    expect(screen.getByText("alice-cleared")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();
  });

  it("clears only the current owner's project documents when project read is revoked", async () => {
    mocks.fetchOwnerData.mockImplementation((scope: string) =>
      Promise.resolve(`private ${scope}`),
    );

    function ProjectDocumentData() {
      const client = useQueryClient();
      const [stamp, setStamp] = useState(0);
      useQuery({
        queryKey: ["projects", "documents", "proj-1", mocks.userId],
        queryFn: () => mocks.fetchOwnerData("documents"),
        enabled: mocks.canReadProjects,
        staleTime: Infinity,
      });
      useQuery({
        queryKey: ["projects", "documents", "proj-1", "other"],
        queryFn: () => Promise.resolve("other documents"),
        staleTime: Infinity,
      });
      const aliceCached = client.getQueryData([
        "projects",
        "documents",
        "proj-1",
        "alice",
      ]);
      const otherCached = client.getQueryData([
        "projects",
        "documents",
        "proj-1",
        "other",
      ]);
      return (
        <>
          <button type="button" onClick={() => setStamp((value) => value + 1)}>
            读取缓存
          </button>
          <p>{aliceCached ? "alice-cached" : "alice-cleared"}</p>
          <p>{otherCached ? "other-cached" : "other-cleared"}</p>
          <p>{stamp}</p>
        </>
      );
    }

    const view = render(
      <WorkspaceQueryBoundary>
        <ProjectDocumentData />
      </WorkspaceQueryBoundary>,
    );
    expect(await screen.findByText("alice-cached")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();

    mocks.canReadProjects = false;
    view.rerender(
      <WorkspaceQueryBoundary>
        <ProjectDocumentData />
      </WorkspaceQueryBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "读取缓存" }));
    expect(screen.getByText("alice-cleared")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();
  });

  it("clears only the current owner's project config when project read is revoked", async () => {
    mocks.fetchOwnerData.mockImplementation((scope: string) =>
      Promise.resolve(`private ${scope}`),
    );

    function ProjectConfigData() {
      const client = useQueryClient();
      const [stamp, setStamp] = useState(0);
      useQuery({
        queryKey: ["projects", "config", mocks.userId],
        queryFn: () => mocks.fetchOwnerData("config"),
        enabled: mocks.canReadProjects,
        staleTime: Infinity,
      });
      useQuery({
        queryKey: ["projects", "config", "other"],
        queryFn: () => Promise.resolve("other config"),
        staleTime: Infinity,
      });
      const aliceCached = client.getQueryData(["projects", "config", "alice"]);
      const otherCached = client.getQueryData(["projects", "config", "other"]);
      return (
        <>
          <button type="button" onClick={() => setStamp((value) => value + 1)}>
            读取缓存
          </button>
          <p>{aliceCached ? "alice-cached" : "alice-cleared"}</p>
          <p>{otherCached ? "other-cached" : "other-cleared"}</p>
          <p>{stamp}</p>
        </>
      );
    }

    const view = render(
      <WorkspaceQueryBoundary>
        <ProjectConfigData />
      </WorkspaceQueryBoundary>,
    );
    expect(await screen.findByText("alice-cached")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();

    mocks.canReadProjects = false;
    view.rerender(
      <WorkspaceQueryBoundary>
        <ProjectConfigData />
      </WorkspaceQueryBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "读取缓存" }));
    expect(screen.getByText("alice-cleared")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();
  });

  it("clears only the current owner's project thread files when project read is revoked", async () => {
    mocks.fetchOwnerData.mockImplementation((scope: string) =>
      Promise.resolve(`private ${scope}`),
    );

    function ProjectThreadFileData() {
      const client = useQueryClient();
      const [stamp, setStamp] = useState(0);
      useQuery({
        queryKey: [
          "projects",
          "thread-files",
          "proj-1",
          mocks.userId,
          { thread_limit: 20, file_limit: 50 },
        ],
        queryFn: () => mocks.fetchOwnerData("thread-files"),
        enabled: mocks.canReadProjects,
        staleTime: Infinity,
      });
      useQuery({
        queryKey: [
          "projects",
          "thread-files",
          "proj-1",
          "other",
          { thread_limit: 20, file_limit: 50 },
        ],
        queryFn: () => Promise.resolve("other files"),
        staleTime: Infinity,
      });
      const aliceCached = client.getQueryData([
        "projects",
        "thread-files",
        "proj-1",
        "alice",
        { thread_limit: 20, file_limit: 50 },
      ]);
      const otherCached = client.getQueryData([
        "projects",
        "thread-files",
        "proj-1",
        "other",
        { thread_limit: 20, file_limit: 50 },
      ]);
      return (
        <>
          <button type="button" onClick={() => setStamp((value) => value + 1)}>
            读取缓存
          </button>
          <p>{aliceCached ? "alice-cached" : "alice-cleared"}</p>
          <p>{otherCached ? "other-cached" : "other-cleared"}</p>
          <p>{stamp}</p>
        </>
      );
    }

    const view = render(
      <WorkspaceQueryBoundary>
        <ProjectThreadFileData />
      </WorkspaceQueryBoundary>,
    );
    expect(await screen.findByText("alice-cached")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();

    mocks.canReadProjects = false;
    view.rerender(
      <WorkspaceQueryBoundary>
        <ProjectThreadFileData />
      </WorkspaceQueryBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "读取缓存" }));
    expect(screen.getByText("alice-cleared")).toBeDefined();
    expect(screen.getByText("other-cached")).toBeDefined();
  });
});
