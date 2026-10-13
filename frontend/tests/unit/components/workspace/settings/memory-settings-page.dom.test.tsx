import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { type AnchorHTMLAttributes } from "react";

const mocks = rs.hoisted(() => ({
  user: { id: "user-1", permissions: undefined as string[] | undefined },
  useMemory: rs.fn(),
  refetch: rs.fn(),
  clearMemory: rs.fn(),
  createMemoryFact: rs.fn(),
  deleteMemoryFact: rs.fn(),
  importMemory: rs.fn(),
  updateMemoryFact: rs.fn(),
  exportMemory: rs.fn(),
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
  pending: {
    clear: false,
    create: false,
    delete: false,
    import: false,
    update: false,
  },
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user }),
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
rs.mock("@/core/memory/hooks", () => ({
  useMemory: (enabled: boolean, userId: string | null) =>
    mocks.useMemory(enabled, userId),
  useClearMemory: () => ({
    isPending: mocks.pending.clear,
    mutateAsync: mocks.clearMemory,
  }),
  useCreateMemoryFact: () => ({
    isPending: mocks.pending.create,
    mutateAsync: mocks.createMemoryFact,
  }),
  useDeleteMemoryFact: () => ({
    isPending: mocks.pending.delete,
    mutateAsync: mocks.deleteMemoryFact,
  }),
  useImportMemory: () => ({
    isPending: mocks.pending.import,
    mutateAsync: mocks.importMemory,
  }),
  useUpdateMemoryFact: () => ({
    isPending: mocks.pending.update,
    mutateAsync: mocks.updateMemoryFact,
  }),
}));
rs.mock("@/core/memory/api", () => ({
  exportMemory: mocks.exportMemory,
}));
rs.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { MemorySettingsPage } from "@/components/workspace/settings/memory-settings-page";
import { I18nProvider } from "@/core/i18n/context";

beforeEach(() => {
  document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
  mocks.user.id = "user-1";
  mocks.user.permissions = undefined;
  mocks.refetch.mockReset().mockResolvedValue({ data: null });
  mocks.clearMemory.mockReset().mockResolvedValue(null);
  mocks.createMemoryFact.mockReset().mockResolvedValue(null);
  mocks.deleteMemoryFact.mockReset().mockResolvedValue(null);
  mocks.importMemory.mockReset().mockResolvedValue(null);
  mocks.updateMemoryFact.mockReset().mockResolvedValue(null);
  mocks.exportMemory.mockReset().mockResolvedValue(null);
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  Object.assign(mocks.pending, {
    clear: false,
    create: false,
    delete: false,
    import: false,
    update: false,
  });
  mocks.useMemory.mockReset().mockReturnValue({
    memory: null,
    isLoading: false,
    isFetching: false,
    error: new Error("private backend detail"),
    refetch: mocks.refetch,
  });
});

function makeMemory() {
  return {
    version: "1",
    lastUpdated: "2026-10-09T00:00:00Z",
    user: {
      workContext: { summary: "", updatedAt: "" },
      personalContext: { summary: "", updatedAt: "" },
      topOfMind: { summary: "", updatedAt: "" },
    },
    history: {
      recentMonths: { summary: "", updatedAt: "" },
      earlierContext: { summary: "", updatedAt: "" },
      longTermBackground: { summary: "", updatedAt: "" },
    },
    facts: [
      {
        id: "fact-1",
        content: "原有记忆事实",
        category: "preference",
        confidence: 0.9,
        createdAt: "2026-10-08T00:00:00Z",
        source: "manual",
      },
    ],
  };
}

function renderLoadedMemory() {
  mocks.useMemory.mockReturnValue({
    memory: makeMemory(),
    isLoading: false,
    isFetching: false,
    error: undefined,
    refetch: mocks.refetch,
  });
  return render(
    <I18nProvider initialLocale="zh-CN">
      <MemorySettingsPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("MemorySettingsPage error state", () => {
  it("uses localized error copy and retries without rendering server details", () => {
    render(
      <I18nProvider initialLocale="zh-CN">
        <MemorySettingsPage />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("暂时无法加载记忆。")).toBeDefined();
    expect(screen.queryByText("private backend detail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps cached memory visible when a background refresh fails", () => {
    mocks.useMemory.mockReturnValue({
      memory: {
        ...makeMemory(),
        facts: [
          {
            id: "cached-fact",
            content: "缓存中的偏好内容",
            category: "preference",
            confidence: 0.9,
            createdAt: "2026-10-08T00:00:00Z",
            source: "manual",
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      error: new Error("private backend detail"),
      refetch: mocks.refetch,
    });

    render(
      <I18nProvider initialLocale="zh-CN">
        <MemorySettingsPage />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(
      screen.getByText("刷新失败，当前显示的是上次成功加载的记忆。"),
    ).toBeDefined();
    expect(screen.getByText("缓存中的偏好内容")).toBeDefined();
    expect(screen.queryByText("private backend detail")).toBeNull();
  });

  it("shows localized safe copy when export fails", async () => {
    renderLoadedMemory();
    mocks.exportMemory.mockRejectedValue(
      new Error("private memory storage path and credentials"),
    );

    fireEvent.click(screen.getByRole("button", { name: "导出记忆" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("无法导出记忆，请重试。"),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private memory storage path and credentials",
    );
  });

  it("shows localized safe copy when import fails", async () => {
    const { container } = renderLoadedMemory();
    mocks.importMemory.mockRejectedValue(
      new Error("private memory storage path and credentials"),
    );
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File([JSON.stringify(makeMemory())], "memory.json", {
      type: "application/json",
    });

    fireEvent.change(fileInput!, { target: { files: [file] } });
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "导入",
      }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "无法导入记忆，请检查文件后重试。",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private memory storage path and credentials",
    );
  });

  it("shows localized safe copy when clearing memory fails", async () => {
    renderLoadedMemory();
    mocks.clearMemory.mockRejectedValue(
      new Error("private memory storage path and credentials"),
    );

    fireEvent.click(screen.getByRole("button", { name: "清空全部记忆" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "清空全部记忆",
      }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("无法清空记忆，请重试。"),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private memory storage path and credentials",
    );
  });

  it("shows localized safe copy when a fact cannot be saved", async () => {
    renderLoadedMemory();
    mocks.createMemoryFact.mockRejectedValue(
      new Error("private memory storage path and credentials"),
    );

    fireEvent.click(screen.getByRole("button", { name: "添加事实" }));
    fireEvent.change(screen.getByLabelText("内容"), {
      target: { value: "新的记忆事实" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "保存事实",
      }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "无法保存这条事实，请重试。",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private memory storage path and credentials",
    );
  });

  it("shows localized safe copy when deleting a fact fails", async () => {
    renderLoadedMemory();
    mocks.deleteMemoryFact.mockRejectedValue(
      new Error("private memory storage path and credentials"),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "删除",
      }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "无法删除这条事实，请重试。",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private memory storage path and credentials",
    );
  });

  it("locks the fact editor and its dismissal paths while saving", () => {
    const view = renderLoadedMemory();
    fireEvent.click(screen.getByRole("button", { name: "添加事实" }));
    fireEvent.change(screen.getByLabelText("内容"), {
      target: { value: "正在保存的事实" },
    });

    mocks.pending.create = true;
    view.rerender(
      <I18nProvider initialLocale="zh-CN">
        <MemorySettingsPage />
      </I18nProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByLabelText("内容").hasAttribute("disabled")).toBe(true);
    expect(
      within(dialog)
        .getByRole("button", { name: "取消" })
        .hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});

describe("MemorySettingsPage permission boundaries", () => {
  it("does not render cached memory when read permission is denied", () => {
    mocks.user.permissions = ["runs:create"];
    mocks.useMemory.mockReturnValue({
      memory: makeMemory(),
      isLoading: false,
      isFetching: false,
      error: undefined,
      refetch: mocks.refetch,
    });

    renderLoadedMemory();

    expect(screen.getByRole("alert").textContent).toContain("memory:read");
    expect(screen.queryByText("原有记忆事实")).toBeNull();
    expect(screen.queryByRole("button", { name: "导出记忆" })).toBeNull();
    expect(mocks.useMemory).toHaveBeenCalledWith(false, "user-1");
  });

  it("limits memory actions to the granted read permission", () => {
    mocks.user.permissions = ["memory:read"];
    renderLoadedMemory();

    expect(screen.getByText("原有记忆事实")).toBeDefined();
    expect(screen.getByRole("button", { name: "导出记忆" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "导入记忆" })).toBeNull();
    expect(screen.queryByRole("button", { name: "添加事实" })).toBeNull();
    expect(screen.queryByRole("button", { name: "清空全部记忆" })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("closes a pending delete confirmation when the signed-in account changes", () => {
    mocks.user.permissions = ["memory:read", "memory:delete"];
    const { rerender } = renderLoadedMemory();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("dialog")).toBeDefined();

    mocks.user.id = "user-2";
    mocks.useMemory.mockReturnValue({
      memory: { ...makeMemory(), facts: [] },
      isLoading: false,
      isFetching: false,
      error: undefined,
      refetch: mocks.refetch,
    });
    rerender(
      <I18nProvider initialLocale="zh-CN">
        <MemorySettingsPage />
      </I18nProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.deleteMemoryFact).not.toHaveBeenCalled();
  });

  it("ignores a late export result after read permission is revoked", async () => {
    const { rerender } = renderLoadedMemory();
    let resolveExport!: (value: ReturnType<typeof makeMemory>) => void;
    mocks.exportMemory.mockReturnValue(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "导出记忆" }));
    mocks.user.permissions = ["memory:write"];
    rerender(
      <I18nProvider initialLocale="zh-CN">
        <MemorySettingsPage />
      </I18nProvider>,
    );

    await act(async () => {
      resolveExport(makeMemory());
    });

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
