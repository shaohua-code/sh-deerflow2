import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  settings: undefined as
    | { settings: { key: string; value: unknown }[] }
    | undefined,
}));

rs.mock("@/product/settings-hooks", () => ({
  useProductSettings: () => ({ data: mocks.settings }),
}));

import { WorkspaceDensityBoundary } from "@/product/workspace-density-boundary";

beforeEach(() => {
  mocks.settings = { settings: [] };
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("WorkspaceDensityBoundary", () => {
  it("applies the saved compact setting around every workspace child", () => {
    mocks.settings = {
      settings: [{ key: "workspace.display", value: "compact" }],
    };
    render(
      <WorkspaceDensityBoundary>
        <main>Chat workspace</main>
      </WorkspaceDensityBoundary>,
    );

    const boundary = screen.getByRole("main").parentElement;
    expect(boundary?.getAttribute("data-workspace-density")).toBe("compact");
    expect(boundary?.classList.contains("contents")).toBe(true);
  });

  it("uses the comfortable default for unset or unknown values", () => {
    mocks.settings = {
      settings: [{ key: "workspace.display", value: "future-density" }],
    };
    render(
      <WorkspaceDensityBoundary>
        <main>Chat workspace</main>
      </WorkspaceDensityBoundary>,
    );

    expect(
      screen
        .getByRole("main")
        .parentElement?.getAttribute("data-workspace-density"),
    ).toBe("comfortable");
  });
});
