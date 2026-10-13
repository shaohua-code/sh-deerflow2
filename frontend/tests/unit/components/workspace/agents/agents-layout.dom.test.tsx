import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import AgentsLayout from "@/app/workspace/agents/layout";
import { enUS } from "@/core/i18n/locales/en-US";

const { refetch, useAgentsApiEnabled } = rs.hoisted(() => ({
  refetch: rs.fn().mockResolvedValue({}),
  useAgentsApiEnabled: rs.fn(),
}));

rs.mock("@/core/agents", () => ({ useAgentsApiEnabled }));
rs.mock("@/core/i18n/hooks", () => ({ useI18n: () => ({ t: enUS }) }));

afterEach(() => {
  cleanup();
  refetch.mockClear();
  useAgentsApiEnabled.mockReset();
});

describe("AgentsLayout capability state", () => {
  it("shows a retryable Gateway error instead of calling the feature disabled", () => {
    useAgentsApiEnabled.mockReturnValue({
      enabled: false,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    });

    render(<AgentsLayout>Agent content</AgentsLayout>);

    expect(screen.getByRole("alert").textContent).toContain(
      enUS.agents.featureCheckFailed,
    );
    expect(screen.queryByText(enUS.agents.featureDisabledTitle)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: enUS.agents.retry }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the disabled explanation only after a definitive answer", () => {
    useAgentsApiEnabled.mockReturnValue({
      enabled: false,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch,
    });

    render(<AgentsLayout>Agent content</AgentsLayout>);

    expect(screen.getByText(enUS.agents.featureDisabledTitle)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
