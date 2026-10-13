"use client";

import {
  Archive,
  Folder,
  MessageSquarePlus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ProjectDocumentsSection } from "@/components/workspace/projects/project-documents-section";
import { ProjectThreadsSection } from "@/components/workspace/projects/project-threads-section";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  getMissingPermissions,
  PERMISSIONS,
  hasPermission,
} from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";
import { getProjectPermissionAccess } from "@/core/projects/permissions";
import {
  PROJECTS_CONFIG_DEFAULT,
  useArchiveProject,
  useDeleteProject,
  useInfiniteProjectThreads,
  usePatchProject,
  useProject,
  useProjectsConfig,
  useRestoreProject,
  type Project,
  type ProjectsConfig,
} from "@/core/projects";
import { isStaticWebsiteOnly } from "@/core/static-mode";
import { isIMEComposing } from "@/lib/ime";
import { cn } from "@/lib/utils";

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function newProjectChatPath(projectId: string): string {
  return `/workspace/chats/new?project=${encodeURIComponent(projectId)}`;
}

function isProjectNotFoundError(error: unknown): boolean {
  // 404 可能表示已删除或不属于当前用户；临时故障不应伪装成资源不存在。
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "status") === 404
  );
}

function hasHTTPStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "status") === status
  );
}

export default function ProjectPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const access = getProjectPermissionAccess(user);
  const { id: projectId } = useParams<{ id: string }>();
  const [tab, setTab] = useState("chats");
  const projectQuery = useProject(projectId, {
    enabled: access.canReadProjects,
  });
  const project = projectQuery.data;
  const projectsConfigQuery = useProjectsConfig({
    enabled:
      access.canReadProjects && project != null && tab === "instructions",
  });
  const projectNotFound =
    projectQuery.isError && isProjectNotFoundError(projectQuery.error);
  // Skip the threads request entirely when the project 404s — the endpoint
  // itself 404s for a missing project, so firing it would be pure noise.
  const threadsQuery = useInfiniteProjectThreads(projectId, {
    enabled: project != null && access.canReadProjectThreads,
  });
  const projectThreads = threadsQuery.data?.pages.flatMap((page) => page) ?? [];

  useEffect(() => {
    document.title = project?.name
      ? `${project.name} - ${t.pages.appName}`
      : `${t.projects.title} - ${t.pages.appName}`;
  }, [project?.name, t.projects.title, t.pages.appName]);

  // Static demo mode has no Gateway and hides every project surface.
  if (isStaticWebsiteOnly()) {
    return null;
  }

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody>
        <ScrollArea className="size-full">
          <div className="mx-auto flex w-full max-w-(--container-width-md) flex-col gap-8 p-6 pt-8">
            {!access.canReadProjects ? (
              <p
                role="alert"
                className="text-muted-foreground py-16 text-center text-sm"
              >
                {t.agents.permissionRequired(PERMISSIONS.PROJECTS_READ)}
              </p>
            ) : projectNotFound ? (
              <ProjectNotFoundState />
            ) : project == null ? (
              projectQuery.isError ? (
                <ProjectLoadError
                  isFetching={projectQuery.isFetching}
                  onRetry={() => void projectQuery.refetch()}
                />
              ) : (
                <div className="text-muted-foreground py-16 text-center text-sm">
                  {t.common.loading}
                </div>
              )
            ) : (
              <>
                {projectQuery.isError ? (
                  <ProjectLoadError
                    refreshFailed
                    isFetching={projectQuery.isFetching}
                    onRetry={() => void projectQuery.refetch()}
                  />
                ) : null}
                <ProjectHeader
                  project={project}
                  canCreateChat={access.canCreateProjectChat}
                  missingChatPermissions={getMissingPermissions(user, [
                    PERMISSIONS.THREADS_WRITE,
                    PERMISSIONS.RUNS_CREATE,
                  ])}
                />
                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  className="flex flex-col gap-6"
                >
                  <TabsList aria-label={project.name}>
                    <TabsTrigger value="chats">
                      {t.projects.threads}
                    </TabsTrigger>
                    <TabsTrigger value="documents">
                      {t.projects.documents}
                    </TabsTrigger>
                    <TabsTrigger value="instructions">
                      {t.projects.instructions}
                    </TabsTrigger>
                    <TabsTrigger value="settings">
                      {t.projects.settings}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="chats">
                    {access.canReadProjectThreads ? (
                      <ProjectThreadsSection query={threadsQuery} />
                    ) : (
                      <p role="alert" className="text-muted-foreground text-sm">
                        {t.agents.permissionRequired(PERMISSIONS.THREADS_READ)}
                      </p>
                    )}
                  </TabsContent>
                  <TabsContent value="documents">
                    <ProjectDocumentsSection
                      project={project}
                      threads={projectThreads}
                    />
                  </TabsContent>
                  <TabsContent value="instructions">
                    {/* Key on the project id only: a route switch must reset
                        the editor, but a save round-trip must NOT remount it
                        — the section reconciles server updates against the
                        last-synced value so keystrokes typed while a save is
                        in flight survive the refetch. */}
                    <ProjectInstructionsSection
                      key={project.id}
                      project={project}
                      projectsConfig={projectsConfigQuery.data}
                    />
                  </TabsContent>
                  <TabsContent value="settings">
                    {/* Key on the project id only, same contract as the
                        instructions tab: a rename save round-trip must NOT
                        remount the section — it reconciles server updates
                        against the last-synced name so keystrokes typed
                        while a save is in flight survive the refetch. */}
                    <ProjectSettingsSection
                      key={project.id}
                      project={project}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </ScrollArea>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

function ProjectLoadError({
  refreshFailed = false,
  isFetching,
  onRetry,
}: {
  refreshFailed?: boolean;
  isFetching: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="border-destructive/30 flex flex-col items-start gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{refreshFailed ? t.projects.refreshFailed : t.projects.loadFailed}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={isFetching}
        onClick={onRetry}
      >
        {isFetching ? t.projects.retrying : t.projects.retry}
      </Button>
    </div>
  );
}

function ProjectNotFoundState() {
  const { t } = useI18n();
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>{t.projects.notFound}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function ProjectHeader({
  project,
  canCreateChat,
  missingChatPermissions,
}: {
  project: Project;
  canCreateChat: boolean;
  missingChatPermissions: string[];
}) {
  const { t } = useI18n();
  return (
    <header className="flex flex-wrap items-center gap-3">
      <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">
        {project.name}
      </h1>
      {project.status === "archived" && (
        <Badge variant="secondary">{t.projects.archived}</Badge>
      )}
      {project.status !== "archived" && canCreateChat && (
        <Button asChild>
          <Link href={newProjectChatPath(project.id)}>
            <MessageSquarePlus />
            {t.projects.newChat}
          </Link>
        </Button>
      )}
      {project.status !== "archived" && !canCreateChat && (
        <p role="status" className="text-muted-foreground w-full text-sm">
          {t.agents.permissionActionsLimited(missingChatPermissions.join(", "))}
        </p>
      )}
    </header>
  );
}

function ProjectSettingsSection({ project }: { project: Project }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const access = getProjectPermissionAccess(user);
  const missingSettingsPermissions = getMissingPermissions(user, [
    PERMISSIONS.PROJECTS_WRITE,
    PERMISSIONS.PROJECTS_DELETE,
  ]);
  const router = useRouter();
  const patchProject = usePatchProject();
  const archiveProject = useArchiveProject();
  const restoreProject = useRestoreProject();
  const deleteProject = useDeleteProject();

  const [name, setName] = useState(project.name);
  // Same reconciliation contract as the instructions editor: the section is
  // keyed on the project id (not updated_at), so a rename save round-trip —
  // or an archive/restore status flip — does not remount the field and
  // discard in-flight keystrokes. The refetched name overwrites the draft
  // ONLY while the draft still equals the last-synced value.
  const lastSyncedNameRef = useRef(project.name);
  useEffect(() => {
    const serverValue = project.name;
    const synced = lastSyncedNameRef.current;
    lastSyncedNameRef.current = serverValue;
    setName((current) => (current === synced ? serverValue : current));
  }, [project.name]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!access.canWriteProjects) {
      lastSyncedNameRef.current = project.name;
      setName(project.name);
    }
    if (!access.canDeleteProjects && !deleteProject.isPending) {
      setIsDeleteDialogOpen(false);
    }
  }, [
    access.canDeleteProjects,
    access.canWriteProjects,
    deleteProject.isPending,
    project.name,
  ]);

  const trimmedName = name.trim();
  const canSave =
    access.canWriteProjects &&
    trimmedName.length > 0 &&
    trimmedName !== project.name &&
    !patchProject.isPending;
  const isArchived = project.status === "archived";

  const handleRename = () => {
    if (!access.canWriteProjects) {
      toast.error(t.agents.permissionRequired(PERMISSIONS.PROJECTS_WRITE));
      return;
    }
    if (!canSave) {
      return;
    }
    patchProject.mutate(
      { projectId: project.id, input: { name: trimmedName } },
      {
        onError: () => {
          // 仅显示产品文案；API detail 会包含实现信息，不属于用户提示契约。
          toast.error(t.projects.renameFailed);
        },
      },
    );
  };

  const handleArchiveToggle = () => {
    if (!access.canWriteProjects) {
      toast.error(t.agents.permissionRequired(PERMISSIONS.PROJECTS_WRITE));
      return;
    }
    const mutation = isArchived ? restoreProject : archiveProject;
    const fallback = isArchived
      ? t.projects.restoreFailed
      : t.projects.archiveFailed;
    mutation.mutate(project.id, {
      onError: () => {
        toast.error(fallback);
      },
    });
  };

  const handleDelete = () => {
    if (!access.canDeleteProjects) {
      toast.error(t.agents.permissionRequired(PERMISSIONS.PROJECTS_DELETE));
      return;
    }
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        router.push("/workspace/chats");
      },
      onError: () => {
        toast.error(t.projects.deleteFailed);
      },
    });
  };

  return (
    <section className="flex flex-col gap-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t.projects.settings}</h2>
        <p className="text-muted-foreground text-sm">
          {t.projects.settingsSummary}
        </p>
      </header>
      {missingSettingsPermissions.length > 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t.agents.permissionActionsLimited(
            missingSettingsPermissions.join(", "),
          )}
        </p>
      ) : null}

      <div className="bg-card rounded-xl border p-4 sm:p-6">
        <div className="space-y-1">
          <h3 className="font-semibold">{t.projects.projectDetailsTitle}</h3>
          <p className="text-muted-foreground text-sm">
            {t.projects.projectDetailsDescription}
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <label
              htmlFor="project-name-input"
              className="text-muted-foreground text-sm font-medium"
            >
              {t.projects.namePlaceholder}
            </label>
            <Input
              id="project-name-input"
              disabled={!access.canWriteProjects}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.projects.namePlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isIMEComposing(e)) {
                  e.preventDefault();
                  handleRename();
                }
              }}
            />
          </div>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            disabled={!canSave}
            onClick={handleRename}
          >
            {t.common.save}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border p-4 sm:p-6">
        <div className="space-y-1">
          <h3 className="font-semibold">{t.projects.lifecycleTitle}</h3>
          <p className="text-muted-foreground text-sm">
            {t.projects.lifecycleDescription}
          </p>
        </div>
        <div className="mt-5">
          {access.canWriteProjects ? (
            <Button
              variant="outline"
              disabled={archiveProject.isPending || restoreProject.isPending}
              onClick={handleArchiveToggle}
            >
              {isArchived ? <RotateCcw /> : <Archive />}
              {isArchived ? t.projects.restore : t.projects.archive}
            </Button>
          ) : null}
        </div>
      </div>

      {access.canDeleteProjects ? (
        <div className="border-destructive/20 bg-destructive/5 rounded-xl border p-4 sm:p-6">
          <div className="space-y-1">
            <h3 className="font-semibold">{t.projects.deleteProject}</h3>
            <p className="text-muted-foreground text-sm">
              {t.projects.deleteProjectConfirm}
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              className="w-full sm:w-auto"
              variant="destructive"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <Trash2 />
              {t.projects.deleteProject}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          // 删除请求已经交给 Gateway 后，关闭弹窗不会取消操作。
          if (!open && deleteProject.isPending) return;
          setIsDeleteDialogOpen(open);
        }}
      >
        <DialogContent
          className="sm:max-w-[425px]"
          showCloseButton={!deleteProject.isPending}
          aria-busy={deleteProject.isPending}
          onEscapeKeyDown={(event) => {
            if (deleteProject.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deleteProject.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.projects.deleteProject}</DialogTitle>
            <DialogDescription>
              {t.projects.deleteProjectConfirm}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteProject.isPending}
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteProject.isPending}
              onClick={handleDelete}
            >
              {deleteProject.isPending ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ProjectInstructionsSection({
  project,
  projectsConfig,
}: {
  project: Project;
  projectsConfig?: ProjectsConfig;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canWriteProject = hasPermission(user, PERMISSIONS.PROJECTS_WRITE);
  const patchProject = usePatchProject();
  // The gateway enforces ``projects.instructions_max_bytes`` with a 422, so
  // the editor blocks the save before the round trip; while the config
  // endpoint is unavailable (older gateway), fall back to the server
  // default and keep the 422 as the guard of last resort.
  const maxBytes =
    projectsConfig?.instructions_max_bytes ??
    PROJECTS_CONFIG_DEFAULT.instructions_max_bytes;
  const [instructions, setInstructions] = useState(project.instructions);
  // Last server value the draft was synced from. The section is keyed on
  // the project id (not updated_at), so a save's refetch does not remount
  // the editor; instead this effect reconciles: overwrite the draft ONLY
  // while it still equals the last-synced value (the user has not typed
  // since). A diverged draft is kept and the server value becomes the new
  // baseline for future comparisons.
  const lastSyncedRef = useRef(project.instructions);
  useEffect(() => {
    const serverValue = project.instructions;
    const synced = lastSyncedRef.current;
    lastSyncedRef.current = serverValue;
    setInstructions((current) => (current === synced ? serverValue : current));
  }, [project.instructions]);

  useEffect(() => {
    if (!canWriteProject) {
      lastSyncedRef.current = project.instructions;
      setInstructions(project.instructions);
    }
  }, [canWriteProject, project.instructions]);

  const byteCount = utf8ByteLength(instructions);
  const overCap = byteCount > maxBytes;
  const isDirty = instructions !== project.instructions;
  const canSave =
    canWriteProject && isDirty && !overCap && !patchProject.isPending;
  const showSaved = patchProject.isSuccess && !isDirty;

  const handleSave = () => {
    if (!canWriteProject) {
      toast.error(t.agents.permissionRequired(PERMISSIONS.PROJECTS_WRITE));
      return;
    }
    if (!canSave) {
      return;
    }
    patchProject.mutate(
      { projectId: project.id, input: { instructions } },
      {
        onError: (error) => {
          // Gateway 对指令长度使用 422；详情仍只作为内部诊断，不直接展示。
          toast.error(
            hasHTTPStatus(error, 422)
              ? t.projects.instructionsTooLong(maxBytes)
              : t.projects.instructionsSaveFailed,
          );
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <label
        htmlFor="project-instructions-input"
        className="text-muted-foreground text-xs"
      >
        {t.projects.instructions}
      </label>
      <Textarea
        id="project-instructions-input"
        className="min-h-40"
        disabled={!canWriteProject}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder={t.projects.instructionsPlaceholder}
        aria-invalid={overCap}
      />
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn(
            "text-xs",
            overCap ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {t.projects.instructionsByteCount(byteCount, maxBytes)}
        </p>
        <div className="flex items-center gap-2">
          {showSaved && (
            <span role="status" className="text-muted-foreground text-xs">
              {t.projects.instructionsSaved}
            </span>
          )}
          <Button variant="outline" disabled={!canSave} onClick={handleSave}>
            {t.common.save}
          </Button>
        </div>
      </div>
      {!canWriteProject ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t.agents.permissionRequired(PERMISSIONS.PROJECTS_WRITE)}
        </p>
      ) : null}
      {overCap && (
        <p role="alert" className="text-destructive text-xs">
          {t.projects.instructionsTooLong(maxBytes)}
        </p>
      )}
    </section>
  );
}
