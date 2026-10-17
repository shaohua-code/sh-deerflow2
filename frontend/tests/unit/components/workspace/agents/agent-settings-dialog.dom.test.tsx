import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  updateAgent: rs.fn(),
  updatePending: false,
  userPermissions: null as string[] | null,
  onOpenChange: rs.fn(),
}));

rs.mock("@/core/agents", () => ({
  // 组件只使用运行时函数 useUpdateAgent；类型导入在编译期被擦除。
  useUpdateAgent: () => ({
    isPending: mocks.updatePending,
    mutateAsync: mocks.updateAgent,
    reset: rs.fn(),
  }),
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1", permissions: mocks.userPermissions },
  }),
}));
rs.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: [],
    error: null,
    isFetching: false,
    refetch: rs.fn(),
  }),
}));
rs.mock("@/core/subagents", () => ({
  useSubagents: () => ({
    subagents: [],
    error: null,
    isFetching: false,
    refetch: rs.fn(),
  }),
}));

import { AgentSettingsDialog } from "@/components/workspace/agents/agent-settings-dialog";
import { I18nProvider } from "@/core/i18n/context";

const agent = {
  name: "researcher",
  display_name: "研究员",
  description: "",
  model: null,
  tool_groups: null,
  skills: null,
  allowed_subagents: null,
  model_settings: null,
  thinking_enabled: null,
  reasoning_effort: null,
};

function renderDialog() {
  document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
  mocks.userPermissions = [];
  return render(
    <I18nProvider initialLocale="zh-CN">
      <AgentSettingsDialog
        agent={agent}
        open
        onOpenChange={mocks.onOpenChange}
      />
    </I18nProvider>,
  );
}

function editDisplayName(value: string) {
  fireEvent.change(screen.getByLabelText("显示名称"), {
    target: { value },
  });
}

beforeEach(() => {
  mocks.updateAgent.mockReset();
  mocks.onOpenChange.mockReset();
  mocks.updatePending = false;
  mocks.userPermissions = null;
});

afterEach(() => {
  cleanup();
});

describe("AgentSettingsDialog dirty guards", () => {
  it("disables save until the settings draft actually changes", () => {
    renderDialog();

    const save = screen.getByRole("button", { name: "保存" });
    // 不变量①：草稿与服务器值一致时禁止重复保存，也不显示未保存提示。
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("智能体设置有未保存的更改。")).toBeNull();

    editDisplayName("新名字");
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("智能体设置有未保存的更改。")).toBeDefined();

    // 改回原值后草稿不再脏，保存重新禁用。
    editDisplayName("研究员");
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("智能体设置有未保存的更改。")).toBeNull();
  });

  it("keeps edits when the user continues editing from the discard dialog", () => {
    renderDialog();

    editDisplayName("新名字");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    // 不变量②：有未保存更改时取消先弹放弃确认，而不是直接关闭。
    const discardDialog = screen.getByRole("dialog", {
      description: "当前设置尚未保存。继续将放弃这些更改。",
    });
    expect(within(discardDialog).getByText("放弃未保存的更改？")).toBeDefined();
    expect(mocks.onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(
      within(discardDialog).getByRole("button", { name: "继续编辑" }),
    );
    expect(screen.queryByText("放弃未保存的更改？")).toBeNull();
    expect((screen.getByLabelText("显示名称") as HTMLInputElement).value).toBe(
      "新名字",
    );
    expect(mocks.onOpenChange).not.toHaveBeenCalled();
  });

  it("closes the dialog through the discard confirmation path", () => {
    renderDialog();

    editDisplayName("新名字");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    const discardDialog = screen.getByRole("dialog", {
      description: "当前设置尚未保存。继续将放弃这些更改。",
    });
    fireEvent.click(
      within(discardDialog).getByRole("button", { name: "放弃更改" }),
    );

    // 不变量②：明确放弃后才向父组件报告关闭。
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("locks inputs and footer actions while the save request is pending", () => {
    mocks.updatePending = true;
    renderDialog();

    // 不变量③：保存进行中禁止再次提交，输入与取消一并锁定。
    expect(screen.getByLabelText("显示名称").hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      screen
        .getByRole("button", { name: "加载中..." })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "取消" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
