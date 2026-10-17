import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// 用可控 mutation 回调模拟 Gateway 返回敏感 detail，确保 toast 只展示产品文案。
const mocks = rs.hoisted(() => ({
  createProject: rs.fn(),
  moveThreadToProject: rs.fn(),
  toastError: rs.fn(),
}));

rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
rs.mock("@/core/projects", () => ({
  useCreateProject: () => ({ mutate: mocks.createProject, isPending: false }),
}));
rs.mock("@/core/threads/hooks", () => ({
  useMoveThreadToProject: () => ({ mutate: mocks.moveThreadToProject }),
}));
// NewProjectDialog 现在经 getProjectPermissionAccess 预检（canCreateProject
// = projects:read + projects:write，加 threads:write），缺失时 effect 直接
// 关闭对话框（P327/P328 权限矩阵）。
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      permissions: [
        "projects:read",
        "projects:write",
        "threads:read",
        "threads:write",
      ],
    },
  }),
}));

import { NewProjectDialog } from "@/components/workspace/move-to-project-menu";
import { I18nProvider } from "@/core/i18n/context";

const thread = { thread_id: "thread-1" } as never;

function renderDialog() {
  return render(
    <I18nProvider initialLocale="en-US">
      <NewProjectDialog thread={thread} open onOpenChange={rs.fn()} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.createProject.mockReset();
  mocks.moveThreadToProject.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => cleanup());

describe("project mutation failure messages", () => {
  it("uses localized copy for project creation failures", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "My project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const [, callbacks] = mocks.createProject.mock.calls[0] as [
      { name: string },
      { onError: (error: Error) => void },
    ];
    callbacks.onError(new Error("database password and SQL detail"));

    expect(mocks.toastError).toHaveBeenCalledWith("Failed to create project");
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "database password and SQL detail",
    );
  });

  it("uses localized copy when moving the chat into the new project fails", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "My project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const [, createCallbacks] = mocks.createProject.mock.calls[0] as [
      { name: string },
      { onSuccess: (project: { id: string }) => void },
    ];
    createCallbacks.onSuccess({ id: "project-1" });
    const [, moveCallbacks] = mocks.moveThreadToProject.mock.calls[0] as [
      { threadId: string; projectId: string },
      { onError: (error: Error) => void },
    ];
    moveCallbacks.onError(new Error("private move backend detail"));

    expect(mocks.toastError).toHaveBeenCalledWith("Failed to move chat");
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private move backend detail",
    );
  });
});
