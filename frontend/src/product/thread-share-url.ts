/**
 * 生成当前 Flow Desk 实例内的会话链接。
 * 中文说明：自托管地址必须沿用浏览器当前 origin，不能把 localhost 分享到 DeerFlow 官方演示站。
 */
export function buildThreadShareUrl(origin: string, threadPath: string) {
  const baseOrigin = new URL(origin).origin;
  const shareUrl = new URL(threadPath, baseOrigin);

  if (shareUrl.origin !== baseOrigin) {
    throw new TypeError("Thread share paths must stay on the current instance");
  }

  return shareUrl.toString();
}
