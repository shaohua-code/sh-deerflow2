import { describe, expect, it } from "@rstest/core";

import {
  IAM_BUTTON_CODES,
  isIamButtonGranted,
  isIamMenuGranted,
} from "@/product/iam-resources";

const CHAT_CREATE = IAM_BUTTON_CODES.chatCreate;
const RUN_CANCEL = IAM_BUTTON_CODES.runCancel;

describe("IAM resource grants", () => {
  it("keeps the registered button codes aligned with the IAM resource tree", () => {
    // 按钮码与 IAM 资源树登记的 button 节点一一对应，改码必须两边同步。
    expect(IAM_BUTTON_CODES).toEqual({
      chatCreate: "deerflow.chats.new",
      runCancel: "deerflow.runs.cancel",
    });
  });

  it("grants everything when the session is uncontrolled", () => {
    // null = 未受控（纯本地账号 / IAM 不可达降级）：菜单与按钮全量显示。
    expect(isIamMenuGranted(null, "deerflow.chats")).toBe(true);
    expect(isIamButtonGranted(null, CHAT_CREATE)).toBe(true);
  });

  it("grants nothing while the control is still resolving", () => {
    // undefined = 解析中：受控项暂不显示，避免先闪现后收起。
    expect(isIamMenuGranted(undefined, "deerflow.chats")).toBe(false);
    expect(isIamButtonGranted(undefined, CHAT_CREATE)).toBe(false);
  });

  it("follows the granted codes once the session is controlled", () => {
    // 受控时只认 IAM 下发的码：缺哪个就隐藏哪个，互不影响。
    const control = { menus: ["deerflow.chats"], buttons: [CHAT_CREATE] };

    expect(isIamMenuGranted(control, "deerflow.chats")).toBe(true);
    expect(isIamMenuGranted(control, "deerflow.agents")).toBe(false);
    expect(isIamButtonGranted(control, CHAT_CREATE)).toBe(true);
    expect(isIamButtonGranted(control, RUN_CANCEL)).toBe(false);
  });

  it("hides every menu and button when IAM grants no resource at all", () => {
    // IAM 返回空授权是明确的「全部未授权」，不能当成未受控而全量放行。
    const control = { menus: [], buttons: [] };

    expect(isIamMenuGranted(control, "deerflow.chats")).toBe(false);
    expect(isIamButtonGranted(control, CHAT_CREATE)).toBe(false);
  });
});
