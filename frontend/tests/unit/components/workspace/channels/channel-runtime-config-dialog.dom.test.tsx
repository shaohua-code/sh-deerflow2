import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  onUnsavedChangesChange: rs.fn(),
  onOpenChange: rs.fn(),
  onSubmit: rs.fn(),
}));

import { ChannelRuntimeConfigDialog } from "@/components/workspace/channels/channel-runtime-config-dialog";
import type { ChannelProvider } from "@/core/channels/types";
import { I18nProvider } from "@/core/i18n/context";

const provider = {
  provider: "telegram",
  display_name: "Telegram",
  enabled: true,
  configured: true,
  auth_mode: "oauth",
  connection_status: "disconnected",
  credential_fields: [
    { name: "token", label: "Token", type: "password", required: true },
  ],
  credential_values: { token: "secret" },
} as unknown as ChannelProvider;

function renderDialog({
  submitting = false,
}: {
  submitting?: boolean;
} = {}) {
  document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
  render(
    <I18nProvider initialLocale="zh-CN">
      <ChannelRuntimeConfigDialog
        provider={provider}
        open
        submitting={submitting}
        onOpenChange={mocks.onOpenChange}
        onSubmit={mocks.onSubmit}
        onUnsavedChangesChange={mocks.onUnsavedChangesChange}
      />
    </I18nProvider>,
  );
}

function lastRegistration() {
  const calls = mocks.onUnsavedChangesChange.mock.calls as unknown as Array<
    [
      {
        isPending: boolean;
        discard: () => void;
      } | null,
    ]
  >;
  return calls[calls.length - 1]?.[0] ?? null;
}

beforeEach(() => {
  mocks.onUnsavedChangesChange.mockReset();
  mocks.onOpenChange.mockReset();
  mocks.onSubmit.mockReset();
});

afterEach(() => {
  cleanup();
  document.cookie = "locale=; max-age=0; path=/";
});

describe("ChannelRuntimeConfigDialog unsaved-changes contract", () => {
  it("registers null when clean and a discard handle once the draft changes", () => {
    renderDialog();

    // 干净草稿不登记任何状态。
    expect(mocks.onUnsavedChangesChange).toHaveBeenCalledWith(null);

    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "changed" },
    });
    const registration = lastRegistration();
    expect(registration).not.toBeNull();
    expect(registration?.isPending).toBe(false);
    expect(typeof registration?.discard).toBe("function");

    // 改回服务端值后草稿不再脏，登记恢复为 null。
    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "secret" },
    });
    expect(lastRegistration()).toBeNull();
  });

  it("resets the draft to the server snapshot when the discard handle runs", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "changed" },
    });
    const registration = lastRegistration();
    // 状态更新需在 act 内刷新，DOM 才会反映重置后的值。
    act(() => {
      registration?.discard();
    });

    // 放弃只重置草稿，不关闭弹窗。
    expect((screen.getByLabelText("Token") as HTMLInputElement).value).toBe(
      "secret",
    );
    expect(mocks.onOpenChange).not.toHaveBeenCalled();
    expect(lastRegistration()).toBeNull();
  });

  it("reports the pending flag while the save request is in flight", () => {
    renderDialog({ submitting: true });

    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "changed" },
    });
    // 设置弹窗用该标记阻止切栏与关闭。
    expect(lastRegistration()?.isPending).toBe(true);
  });
});
