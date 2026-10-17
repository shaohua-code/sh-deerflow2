"use client";

import { Check, FolderInput, FolderMinus, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import { useCreateProject, useProjects } from "@/core/projects";
import { getProjectPermissionAccess } from "@/core/projects/permissions";
import { useMoveThreadToProject } from "@/core/threads/hooks";
import type { AgentThread } from "@/core/threads/types";
import { projectIdOfThread } from "@/core/threads/utils";
import { isIMEComposing } from "@/lib/ime";

/**
 * "Move to project" submenu for a thread's dropdown menu: active projects
 * (check mark on the current one), "New project…" (opens the create dialog),
 * and "Remove from project" when the thread is assigned. Archived projects
 * never appear because only the "active" list is queried.
 *
 * Renders ONLY menu content. DropdownMenuContent unmounts its children when
 * the menu closes, so the create dialog lives outside the menu: the
 * "New project…" item delegates to `onNewProject`, and the caller mounts
 * `NewProjectDialog` as a sibling of the DropdownMenu (the same pattern the
 * rename dialog uses in `ThreadSidebarItem`).
 */
export function MoveToProjectMenu({
  thread,
  onNewProject,
  onMoveProject,
}: {
  thread: AgentThread;
  onNewProject: () => void;
  onMoveProject: (projectId: string | null) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const access = getProjectPermissionAccess(user);
  const canMove = access.canReadProjects && access.canWriteThreads;
  const { data: projects } = useProjects("active", {
    enabled: canMove,
  });

  const currentProjectId = projectIdOfThread(thread);

  // Presentational only: the move mutation lives on the persistent
  // `ThreadSidebarItem` (this submenu unmounts when the dropdown closes, so
  // a mutation owned here would lose its error handling on failure).
  const handleMove = useCallback(
    (projectId: string | null) => {
      if (!canMove || projectId === currentProjectId) {
        return;
      }
      onMoveProject(projectId);
    },
    [canMove, currentProjectId, onMoveProject],
  );

  if (!canMove) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput className="text-muted-foreground" />
        <span>{t.projects.moveToProject}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {projects?.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => handleMove(project.id)}
          >
            {project.id === currentProjectId ? (
              <Check className="text-muted-foreground" />
            ) : (
              <span aria-hidden="true" className="size-4 shrink-0" />
            )}
            <span className="truncate">{project.name}</span>
          </DropdownMenuItem>
        ))}
        {projects && projects.length > 0 && <DropdownMenuSeparator />}
        {access.canCreateProject ? (
          <DropdownMenuItem onSelect={onNewProject}>
            <Plus className="text-muted-foreground" />
            <span>{t.projects.newProject}…</span>
          </DropdownMenuItem>
        ) : null}
        {currentProjectId !== null && (
          <DropdownMenuItem onSelect={() => handleMove(null)}>
            <FolderMinus className="text-muted-foreground" />
            <span>{t.projects.removeFromProject}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <span className="text-xs">{t.projects.moveToProjectHint}</span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * "New project" dialog for the move-to-project flow. Must be mounted
 * OUTSIDE the thread's DropdownMenuContent (as a sibling of the
 * DropdownMenu) so it survives the menu closing. On successful create, the
 * thread is moved into the new project.
 */
export function NewProjectDialog({
  thread,
  open,
  onOpenChange,
}: {
  thread: AgentThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const access = getProjectPermissionAccess(user);
  const { mutate: createProject, isPending: isCreating } = useCreateProject();
  const { mutate: moveThreadToProject } = useMoveThreadToProject();

  const [createName, setCreateName] = useState("");

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setCreateName("");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!access.canCreateProject || !access.canWriteThreads) {
      setCreateName("");
      onOpenChange(false);
    }
  }, [access.canCreateProject, access.canWriteThreads, onOpenChange]);

  const handleCreateSubmit = useCallback(() => {
    const name = createName.trim();
    if (
      !name ||
      isCreating ||
      !access.canCreateProject ||
      !access.canWriteThreads
    ) {
      return;
    }
    createProject(
      { name },
      {
        onSuccess: (project) => {
          handleOpenChange(false);
          moveThreadToProject(
            { threadId: thread.thread_id, projectId: project.id },
            {
              onError: () => {
                // 移动失败可能包含存储或 Gateway 细节，界面统一使用安全提示。
                toast.error(t.projects.moveFailed);
              },
            },
          );
        },
        onError: () => {
          // 创建失败可能包含 Gateway 的内部 detail，只向用户显示双语产品提示。
          toast.error(t.projects.createFailed);
        },
      },
    );
  }, [
    createProject,
    createName,
    access.canCreateProject,
    access.canWriteThreads,
    isCreating,
    handleOpenChange,
    moveThreadToProject,
    t.projects.createFailed,
    t.projects.moveFailed,
    thread.thread_id,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t.projects.newProject}</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <Input
            aria-label={t.projects.namePlaceholder}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={t.projects.namePlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isIMEComposing(e)) {
                e.preventDefault();
                handleCreateSubmit();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleCreateSubmit}
            disabled={!createName.trim() || isCreating}
          >
            {t.projects.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!access.canCreateProject || !access.canWriteThreads) {
    return null;
  }
}
