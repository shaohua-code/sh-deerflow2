import { hasPermission, PERMISSIONS } from "../auth/permissions";
import type { User } from "../auth/types";

/**
 * Frontend visibility map for project routes. Gateway decorators remain the
 * authorization boundary; this map only keeps the workspace from showing
 * actions that the current route-permission snapshot will reject.
 */
export function getProjectPermissionAccess(
  user: Pick<User, "permissions"> | null | undefined,
) {
  const canReadProjects = hasPermission(user, PERMISSIONS.PROJECTS_READ);
  const canWriteProjects = hasPermission(user, PERMISSIONS.PROJECTS_WRITE);
  const canDeleteProjects = hasPermission(user, PERMISSIONS.PROJECTS_DELETE);
  const canReadThreads = hasPermission(user, PERMISSIONS.THREADS_READ);
  const canWriteThreads = hasPermission(user, PERMISSIONS.THREADS_WRITE);
  const canCreateRuns = hasPermission(user, PERMISSIONS.RUNS_CREATE);

  return {
    canReadProjects,
    canWriteProjects,
    canDeleteProjects,
    canReadThreads,
    canWriteThreads,
    // The project-list UI is available only to readers. Creation is separately
    // write-protected and applies read/write IAM data scopes on the Gateway.
    canCreateProject: canReadProjects && canWriteProjects,
    canReadProjectThreads: canReadProjects && canReadThreads,
    canCreateProjectChat: canWriteThreads && canCreateRuns,
    // Document routes have their own permission combinations, independent
    // of the project page's read permission.
    canUploadProjectDocument: canWriteProjects,
    canDeleteProjectDocument: canDeleteProjects,
    canPromoteThreadFile: canWriteProjects && canReadThreads,
    canAttachProjectDocument:
      canWriteProjects && canReadThreads && canWriteThreads,
  };
}
