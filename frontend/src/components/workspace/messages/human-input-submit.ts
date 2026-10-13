import type { HumanInputSubmitResult } from "./human-input-card";

/** 包装隐藏回复提交：请求失败时解锁卡片，提示文案与异常诊断由调用方负责。 */
export async function submitHumanInputWithRecovery(
  submit: () => HumanInputSubmitResult | Promise<HumanInputSubmitResult>,
  clearPending: () => void,
  onFailure: (error: unknown) => void,
): Promise<HumanInputSubmitResult> {
  try {
    const result = await submit();
    if (result === false) {
      clearPending();
    }
    return result;
  } catch (error) {
    // 请求失败后解锁卡片供重试；调用方应显示本地化提示，不透传 API 异常正文。
    clearPending();
    onFailure(error);
    return false;
  }
}
