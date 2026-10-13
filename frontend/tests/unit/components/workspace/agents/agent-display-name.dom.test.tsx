import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";

import { AgentWelcome } from "@/components/workspace/agent-welcome";
import { AgentCard } from "@/components/workspace/agents/agent-card";
import { AgentSettingsDialog } from "@/components/workspace/agents/agent-settings-dialog";
import type { Agent } from "@/core/agents";
import { enUS } from "@/core/i18n/locales/en-US";

const { deleteAgent, mutateAsync, toastError, useSubagentsMock, userState } =
  rs.hoisted(() => ({
    deleteAgent: rs.fn(),
    mutateAsync: rs.fn().mockResolvedValue({}),
    toastError: rs.fn(),
    useSubagentsMock: rs.fn(),
    userState: { current: null as { permissions: string[] } | null },
  }));
rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn() }),
}));
rs.mock("@/core/agents", () => ({
  useDeleteAgent: () => ({ mutateAsync: deleteAgent, isPending: false }),
  useUpdateAgent: () => ({ mutateAsync, isPending: false }),
}));
rs.mock("@/core/models/hooks", () => ({ useModels: () => ({ models: [] }) }));
rs.mock("@/core/subagents", () => ({
  useSubagents: (enabled = true) => {
    useSubagentsMock(enabled);
    return { subagents: [], error: null, isFetching: false, refetch: rs.fn() };
  },
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: userState.current }),
}));
rs.mock("@/core/i18n/hooks", () => ({ useI18n: () => ({ t: enUS }) }));
rs.mock("sonner", () => ({
  toast: { success: rs.fn(), error: toastError },
}));

const agent: Agent = {
  name: "reviewer",
  display_name: "代码审查助手",
  description: "",
  model: null,
  tool_groups: null,
  skills: null,
};
afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  deleteAgent.mockClear();
  toastError.mockClear();
  useSubagentsMock.mockClear();
  userState.current = null;
});

describe("custom agent display names", () => {
  it("names each model and runtime control for assistive technology", () => {
    render(<AgentSettingsDialog agent={agent} open onOpenChange={rs.fn()} />);

    expect(
      screen.getByRole("combobox", { name: "Default model" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: "Temperature" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: "Max output tokens" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Subagent access" }),
    ).toBeTruthy();
  });

  it("accepts 100 astral code points without an HTML code-unit limit", async () => {
    render(<AgentSettingsDialog agent={agent} open onOpenChange={rs.fn()} />);
    const input = screen.getByLabelText("Display name");
    expect(input.hasAttribute("maxlength")).toBe(false);
    fireEvent.change(input, { target: { value: "🦌".repeat(100) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ display_name: "🦌".repeat(100) }),
        }),
      ),
    );
  });

  it("rejects 101 code points before saving", () => {
    render(<AgentSettingsDialog agent={agent} open onOpenChange={rs.fn()} />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "🦌".repeat(101) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("shows Unicode names and falls back for legacy or cleared names", () => {
    const { rerender } = render(
      <AgentWelcome agent={agent} agentName="reviewer" />,
    );
    expect(screen.getByText("代码审查助手")).toBeTruthy();
    for (const display_name of [undefined, null, ""]) {
      rerender(
        <AgentWelcome
          agent={{ ...agent, display_name }}
          agentName="reviewer"
        />,
      );
      expect(screen.getByText("reviewer")).toBeTruthy();
    }
  });

  it("saves a display name using the stable identifier", async () => {
    render(<AgentSettingsDialog agent={agent} open onOpenChange={rs.fn()} />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "审查员 🦌" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "reviewer",
          request: expect.objectContaining({ display_name: "审查员 🦌" }),
        }),
      ),
    );
  });

  it("clears a blank name without renaming the agent", async () => {
    render(<AgentSettingsDialog agent={agent} open onOpenChange={rs.fn()} />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "reviewer",
          request: expect.objectContaining({ display_name: null }),
        }),
      ),
    );
  });

  it("does not expose backend details when saving agent settings fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("private database detail"));
    render(<AgentSettingsDialog agent={agent} open onOpenChange={rs.fn()} />);

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Failed update" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(enUS.agents.settingsSaveFailed),
    );
    expect(toast.error).not.toHaveBeenCalledWith("private database detail");
  });

  it("disables a redundant settings save until the draft changes", () => {
    render(<AgentSettingsDialog agent={agent} open onOpenChange={rs.fn()} />);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Updated reviewer" },
    });
    expect(save.hasAttribute("disabled")).toBe(false);
  });

  it("does not expose backend details when deleting an agent fails", async () => {
    deleteAgent.mockRejectedValueOnce(new Error("private owner data detail"));
    render(<AgentCard agent={agent} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: enUS.agents.deleteFor("代码审查助手"),
      }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(enUS.agents.deleteFailed),
    );
    expect(toast.error).not.toHaveBeenCalledWith("private owner data detail");
  });

  it("hides edit and delete controls when those actions are denied", () => {
    render(<AgentCard agent={agent} canEdit={false} canDelete={false} />);

    expect(
      screen.getByRole("button", {
        name: enUS.agents.chatWith("代码审查助手"),
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: enUS.agents.settingsFor("代码审查助手"),
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: enUS.agents.deleteFor("代码审查助手"),
      }),
    ).toBeNull();
  });

  it("does not submit agent settings when agents:write is denied", async () => {
    render(
      <AgentSettingsDialog
        agent={agent}
        open
        onOpenChange={rs.fn()}
        canEdit={false}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("agents:write");
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("preserves subagent bindings when the catalog read grant is denied", async () => {
    userState.current = { permissions: ["agents:read", "agents:write"] };
    render(
      <AgentSettingsDialog
        agent={{ ...agent, allowed_subagents: ["planner"] }}
        open
        onOpenChange={rs.fn()}
      />,
    );

    expect(useSubagentsMock).toHaveBeenCalledWith(false);
    expect(screen.getByRole("status").textContent).toContain("subagents:read");
    expect(
      screen
        .getByRole("combobox", { name: "Subagent access" })
        .hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Updated reviewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0]![0].request).not.toHaveProperty(
      "allowed_subagents",
    );
  });
});
