import type { User } from "./types";

/**
 * `GET /api/v1/auth/me` 返回的有效路由权限，与 Gateway
 * `backend/app/gateway/authz.py:Permissions` 按相同顺序维护。增加后端权限时，
 * 要同步本目录和 permissions.test.ts 的词表契约。
 */
export const PERMISSIONS = {
  THREADS_READ: "threads:read",
  THREADS_WRITE: "threads:write",
  THREADS_DELETE: "threads:delete",
  RUNS_CREATE: "runs:create",
  RUNS_READ: "runs:read",
  RUNS_CANCEL: "runs:cancel",
  PROJECTS_READ: "projects:read",
  PROJECTS_WRITE: "projects:write",
  PROJECTS_DELETE: "projects:delete",
  MEMORY_READ: "memory:read",
  MEMORY_WRITE: "memory:write",
  MEMORY_DELETE: "memory:delete",
  MEMORY_ADMIN: "memory:admin",
  PREFERENCES_READ: "preferences:read",
  PREFERENCES_WRITE: "preferences:write",
  AGENTS_READ: "agents:read",
  AGENTS_WRITE: "agents:write",
  AGENTS_DELETE: "agents:delete",
  AGENTS_ADMIN: "agents:admin",
  CHANNELS_READ: "channels:read",
  CHANNELS_WRITE: "channels:write",
  CHANNELS_ADMIN: "channels:admin",
  INTEGRATIONS_READ: "integrations:read",
  INTEGRATIONS_WRITE: "integrations:write",
  INTEGRATIONS_ADMIN: "integrations:admin",
  SKILLS_READ: "skills:read",
  SKILLS_WRITE: "skills:write",
  SKILLS_DELETE: "skills:delete",
  SKILLS_ADMIN: "skills:admin",
  SUBAGENTS_READ: "subagents:read",
  SUBAGENTS_ADMIN: "subagents:admin",
  MCP_ADMIN: "mcp:admin",
} as const;

export type PermissionState = "granted" | "denied" | "unresolved";
export type RoutePermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type ChatSubmissionBlock = "run" | "thread" | null;

/**
 * Resolve the permissions used by the Gateway routes behind chat submission.
 * Project-scoped first sends explicitly create thread metadata before creating
 * a run, so they need both permissions; ordinary sends only create a run.
 */
export function getChatSubmissionBlock(
  user: Pick<User, "permissions"> | null | undefined,
  options: { requiresThreadWrite?: boolean } = {},
): ChatSubmissionBlock {
  if (getPermissionState(user, PERMISSIONS.RUNS_CREATE) === "denied") {
    return "run";
  }
  if (
    options.requiresThreadWrite &&
    getPermissionState(user, PERMISSIONS.THREADS_WRITE) === "denied"
  ) {
    return "thread";
  }
  return null;
}

/** 解析当前 auth 快照：未提供列表与明确拒绝是不同状态，供 UI 选择合适说明。 */
export function getPermissionState(
  user: Pick<User, "permissions"> | null | undefined,
  permission: RoutePermission,
): PermissionState {
  if (user?.permissions == null) return "unresolved";
  return user.permissions.includes(permission) ? "granted" : "denied";
}

/** 返回本次操作明确缺少的权限；未知快照继续兼容旧 Gateway。 */
export function getMissingPermissions(
  user: Pick<User, "permissions"> | null | undefined,
  required: readonly RoutePermission[],
): RoutePermission[] {
  return required.filter(
    (permission) => getPermissionState(user, permission) === "denied",
  );
}

/**
 * 兼容现有只需隐藏“明确拒绝”的按钮。旧版 Gateway、凭据创建响应或用户尚未加载时，
 * 权限字段可能缺失/为 null，仍沿用旧前端行为以兼容滚动升级；新界面应优先使用
 * getPermissionState 区分未知与允许。这个布尔值只用于展示，Gateway 路由守卫仍是授权边界。
 */
export function hasPermission(
  user: Pick<User, "permissions"> | null | undefined,
  permission: RoutePermission,
): boolean {
  return getPermissionState(user, permission) !== "denied";
}
