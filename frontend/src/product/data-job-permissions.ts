import { PERMISSIONS, type RoutePermission } from "@/core/auth/permissions";

import type { ProductDataDeletionScope, ProductDataExportScope } from "./api";

const EXPORT_PERMISSIONS: Record<
  ProductDataExportScope,
  readonly RoutePermission[]
> = {
  preferences: [PERMISSIONS.PREFERENCES_READ],
  // Conversation exports include Gateway run usage summaries as well as messages.
  threads: [PERMISSIONS.THREADS_READ, PERMISSIONS.RUNS_READ],
  projects: [PERMISSIONS.PROJECTS_READ],
  scheduled_tasks: [PERMISSIONS.THREADS_READ],
  agents: [PERMISSIONS.AGENTS_READ],
  memory: [PERMISSIONS.MEMORY_READ],
  files: [PERMISSIONS.THREADS_READ, PERMISSIONS.PROJECTS_READ],
  account: [
    PERMISSIONS.PREFERENCES_READ,
    PERMISSIONS.THREADS_READ,
    PERMISSIONS.RUNS_READ,
    PERMISSIONS.PROJECTS_READ,
    PERMISSIONS.AGENTS_READ,
    PERMISSIONS.MEMORY_READ,
  ],
};

const DELETION_PERMISSIONS: Record<
  ProductDataDeletionScope,
  readonly RoutePermission[]
> = {
  preferences: [PERMISSIONS.PREFERENCES_WRITE],
  threads: [PERMISSIONS.THREADS_DELETE],
  scheduled_tasks: [PERMISSIONS.THREADS_DELETE],
  agents: [PERMISSIONS.AGENTS_DELETE],
  projects: [PERMISSIONS.PROJECTS_DELETE],
  memory: [PERMISSIONS.MEMORY_DELETE],
  // The files operation covers both thread uploads and project documents.
  files: [PERMISSIONS.THREADS_DELETE, PERMISSIONS.PROJECTS_DELETE],
};

export function getDataJobRequiredPermissions(
  kind: "export",
  scope: ProductDataExportScope,
): readonly RoutePermission[];
export function getDataJobRequiredPermissions(
  kind: "deletion",
  scope: ProductDataDeletionScope,
): readonly RoutePermission[];
export function getDataJobRequiredPermissions(
  kind: "export" | "deletion",
  scope: string,
): readonly RoutePermission[] | null;
export function getDataJobRequiredPermissions(
  kind: "export" | "deletion",
  scope: string,
): readonly RoutePermission[] | null {
  if (kind === "export") {
    return scope in EXPORT_PERMISSIONS
      ? EXPORT_PERMISSIONS[scope as ProductDataExportScope]
      : null;
  }
  return scope in DELETION_PERMISSIONS
    ? DELETION_PERMISSIONS[scope as ProductDataDeletionScope]
    : null;
}
