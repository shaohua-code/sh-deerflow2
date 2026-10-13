import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";
import type { User } from "@/core/auth/types";

/**
 * Scheduled-task page permissions, mapped from the Gateway route guards.
 * Keeping the matrix here makes UI gates and their regression tests agree;
 * the Gateway still checks each request and each user's data scope.
 */
export function getScheduledTaskPermissionAccess(
  user: Pick<User, "permissions"> | null | undefined,
) {
  const canReadTasks = hasPermission(user, PERMISSIONS.THREADS_READ);
  const canWriteThreads = hasPermission(user, PERMISSIONS.THREADS_WRITE);
  const canCreateRuns = hasPermission(user, PERMISSIONS.RUNS_CREATE);
  const canReadRuns = hasPermission(user, PERMISSIONS.RUNS_READ);

  return {
    canReadTasks,
    canReadRunHistory: canReadTasks && canReadRuns,
    canCreateTask: canWriteThreads && canCreateRuns,
    canUpdateTask: canWriteThreads && canCreateRuns,
    canPauseTask: canWriteThreads,
    canResumeTask: canWriteThreads && canCreateRuns,
    canTriggerTask: canWriteThreads && canCreateRuns,
    canDeleteTask: hasPermission(user, PERMISSIONS.THREADS_DELETE),
    canReadAgents: hasPermission(user, PERMISSIONS.AGENTS_READ),
    canReuseThread: canReadTasks && canWriteThreads,
  };
}
