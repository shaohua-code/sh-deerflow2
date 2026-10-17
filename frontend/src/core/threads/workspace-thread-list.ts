import { isStaticWebsiteOnly } from "@/core/static-mode";

/**
 * 工作台侧栏和总览共用的未归档会话列表参数。
 * 查询键必须一致，总览才能复用侧栏已经发出的第一页，而不是再搜一次。
 */
export function workspaceRecentThreadListParams() {
  return {
    archived: isStaticWebsiteOnly() ? undefined : false,
  };
}
