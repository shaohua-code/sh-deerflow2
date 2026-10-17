import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, waitFor } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  pathname: "/workspace",
  query: "",
  replace: rs.fn(),
}));

rs.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}));

import {
  getSettingsDialogSnapshot,
  setSettingsDialogOpen,
} from "@/components/workspace/settings/settings-dialog-store";
import { WorkspaceSettingsDeepLink } from "@/components/workspace/workspace-settings-deep-link";

afterEach(() => {
  cleanup();
  mocks.pathname = "/workspace";
  mocks.query = "";
  mocks.replace.mockReset();
  setSettingsDialogOpen(false);
});

describe("WorkspaceSettingsDeepLink", () => {
  it("opens the shared dialog for a supported settings section", () => {
    mocks.query = "settings=appearance";

    render(<WorkspaceSettingsDeepLink />);

    expect(getSettingsDialogSnapshot()).toEqual({
      open: true,
      section: "appearance",
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("ignores unsupported sections instead of opening an empty settings page", () => {
    mocks.query = "settings=arbitrary-value";

    render(<WorkspaceSettingsDeepLink />);

    expect(getSettingsDialogSnapshot().open).toBe(false);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("removes only its own query parameter after the dialog closes", async () => {
    mocks.query = "tab=files&settings=about&source=notification";
    const { rerender } = render(<WorkspaceSettingsDeepLink />);

    expect(getSettingsDialogSnapshot().section).toBe("about");
    setSettingsDialogOpen(false);
    rerender(<WorkspaceSettingsDeepLink />);

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/workspace?tab=files&source=notification",
        { scroll: false },
      ),
    );
  });
});
