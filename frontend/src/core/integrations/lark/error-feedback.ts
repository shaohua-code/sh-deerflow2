import { toast, type ExternalToast } from "sonner";

export type LarkFailureAction =
  | "install"
  | "start-authorization"
  | "complete-configuration"
  | "start-configuration"
  | "switch-app"
  | "check-connection"
  | "complete-authorization";

const diagnosticLabels: Record<LarkFailureAction, string> = {
  install: "Failed to install Lark integration:",
  "start-authorization": "Failed to start Lark authorization:",
  "complete-configuration": "Failed to complete Lark configuration:",
  "start-configuration": "Failed to start Lark configuration:",
  "switch-app": "Failed to switch Lark app:",
  "check-connection": "Failed to check Lark connection:",
  "complete-authorization": "Failed to complete Lark authorization:",
};

/**
 * 飞书接口异常可能包含 Gateway 诊断信息或平台响应正文。原异常仅写入诊断日志，
 * 设置页和 toast 只展示本地化产品文案，避免把服务端细节直接暴露给用户。
 */
export function reportLarkFailure(
  action: LarkFailureAction,
  error: unknown,
  localizedMessage: string,
  toastOptions?: ExternalToast,
) {
  console.error(diagnosticLabels[action], error);
  toast.error(localizedMessage, toastOptions);
}
