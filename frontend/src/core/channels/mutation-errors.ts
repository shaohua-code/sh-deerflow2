import type { Translations } from "@/core/i18n/locales/types";

export type ChannelMutation = "connect" | "configure" | "disconnect";

// 渠道写接口的错误详情可能包含 Gateway 内部信息，界面只呈现双语操作提示。
export function getChannelMutationFailureMessage(
  operation: ChannelMutation,
  t: Translations["channels"],
): string {
  switch (operation) {
    case "connect":
      return t.connectFailed;
    case "configure":
      return t.configureFailed;
    case "disconnect":
      return t.disconnectFailed;
  }
}
