import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  createExport: rs.fn(),
}));
const auth = rs.hoisted(() => ({ userId: "owner-1" }));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: auth.userId
      ? {
          id: auth.userId,
          email: `${auth.userId}@example.com`,
          system_role: "user",
        }
      : null,
    logout: rs.fn(),
  }),
}));
rs.mock("@/product/data-export", () => ({
  createUserDataExport: mocks.createExport,
}));

import { AccountSettingsPage } from "@/components/workspace/settings/account-settings-page";
import { I18nProvider } from "@/core/i18n/context";

function renderAccountSettings() {
  return render(
    <I18nProvider initialLocale="en-US">
      <AccountSettingsPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.createExport.mockImplementation(
    (
      _userId: string,
      _onProgress: unknown,
      { signal }: { signal: AbortSignal },
    ) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Data export cancelled", "AbortError")),
          { once: true },
        );
      }),
  );
});

afterEach(() => {
  cleanup();
  auth.userId = "owner-1";
  rs.clearAllMocks();
});

describe("AccountSettingsPage data export", () => {
  it("labels password fields and guides password managers", () => {
    renderAccountSettings();

    expect(
      screen.getByLabelText("Current password").getAttribute("autocomplete"),
    ).toBe("current-password");
    expect(
      screen.getByLabelText("New password").getAttribute("autocomplete"),
    ).toBe("new-password");
    expect(
      screen
        .getByLabelText("Confirm new password")
        .getAttribute("autocomplete"),
    ).toBe("new-password");
  });

  it("lets the user cancel a running export and announces the outcome", async () => {
    renderAccountSettings();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate and download" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel export" }),
    );

    expect(
      await screen.findByText("Data export cancelled. No package was created."),
    ).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain(
      "Data export cancelled",
    );
    expect(mocks.createExport.mock.calls[0]?.[0]).toBe("owner-1");
    expect(mocks.createExport.mock.calls[0]?.[2].signal.aborted).toBe(true);
  });

  it("stops an in-page export when the account settings page is closed", async () => {
    const view = renderAccountSettings();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate and download" }),
    );
    await screen.findByRole("button", { name: "Cancel export" });
    const signal = mocks.createExport.mock.calls[0]?.[2].signal;

    view.unmount();

    expect(signal.aborted).toBe(true);
  });

  it("clears password fields and aborts export when the account changes", async () => {
    const view = renderAccountSettings();
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "old-account-secret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Generate and download" }),
    );
    await screen.findByRole("button", { name: "Cancel export" });
    const signal = mocks.createExport.mock.calls[0]?.[2].signal;

    auth.userId = "owner-2";
    view.rerender(
      <I18nProvider initialLocale="en-US">
        <AccountSettingsPage />
      </I18nProvider>,
    );

    expect(signal.aborted).toBe(true);
    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText("owner-2@example.com")).toBeDefined();
    expect(
      screen.queryByText("Data export cancelled. No package was created."),
    ).toBeNull();
  });
});
