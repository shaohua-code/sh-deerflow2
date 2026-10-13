import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type AnchorHTMLAttributes, type ReactNode } from "react";

const api = rs.hoisted(() => ({
  deleteProjectDocument: rs.fn(),
  deleteUploadedFile: rs.fn(),
  fetchProductFiles: rs.fn(),
  invalidateProductFileCatalogEntry: rs.fn(),
}));
const auth = rs.hoisted(() => ({
  userId: "user-a",
  permissions: null as string[] | null,
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () =>
    auth.userId
      ? { user: { id: auth.userId, permissions: auth.permissions } }
      : { user: null },
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
rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({ locale: "zh-CN" }),
}));
rs.mock("@/core/projects/api", () => ({
  deleteProjectDocument: api.deleteProjectDocument,
}));
rs.mock("@/core/static-mode", () => ({ isStaticWebsiteOnly: () => false }));
rs.mock("@/core/uploads/api", () => ({
  deleteUploadedFile: api.deleteUploadedFile,
}));
rs.mock("@/product/api", () => ({
  fetchProductFiles: api.fetchProductFiles,
  invalidateProductFileCatalogEntry: api.invalidateProductFileCatalogEntry,
}));

import { FileCenterPage } from "@/product/file-center-page";

afterEach(() => {
  cleanup();
  auth.userId = "user-a";
  auth.permissions = null;
  rs.clearAllMocks();
});

