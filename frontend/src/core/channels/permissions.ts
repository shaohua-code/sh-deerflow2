import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";
import type { User } from "@/core/auth/types";

/** Channel connection reads and writes follow the Gateway route grants. */
export function canReadChannels(
  user: Pick<User, "permissions"> | null | undefined,
): boolean {
  return getPermissionState(user, PERMISSIONS.CHANNELS_READ) !== "denied";
}

export function canWriteChannels(
  user: Pick<User, "permissions"> | null | undefined,
): boolean {
  return getPermissionState(user, PERMISSIONS.CHANNELS_WRITE) !== "denied";
}

/** Runtime credentials are deployment-wide and require both Gateway grants and local admin role. */
export function canManageChannelRuntime(
  user: Pick<User, "permissions" | "system_role"> | null | undefined,
): boolean {
  return (
    user?.system_role === "admin" &&
    getPermissionState(user, PERMISSIONS.CHANNELS_ADMIN) !== "denied"
  );
}
