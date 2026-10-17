import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  user: { id: "user-1", system_role: "admin" },
  discardDraft: rs.fn(),
  onSectionRequestRejected: rs.fn(),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
rs.mock("@/product/hooks", () => ({ useProductFeature: () => true }));
rs.mock("next/dynamic", () => ({
  default: () =>
    function MockSettingsPage({
      onUnsavedChangesChange,
    }: {
      onUnsavedChangesChange?: (
        changes: {
          isPending: boolean;
          discard: () => void;
        } | null,
      ) => void;
    }) {
      if (!onUnsavedChangesChange) return null;
      const registerDraft = (isPending: boolean) =>
        onUnsavedChangesChange({
          isPending,
          discard: mocks.discardDraft,
        });
      return (
        <>
          <button type="button" onClick={() => registerDraft(false)}>
            Mark draft as unsaved
          </button>
          <button type="button" onClick={() => registerDraft(true)}>
            Start saving draft
          </button>
        </>
      );
    },
}));

import { SettingsDialog } from "@/components/workspace/settings/settings-dialog";
import { I18nProvider } from "@/core/i18n/context";

function renderSettingsDialog(
  defaultSection: "appearance" | "about" | "product" = "appearance",
) {
  return render(
    <I18nProvider initialLocale="en-US">
      <SettingsDialog
        open
        defaultSection={defaultSection}
        onOpenChange={() => undefined}
        onSectionRequestRejected={mocks.onSectionRequestRejected}
      />
    </I18nProvider>,
  );
}

function getSettingsSectionSelect() {
  const selector = screen.getByRole("combobox", { name: "Settings" });
  if (!(selector instanceof HTMLSelectElement)) {
    throw new Error("Settings section control is not a native select");
  }
  return selector;
}

afterEach(() => {
  cleanup();
  mocks.user = { id: "user-1", system_role: "admin" };
  mocks.discardDraft.mockReset();
  mocks.onSectionRequestRejected.mockReset();
});

describe("SettingsDialog responsive navigation", () => {
  it("names desktop navigation buttons and marks the selected settings page", () => {
    renderSettingsDialog();

    const appearance = screen.getByRole("button", { name: "Appearance" });
    expect(appearance.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Account" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Workspace preferences" }),
    ).toBeDefined();
  });

  it("offers a compact mobile selector with every page available to the user", () => {
    renderSettingsDialog();

    const selector = getSettingsSectionSelect();
    expect(selector).toBeDefined();
    expect(
      screen.getByRole("option", { name: "Product administration" }),
    ).toBeDefined();
    expect(screen.getByRole("option", { name: "Appearance" })).toBeDefined();
  });

  it("returns to an accessible section if admin access is removed while open", async () => {
    const view = renderSettingsDialog();
    const selector = getSettingsSectionSelect();

    fireEvent.change(selector, { target: { value: "administration" } });
    expect(selector.value).toBe("administration");

    mocks.user = { id: "user-1", system_role: "user" };
    view.rerender(
      <I18nProvider initialLocale="en-US">
        <SettingsDialog open onOpenChange={() => undefined} />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(getSettingsSectionSelect().value).toBe("appearance"),
    );
    expect(
      screen.queryByRole("option", { name: "Product administration" }),
    ).toBeNull();
  });

  it("follows a new caller-selected section while the dialog stays open", () => {
    const view = renderSettingsDialog();
    fireEvent.change(getSettingsSectionSelect(), {
      target: { value: "channels" },
    });

    view.rerender(
      <I18nProvider initialLocale="en-US">
        <SettingsDialog
          open
          defaultSection="about"
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    expect(getSettingsSectionSelect().value).toBe("about");
    expect(
      screen
        .getByRole("button", { name: "About" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps a dirty section open when an external entry requests another section", async () => {
    const view = renderSettingsDialog("product");
    fireEvent.click(
      screen.getByRole("button", { name: "Mark draft as unsaved" }),
    );

    view.rerender(
      <I18nProvider initialLocale="en-US">
        <SettingsDialog
          open
          defaultSection="about"
          onOpenChange={() => undefined}
          onSectionRequestRejected={mocks.onSectionRequestRejected}
        />
      </I18nProvider>,
    );

    // 统一 unsaved-changes 契约：脏草稿下外部切换请求先弹放弃确认，
    // 确认框打开期间主内容被 Radix 遮出可访问树，先点 "Keep editing"
    // 走完拒绝流程，再断言 section 未被切换。
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep editing" }),
    );

    expect(getSettingsSectionSelect().value).toBe("product");
    expect(mocks.onSectionRequestRejected).toHaveBeenCalledWith("product");
    expect(mocks.discardDraft).not.toHaveBeenCalled();
  });

  it("discards the dirty draft only after the user confirms external navigation", async () => {
    const view = renderSettingsDialog("product");
    fireEvent.click(
      screen.getByRole("button", { name: "Mark draft as unsaved" }),
    );

    view.rerender(
      <I18nProvider initialLocale="en-US">
        <SettingsDialog
          open
          defaultSection="about"
          onOpenChange={() => undefined}
          onSectionRequestRejected={mocks.onSectionRequestRejected}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );

    expect(mocks.discardDraft).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getSettingsSectionSelect().value).toBe("about"));
  });

  it("keeps the active section selected when an external request arrives during save", async () => {
    const view = renderSettingsDialog("product");
    fireEvent.click(screen.getByRole("button", { name: "Start saving draft" }));

    view.rerender(
      <I18nProvider initialLocale="en-US">
        <SettingsDialog
          open
          defaultSection="about"
          onOpenChange={() => undefined}
          onSectionRequestRejected={mocks.onSectionRequestRejected}
        />
      </I18nProvider>,
    );

    expect(getSettingsSectionSelect().value).toBe("product");
    expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
    expect(mocks.onSectionRequestRejected).toHaveBeenCalledWith("product");
  });
});