function prepareFileCenter() {
  const resultPage = {
    api_version: 1,
    files: [
      {
        file_id: "thread_upload:thread-1:internal-report.pdf",
        source: "thread_upload",
        name: "季度报告.pdf",
        size_bytes: 2048,
        artifact_url:
          "/api/threads/thread-1/artifacts/user-data/uploads/internal-report.pdf",
        modified_at: null,
        storage_name: "internal-report.pdf",
        thread_id: "thread-1",
        thread_name: "产品讨论",
        project_id: null,
        project_name: null,
        document_id: null,
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
    has_more: false,
    next_offset: null,
    truncated: false,
    failed_count: 0,
    coverage_notes: [],
  };
  api.fetchProductFiles.mockImplementation((_limit, _offset, query) =>
    Promise.resolve(
      query ? { ...resultPage, files: [], total: 0 } : resultPage,
    ),
  );
  api.deleteUploadedFile.mockResolvedValue(undefined);
  api.invalidateProductFileCatalogEntry.mockResolvedValue(undefined);
  return resultPage;
}

describe("FileCenterPage delete confirmation", () => {
  it("does not request or render the catalog without both read permissions", async () => {
    prepareFileCenter();
    auth.permissions = ["threads:read"];
    render(<FileCenterPage />);

    expect(
      await screen.findByText(
        "查看此文件目录需要 threads:read 和 projects:read 权限。",
      ),
    ).toBeDefined();
    expect(screen.queryByText("季度报告.pdf")).toBeNull();
    expect(api.fetchProductFiles).not.toHaveBeenCalled();
  });

  it("clears the local catalog and pending deletion when a route grant is revoked", async () => {
    prepareFileCenter();
    auth.permissions = [
      "threads:read",
      "projects:read",
      "threads:delete",
      "projects:delete",
    ];
    const view = render(<FileCenterPage />);
    expect(await screen.findByText("季度报告.pdf")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "删除文件: 季度报告.pdf" }),
    );
    expect(screen.getByRole("dialog")).toBeDefined();

    auth.permissions = ["threads:read"];
    view.rerender(<FileCenterPage />);

    expect(screen.queryByText("季度报告.pdf")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText(
        "查看此文件目录需要 threads:read 和 projects:read 权限。",
      ),
    ).toBeDefined();
    expect(api.fetchProductFiles).toHaveBeenCalledTimes(1);
    expect(api.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it("uses separate Gateway delete permissions for uploads and project documents", async () => {
    const resultPage = prepareFileCenter();
    const projectDocument = {
      ...resultPage.files[0],
      file_id: "project_document:project-1:doc-1",
      source: "project_document",
      name: "项目说明.pdf",
      storage_name: null,
      thread_id: null,
      thread_name: null,
      project_id: "project-1",
      project_name: "规划项目",
      document_id: "doc-1",
    };
    api.fetchProductFiles.mockResolvedValue({
      ...resultPage,
      files: [...resultPage.files, projectDocument],
      total: 2,
    });
    auth.permissions = ["threads:read", "projects:read", "threads:delete"];
    render(<FileCenterPage />);

    expect(await screen.findByText("季度报告.pdf")).toBeDefined();
    const uploadDelete = screen.getByRole("button", {
      name: "删除文件: 季度报告.pdf",
    });
    const projectDelete = screen.getByRole("button", {
      name: "删除文件: 项目说明.pdf",
    });
    expect(uploadDelete.hasAttribute("disabled")).toBe(false);
    expect(projectDelete.hasAttribute("disabled")).toBe(true);
    expect(projectDelete.getAttribute("title")).toBe(
      "删除此文件需要 projects:delete 权限。",
    );
  });

  it("shows a load error without an empty coverage notice", async () => {
    api.fetchProductFiles.mockRejectedValue(
      new Error("private backend detail"),
    );
    render(<FileCenterPage />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "部分文件暂时无法加载。",
    );
    expect(
      screen.queryAllByRole("status").every((item) => item.textContent?.trim()),
    ).toBe(true);
    expect(
      screen.getByText(
        "部分文件来源暂时无法读取，当前列表可能不完整。请重试或稍后再看。",
      ),
    ).toBeDefined();
    expect(screen.queryByText("当前目录可能未包含最近的文件变更。")).toBeNull();
  });

  it("renders a single coverage warning without a dangling separator", async () => {
    const resultPage = prepareFileCenter();
    api.fetchProductFiles.mockResolvedValue({ ...resultPage, failed_count: 2 });
    render(<FileCenterPage />);

    expect(await screen.findByText("季度报告.pdf")).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain(
      "部分文件暂时无法加载。 (2)",
    );
    expect(screen.getByRole("status").textContent?.trim()).toBe(
      "部分文件暂时无法加载。 (2)",
    );
  });

  it("discards the previous account catalog when the authenticated user changes", async () => {
    const userAFiles = prepareFileCenter();
    const userBFile = {
      ...userAFiles.files[0],
      file_id: "thread_upload:thread-b:private-notes.pdf",
      name: "用户 B 的私有文件.pdf",
      thread_id: "thread-b",
    };
    api.fetchProductFiles.mockImplementation(() =>
      Promise.resolve(
        auth.userId === "user-a"
          ? userAFiles
          : { ...userAFiles, files: [userBFile] },
      ),
    );
    const view = render(<FileCenterPage />);

    expect(await screen.findByText("季度报告.pdf")).toBeDefined();
    auth.userId = "user-b";
    view.rerender(<FileCenterPage />);

    expect(screen.queryByText("季度报告.pdf")).toBeNull();
    expect(await screen.findByText("用户 B 的私有文件.pdf")).toBeDefined();
    expect(screen.queryByText("季度报告.pdf")).toBeNull();
    expect(api.fetchProductFiles).toHaveBeenCalledTimes(2);
  });

  it("shows workspace files as read-only and links to the owned artifact route", async () => {
    const resultPage = prepareFileCenter();
    const workspaceFile = {
      ...resultPage.files[0],
      file_id: "thread_workspace:thread-1:docs/guide.md",
      source: "thread_workspace",
      name: "docs/guide.md",
      artifact_url:
        "/api/threads/thread-1/artifacts/mnt/user-data/workspace/docs/guide.md",
      storage_name: "docs/guide.md",
    };
    api.fetchProductFiles.mockResolvedValue({
      ...resultPage,
      files: [workspaceFile],
    });
    render(<FileCenterPage />);

    expect(await screen.findByText("docs/guide.md")).toBeDefined();
    expect(screen.getByText("对话工作区文件 · 只读")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "在新标签页打开：docs/guide.md" })
        .getAttribute("href"),
    ).toBe(workspaceFile.artifact_url);
    expect(
      screen.queryByRole("button", { name: "删除文件: docs/guide.md" }),
    ).toBeNull();
  });

  it("identifies each file source and exposes its update time and destination", async () => {
    const resultPage = prepareFileCenter();
    const file = resultPage.files[0];
    const files = [
      { ...file, modified_at: "2026-10-08T12:00:00Z" },
      {
        ...file,
        file_id: "thread_output:thread-1:result.md",
        source: "thread_output",
        name: "result.md",
      },
      {
        ...file,
        file_id: "thread_workspace:thread-1:notes.md",
        source: "thread_workspace",
        name: "notes.md",
      },
      {
        ...file,
        file_id: "project_document:project-1:doc-1",
        source: "project_document",
        name: "项目说明.pdf",
        thread_id: null,
        thread_name: null,
        project_id: "project-1",
        project_name: "规划项目",
        document_id: "doc-1",
      },
    ];
    api.fetchProductFiles.mockResolvedValue({ ...resultPage, files });
    render(<FileCenterPage />);

    expect(await screen.findByText("对话上传")).toBeDefined();
    expect(screen.getByText("智能体生成文件")).toBeDefined();
    expect(screen.getByText("对话工作区文件 · 只读")).toBeDefined();
    expect(screen.getByText("项目资料")).toBeDefined();
    expect(screen.getByText(/更新时间：/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "在新标签页打开：季度报告.pdf" }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "规划项目" })).toBeDefined();
  });

  it("searches the already loaded owner-wide catalog without rescanning", async () => {
    prepareFileCenter();
    render(<FileCenterPage />);

    const search = await screen.findByRole("textbox", {
      name: "搜索工作空间中的文件",
    });
    expect(
      screen.getByText(
        "可按文件名、对话名称或项目名称搜索整个工作空间，也会查找对话工作区文件；文件数量较多时结果可能不完整。",
      ),
    ).toBeDefined();

    fireEvent.change(search, { target: { value: "不存在的文件" } });
    expect(
      await screen.findByText("整个工作空间中没有找到匹配的文件。"),
    ).toBeDefined();
    await waitFor(() => {
      expect(api.fetchProductFiles).toHaveBeenLastCalledWith(
        10_000,
        0,
        "",
        expect.any(AbortSignal),
        false,
      );
    });
    expect(api.fetchProductFiles).toHaveBeenCalledTimes(1);
  });

  it("paginates the bounded catalog locally without requesting another scan", async () => {
    const resultPage = prepareFileCenter();
    const files = Array.from({ length: 51 }, (_, index) => ({
      ...resultPage.files[0],
      file_id: `thread_upload:thread-1:file-${index + 1}.pdf`,
      name: index === 50 ? "第51份文件.pdf" : `报告-${index + 1}.pdf`,
      storage_name: `file-${index + 1}.pdf`,
    }));
    api.fetchProductFiles.mockResolvedValue({
      ...resultPage,
      files,
      total: files.length,
      has_more: false,
      next_offset: null,
    });
    render(<FileCenterPage />);

    expect(await screen.findByText("报告-1.pdf")).toBeDefined();
    expect(screen.getByText("第 1 页文件 · 51 个文件")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "下一页文件" }));

    expect(await screen.findByText("第51份文件.pdf")).toBeDefined();
    expect(screen.getByText("第 2 页文件 · 51 个文件")).toBeDefined();
    expect(api.fetchProductFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchProductFiles).toHaveBeenCalledWith(
      10_000,
      0,
      "",
      expect.any(AbortSignal),
      false,
    );
  });

  it("keeps a valid page when deleting the only file on the last page", async () => {
    const resultPage = prepareFileCenter();
    const files = Array.from({ length: 51 }, (_, index) => ({
      ...resultPage.files[0],
      file_id: `thread_upload:thread-1:file-${index + 1}.pdf`,
      name: index === 50 ? "第51份文件.pdf" : `报告-${index + 1}.pdf`,
      storage_name: `file-${index + 1}.pdf`,
    }));
    api.fetchProductFiles.mockResolvedValue({
      ...resultPage,
      files,
      total: files.length,
      has_more: false,
      next_offset: null,
    });
    render(<FileCenterPage />);

    fireEvent.click(await screen.findByRole("button", { name: "下一页文件" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "删除文件: 第51份文件.pdf" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByText("第 1 页文件 · 50 个文件")).toBeDefined();
    expect(screen.getByText("报告-1.pdf")).toBeDefined();
    expect(screen.queryByText("第51份文件.pdf")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "下一页文件" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows the saved catalog freshness and requests a forced refresh", async () => {
    const resultPage = prepareFileCenter();
    api.fetchProductFiles
      .mockResolvedValueOnce({
        ...resultPage,
        catalog_updated_at: "2026-10-08T12:00:00Z",
        catalog_stale: true,
      })
      .mockResolvedValueOnce({
        ...resultPage,
        catalog_updated_at: "2026-10-09T12:00:00Z",
        catalog_stale: false,
      });
    render(<FileCenterPage />);

    expect(
      await screen.findByText("当前目录可能未包含最近的文件变更。"),
    ).toBeDefined();
    expect(screen.getByText(/目录更新时间：/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "刷新文件目录" }));

    await waitFor(() => {
      expect(api.fetchProductFiles).toHaveBeenLastCalledWith(
        10_000,
        0,
        "",
        expect.any(AbortSignal),
        true,
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByText("当前目录可能未包含最近的文件变更。"),
      ).toBeNull();
    });
  });

  it("keeps cached files visible while refreshing and localizes refresh failures", async () => {
    const resultPage = prepareFileCenter();
    let resolveRefresh!: (value: typeof resultPage) => void;
    const pendingRefresh = new Promise<typeof resultPage>((resolve) => {
      resolveRefresh = resolve;
    });
    api.fetchProductFiles
      .mockResolvedValueOnce(resultPage)
      .mockReturnValueOnce(pendingRefresh)
      .mockRejectedValueOnce(new Error("private backend path"));

    render(<FileCenterPage />);

    const cachedFile = await screen.findByText("季度报告.pdf");
    const refreshButton = screen.getByRole("button", { name: "刷新文件目录" });
    fireEvent.click(refreshButton);

    await waitFor(() => expect(api.fetchProductFiles).toHaveBeenCalledTimes(2));
    expect(cachedFile.isConnected).toBe(true);
    expect(refreshButton.hasAttribute("disabled")).toBe(true);

    resolveRefresh(resultPage);
    await waitFor(() =>
      expect(refreshButton.hasAttribute("disabled")).toBe(false),
    );

    fireEvent.click(refreshButton);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("部分文件暂时无法加载。")).toBeDefined();
    expect(screen.queryByText("private backend path")).toBeNull();
    expect(screen.getByText("季度报告.pdf")).toBeDefined();
    expect(
      screen.getByText("当前目录可能未包含最近的文件变更。"),
    ).toBeDefined();
  });
  it("explains when a manual refresh is deferred by the server cooldown", async () => {
    const resultPage = prepareFileCenter();
    api.fetchProductFiles.mockResolvedValue({
      ...resultPage,
      catalog_refresh_deferred: true,
    });
    render(<FileCenterPage />);

    expect(
      await screen.findByText("刷新请求过于频繁，请稍后再试。"),
    ).toBeDefined();
  });

  it("shows a branded confirmation and cancels without deleting", async () => {
    prepareFileCenter();
    render(<FileCenterPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "删除文件: 季度报告.pdf" }),
    );

    expect(screen.getByText(/1 个文件/)).toBeDefined();
    expect(screen.getByRole("dialog", { name: "确认删除文件" })).toBeDefined();
    expect(screen.getByText(/确定删除“季度报告\.pdf”吗/)).toBeDefined();
    expect(api.deleteUploadedFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(api.deleteUploadedFile).not.toHaveBeenCalled();
    expect(screen.getByText("季度报告.pdf")).toBeDefined();
  });

  it("deletes only after the user confirms", async () => {
    const filePage = prepareFileCenter();
    api.fetchProductFiles.mockImplementationOnce(() =>
      Promise.resolve(filePage),
    );
    render(<FileCenterPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "删除文件: 季度报告.pdf" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(api.deleteUploadedFile).toHaveBeenCalledWith(
        "thread-1",
        "internal-report.pdf",
      );
      expect(api.invalidateProductFileCatalogEntry).toHaveBeenCalledWith(
        "thread_upload:thread-1:internal-report.pdf",
      );
      expect(screen.queryByText("季度报告.pdf")).toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("文件已删除。")).toBeDefined();
  });

  it("locks the dialog while deleting, then keeps it open with a safe retry error", async () => {
    prepareFileCenter();
    let rejectDelete!: (reason: Error) => void;
    api.deleteUploadedFile.mockReturnValue(
      new Promise((_, reject) => {
        rejectDelete = reject;
      }),
    );
    const log = rs.spyOn(console, "error").mockImplementation(() => undefined);
    render(<FileCenterPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "删除文件: 季度报告.pdf" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "正在删除…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "取消" }).hasAttribute("disabled"),
    ).toBe(true);

    rejectDelete(new Error("private backend path and database detail"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "删除文件失败，请稍后重试。",
    );
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.queryByText(/private backend path/)).toBeNull();
    expect(screen.getByText("季度报告.pdf")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "确认删除" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(api.invalidateProductFileCatalogEntry).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Failed to delete file from file center:",
      expect.any(Error),
    );
  });
});
