import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AgentGallery } from "@/components/workspace/agents/agent-gallery";
import type { Agent } from "@/core/agents";
import { enUS } from "@/core/i18n/locales/en-US";

const { refetch, useAgents, useAuth } = rs.hoisted(() => ({
  refetch: rs.fn().mockResolvedValue({}),
  useAgents: rs.fn(),
  useAuth: rs.fn().mockReturnValue({ user: null }),
}));

rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn() }),
}));

rs.mock("@/core/agents", () => ({
  useAgents,
  useDeleteAgent: () => ({ mutateAsync: rs.fn(), isPending: false }),
  useUpdateAgent: () => ({ mutateAsync: rs.fn(), isPending: false }),
}));
rs.mock("@/core/auth/AuthProvider", () => ({ useAuth }));

rs.mock("@/core/i18n/hooks", () => ({ useI18n: () => ({ t: enUS }) }));

afterEach(() => {
  cleanup();
  refetch.mockClear();
  useAgents.mockReset();
  useAuth.mockReset();
  useAuth.mockReturnValue({ user: null });
});

describe("AgentGallery load errors", () => {
  it("does not describe an unavailable Gateway as an empty agent list", () => {
    useAgents.mockReturnValue({
      agents: [],
      isLoading: false,
      isFetching: false,
      error: new Error("private Gateway response detail"),
      refetch,
    });

    render(<AgentGallery />);

    expect(screen.getByRole("alert").textContent).toContain(
      enUS.agents.loadFailed,
    );
    expect(screen.queryByText(enUS.agents.emptyTitle)).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain(
      "private Gateway response detail",
    );

    fireEvent.click(screen.getByRole("button", { name: enUS.agents.retry }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps cached agents visible when a background refresh fails", () => {
    const cachedAgent: Agent = {
      name: "reviewer",
      display_name: "Review Assistant",
      description: "Reviews changes",
      model: null,
      tool_groups: null,
      skills: null,
    };
    useAgents.mockReturnValue({
      agents: [cachedAgent],
      isLoading: false,
      isFetching: false,
      error: new Error("private Gateway response detail"),
      refetch,
    });

    render(<AgentGallery />);

    expect(screen.getByText("Review Assistant")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      enUS.agents.loadFailed,
    );
    expect(screen.getByRole("alert").textContent).not.toContain(
      "private Gateway response detail",
    );
  });

  it("hides cached agent data and stops querying when agents:read is denied", () => {
    useAuth.mockReturnValue({ user: { permissions: ["agents:write"] } });
    useAgents.mockReturnValue({
      agents: [{ name: "private-agent", display_name: "Private agent" }],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch,
    });

    render(<AgentGallery />);

    expect(useAgents).toHaveBeenCalledWith(false);
    expect(screen.getByRole("alert").textContent).toContain("agents:read");
    expect(screen.queryByText("Private agent")).toBeNull();
    expect(
      screen.queryByRole("button", { name: enUS.agents.newAgent }),
    ).toBeNull();
  });

  it("hides creation when its read, write, or run permission is denied", () => {
    useAuth.mockReturnValue({
      user: { permissions: ["agents:read", "agents:delete", "runs:create"] },
    });
    useAgents.mockReturnValue({
      agents: [],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch,
    });

    render(<AgentGallery />);

    expect(useAgents).toHaveBeenCalledWith(true);
    expect(
      screen.queryByRole("button", { name: enUS.agents.newAgent }),
    ).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("agents:write");
  });
});
