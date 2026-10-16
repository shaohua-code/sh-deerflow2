"use client";

import { CopyIcon, TriangleAlertIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ScheduledTaskScheduleInput,
  type ScheduleValue,
} from "@/components/workspace/scheduled-task-schedule-input";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useAgents, useAgentsApiEnabled } from "@/core/agents/hooks";
import { useAuth } from "@/core/auth/AuthProvider";
import { getMissingPermissions, PERMISSIONS } from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";
import { hasScheduleSpec } from "@/core/scheduled-tasks/cron";
import {
  useCreateScheduledTask,
  useUpdateScheduledTask,
  useDeleteScheduledTask,
  usePauseScheduledTask,
  useResumeScheduledTask,
  useScheduledTasks,
  useTriggerScheduledTask,
  useThreadScheduledTasks,
} from "@/core/scheduled-tasks/hooks";
import { RECIPES, type Recipe } from "@/core/scheduled-tasks/recipes";
import { useScheduledTaskRunHistory } from "@/core/scheduled-tasks/run-history";
import { getScheduledTaskPermissionAccess } from "@/core/scheduled-tasks/permissions";
import type {
  ScheduledTask,
  ScheduledTaskRun,
} from "@/core/scheduled-tasks/types";
import { cn } from "@/lib/utils";

const NONE = "—";

function ReuseThreadNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Alert className="border-amber-500/50 bg-amber-500/10">
      <TriangleAlertIcon className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

function formatTimestamp(value: string | null, locale: string): string {
  if (!value) {
    return NONE;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  // Use a locale-aware short format like "2026-07-03 09:00". Future timestamps
  // (next_run_at) render as an absolute time, not a relative "ago" string.
  const intlLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(intlLocale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const DEFAULT_ASSISTANT_ID = "lead_agent";

function agentDisplayName(
  assistantId: string | null | undefined,
  leadLabel: string,
): string {
  if (!assistantId || assistantId === DEFAULT_ASSISTANT_ID) {
    return leadLabel;
  }
  return assistantId;
}

export default function ScheduledTasksPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const access = getScheduledTaskPermissionAccess(user);
  const st = t.scheduledTasks;
  const searchParams = useSearchParams();
  const threadId = searchParams.get("thread_id");
  const allTasksQuery = useScheduledTasks({ enabled: access.canReadTasks });
  const threadTasksQuery = useThreadScheduledTasks(threadId, {
    enabled: access.canReadTasks,
  });
  const { enabled: agentsApiEnabled, isLoading: agentsApiLoading } =
    useAgentsApiEnabled();
  const agentsQuery = useAgents(
    !agentsApiLoading && agentsApiEnabled && access.canReadAgents,
  );
  // 复用 Agent 域 hook 的 signal 与撤权缓存清理，选择器只读已授权目录。
  const visibleAgents =
    access.canReadAgents && agentsApiEnabled ? agentsQuery.agents : undefined;
  const tasksQuery = threadId ? threadTasksQuery : allTasksQuery;
  const data = tasksQuery.data;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<
    "fresh_thread_per_run" | "reuse_thread"
  >(threadId ? "reuse_thread" : "fresh_thread_per_run");
  const [targetThreadId, setTargetThreadId] = useState(threadId ?? "");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [createAssistantId, setCreateAssistantId] =
    useState(DEFAULT_ASSISTANT_ID);
  const [createSchedule, setCreateSchedule] = useState<ScheduleValue>({
    schedule_type: "cron",
    schedule_spec: { cron: "0 9 * * *" },
    timezone: "",
  });
  const [statusFilter, setStatusFilter] = useState<
    "all" | "enabled" | "paused" | "running" | "completed" | "failed"
  >("all");
  const [typeFilter, setTypeFilter] = useState<
    "all" | "once" | "cron" | "interval"
  >("all");
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editAssistantId, setEditAssistantId] = useState(DEFAULT_ASSISTANT_ID);
  const [editSchedule, setEditSchedule] = useState<ScheduleValue>({
    schedule_type: "cron",
    schedule_spec: { cron: "0 9 * * *" },
    timezone: "UTC",
  });
  const [createNonce, setCreateNonce] = useState(0);
  const createFormRef = useRef<HTMLDivElement>(null);
  const createTitleRef = useRef<HTMLInputElement>(null);
  const agentOptions = useMemo(() => {
    const agents = visibleAgents ?? [];
    const names = new Set(agents.map((agent) => agent.name));
    const options = [
      {
        value: DEFAULT_ASSISTANT_ID,
        label: st.create.leadAgent,
      },
      ...agents
        .filter((agent) => agent.name !== DEFAULT_ASSISTANT_ID)
        .map((agent) => ({ value: agent.name, label: agent.name })),
    ];
    for (const extra of [createAssistantId, editAssistantId]) {
      if (extra && extra !== DEFAULT_ASSISTANT_ID && !names.has(extra)) {
        options.push({ value: extra, label: extra });
        names.add(extra);
      }
    }
    return options;
  }, [visibleAgents, createAssistantId, editAssistantId, st.create.leadAgent]);
  const filteredData = (data ?? []).filter((task) => {
    const statusPass = statusFilter === "all" || task.status === statusFilter;
    const typePass = typeFilter === "all" || task.schedule_type === typeFilter;
    return statusPass && typePass;
  });
  const selectedTask =
    filteredData.find((task) => task.id === selectedTaskId) ?? filteredData[0];
  const taskRunsQuery = useScheduledTaskRunHistory(selectedTask?.id, {
    enabled: access.canReadRunHistory,
  });
  const createTask = useCreateScheduledTask();
  const updateTask = useUpdateScheduledTask(selectedTask?.id ?? "");
  const pauseTask = usePauseScheduledTask();
  const resumeTask = useResumeScheduledTask();
  const triggerTask = useTriggerScheduledTask();
  const deleteTask = useDeleteScheduledTask();
  const ensurePermissions = (
    required: Parameters<typeof getMissingPermissions>[1],
  ) => {
    const missing = getMissingPermissions(user, required);
    const firstMissing = missing[0];
    if (firstMissing) {
      toast.error(t.agents.permissionRequired(firstMissing));
      return false;
    }
    return missing.length === 0;
  };

  useEffect(() => {
    if (!access.canReuseThread && contextMode === "reuse_thread") {
      setContextMode("fresh_thread_per_run");
      setTargetThreadId("");
    }
    if (!access.canCreateTask && !createTask.isPending) {
      setTitle("");
      setPrompt("");
      setTargetThreadId("");
      setCreateAssistantId(DEFAULT_ASSISTANT_ID);
      setContextMode("fresh_thread_per_run");
      setCreateSchedule({
        schedule_type: "cron",
        schedule_spec: { cron: "0 9 * * *" },
        timezone: "",
      });
      setFormError(null);
      setCreateNonce((nonce) => nonce + 1);
    }
    if (!access.canUpdateTask && !updateTask.isPending) {
      setEditing(false);
      setEditTitle("");
      setEditPrompt("");
    }
    if (
      (!access.canDeleteTask || !access.canReadTasks) &&
      !deleteTask.isPending
    ) {
      setDeleteOpen(false);
    }
  }, [
    access.canCreateTask,
    access.canDeleteTask,
    access.canReadTasks,
    access.canReuseThread,
    access.canUpdateTask,
    contextMode,
    createTask.isPending,
    deleteTask.isPending,
    updateTask.isPending,
  ]);

  const scheduleTypeLabel = (v: string) =>
    v === "cron"
      ? st.scheduleType.cron
      : v === "once"
        ? st.scheduleType.once
        : v === "interval"
          ? st.scheduleType.interval
          : v;
  const statusLabel = (v: string) =>
    (st.status as Record<string, string>)[v] ?? v;
  const contextModeLabel = (v: string) =>
    v === "fresh_thread_per_run"
      ? st.context.fresh
      : v === "reuse_thread"
        ? st.context.reuse
        : v;
  const runTriggerLabel = (v: string) =>
    (st.runTrigger as Record<string, string>)[v] ?? v;
  const runStatusLabel = (v: string) =>
    (st.runStatus as Record<string, string>)[v] ?? v;
  const taskSummary = (task: ScheduledTask) =>
    `${scheduleTypeLabel(task.schedule_type)} · ${statusLabel(task.status)}`;
  const runSummary = (run: ScheduledTaskRun) =>
    `${runTriggerLabel(run.trigger)} · ${runStatusLabel(run.status)}`;
  const applyRecipe = (recipe: Recipe) => {
    const labels = st.recipes[recipe.titleKey];
    setTitle(labels.title);
    setPrompt(recipe.prompt);
    setCreateSchedule(recipe.schedule);
    setContextMode("fresh_thread_per_run");
    setCreateNonce((n) => n + 1);
  };
  const duplicateTask = (task: ScheduledTask) => {
    if (
      !ensurePermissions([PERMISSIONS.THREADS_WRITE, PERMISSIONS.RUNS_CREATE])
    ) {
      return;
    }
    const reuseThread =
      access.canReuseThread && task.context_mode === "reuse_thread";
    setTitle(`${task.title}${st.actions.duplicateTitleSuffix}`);
    setPrompt(task.prompt);
    setContextMode(reuseThread ? "reuse_thread" : "fresh_thread_per_run");
    setTargetThreadId(reuseThread ? (task.thread_id ?? "") : "");
    setCreateAssistantId(task.assistant_id ?? DEFAULT_ASSISTANT_ID);
    setCreateSchedule({
      schedule_type: task.schedule_type,
      schedule_spec: { ...task.schedule_spec },
      timezone: task.timezone,
    });
    setFormError(null);
    setCreateNonce((nonce) => nonce + 1);
    createFormRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    createTitleRef.current?.focus();
  };

  useEffect(() => {
    document.title = `${t.sidebar.scheduledTasks} - ${t.pages.appName}`;
  }, [t.pages.appName, t.sidebar.scheduledTasks]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    const stillVisible = filteredData.some(
      (task) => task.id === selectedTaskId,
    );
    if (!stillVisible) {
      setSelectedTaskId(filteredData[0]?.id ?? null);
      setEditing(false);
    }
  }, [filteredData, selectedTaskId]);

  useEffect(() => {
    if (!selectedTask) {
      setEditing(false);
      return;
    }
    setEditTitle(selectedTask.title);
    setEditPrompt(selectedTask.prompt);
    setEditAssistantId(selectedTask.assistant_id ?? DEFAULT_ASSISTANT_ID);
    const spec = selectedTask.schedule_spec as {
      cron?: string;
      run_at?: string;
      every_seconds?: number;
    };
    setEditSchedule({
      schedule_type: selectedTask.schedule_type,
      schedule_spec: {
        cron: typeof spec.cron === "string" ? spec.cron : undefined,
        run_at: typeof spec.run_at === "string" ? spec.run_at : undefined,
        every_seconds:
          typeof spec.every_seconds === "number"
            ? spec.every_seconds
            : undefined,
      },
      timezone: selectedTask.timezone || "UTC",
    });
    // Depend on id only so a background refetch (same task, new object reference)
    // does not wipe edits in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask?.id]);

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody>
        <div className="mx-auto flex w-full max-w-(--container-width-md) flex-col gap-4 p-6">
          <h1 className="text-2xl font-semibold">{t.sidebar.scheduledTasks}</h1>
          {!access.canReadTasks && (
            <p role="status" className="text-muted-foreground text-sm">
              {t.agents.permissionActionsLimited(
                getMissingPermissions(user, [PERMISSIONS.THREADS_READ]).join(
                  ", ",
                ),
              )}
            </p>
          )}
          {access.canReadTasks &&
            getMissingPermissions(user, [
              PERMISSIONS.THREADS_WRITE,
              PERMISSIONS.RUNS_CREATE,
              PERMISSIONS.THREADS_DELETE,
            ]).length > 0 && (
              <p role="status" className="text-muted-foreground text-sm">
                {t.agents.permissionActionsLimited(
                  getMissingPermissions(user, [
                    PERMISSIONS.THREADS_WRITE,
                    PERMISSIONS.RUNS_CREATE,
                    PERMISSIONS.THREADS_DELETE,
                  ]).join(", "),
                )}
              </p>
            )}
          {access.canCreateTask ? (
            <div
              ref={createFormRef}
              className="grid gap-2 rounded-lg border p-4"
              data-testid="scheduled-task-create-form"
            >
              <div className="font-medium">{st.create.title}</div>
              <div
                className="flex flex-wrap items-center gap-1"
                data-testid="schedule-recipes"
              >
                <span className="text-muted-foreground text-sm">
                  {st.recipes.label}:
                </span>
                {RECIPES.map((recipe) => (
                  <Button
                    key={recipe.id}
                    variant="outline"
                    size="sm"
                    onClick={() => applyRecipe(recipe)}
                  >
                    <span aria-hidden>{recipe.icon}</span>
                    {st.recipes[recipe.titleKey].title}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant={
                    contextMode === "fresh_thread_per_run"
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => setContextMode("fresh_thread_per_run")}
                >
                  {st.context.fresh}
                </Button>
                {access.canReuseThread ? (
                  <Button
                    variant={
                      contextMode === "reuse_thread" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setContextMode("reuse_thread")}
                  >
                    {st.context.reuse}
                  </Button>
                ) : null}
              </div>
              {access.canReuseThread && contextMode === "reuse_thread" && (
                <>
                  <Input
                    value={targetThreadId}
                    onChange={(event) => setTargetThreadId(event.target.value)}
                    placeholder={st.context.threadIdPlaceholder}
                    aria-label={st.context.threadIdPlaceholder}
                  />
                  <ReuseThreadNotice
                    title={st.context.reuseNoticeTitle}
                    description={st.context.reuseNoticeDescription}
                  />
                </>
              )}
              <Select
                value={createAssistantId}
                onValueChange={setCreateAssistantId}
              >
                <SelectTrigger
                  className="w-full"
                  data-testid="scheduled-task-create-agent"
                  aria-label={st.create.agent}
                >
                  <SelectValue placeholder={st.create.agent} />
                </SelectTrigger>
                <SelectContent>
                  {agentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                ref={createTitleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={st.create.taskTitle}
                aria-label={st.create.taskTitle}
              />
              <Textarea
                rows={4}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={st.create.prompt}
                aria-label={st.create.prompt}
              />
              <ScheduledTaskScheduleInput
                key={createNonce}
                initial={createSchedule}
                onChange={setCreateSchedule}
              />
              {formError && (
                <div className="text-destructive text-sm">{formError}</div>
              )}
              <Button
                onClick={() => {
                  if (
                    !ensurePermissions([
                      PERMISSIONS.THREADS_WRITE,
                      PERMISSIONS.RUNS_CREATE,
                    ])
                  ) {
                    return;
                  }
                  const reuseThread =
                    access.canReuseThread && contextMode === "reuse_thread";
                  if (
                    reuseThread &&
                    !ensurePermissions([PERMISSIONS.THREADS_READ])
                  ) {
                    return;
                  }
                  const hasSchedule = hasScheduleSpec(
                    createSchedule.schedule_spec,
                  );
                  if (
                    !title ||
                    !prompt ||
                    !hasSchedule ||
                    (reuseThread && !targetThreadId)
                  ) {
                    setFormError(st.create.fillRequired);
                    return;
                  }
                  setFormError(null);
                  createTask.mutate(
                    {
                      context_mode: reuseThread
                        ? "reuse_thread"
                        : "fresh_thread_per_run",
                      thread_id: reuseThread ? targetThreadId : null,
                      assistant_id: createAssistantId,
                      title,
                      prompt,
                      schedule_type: createSchedule.schedule_type,
                      schedule_spec: createSchedule.schedule_spec,
                      timezone: createSchedule.timezone || "UTC",
                    },
                    {
                      onSuccess: () => {
                        toast.success(st.create.success);
                        // Clear the form so a follow-up task starts fresh.
                        setTitle("");
                        setPrompt("");
                        setTargetThreadId("");
                        setCreateAssistantId(DEFAULT_ASSISTANT_ID);
                        setContextMode("fresh_thread_per_run");
                        setCreateSchedule({
                          schedule_type: "cron",
                          schedule_spec: { cron: "0 9 * * *" },
                          timezone: "",
                        });
                        setCreateNonce((n) => n + 1);
                      },
                    },
                  );
                }}
                disabled={
                  !title ||
                  !prompt ||
                  !hasScheduleSpec(createSchedule.schedule_spec) ||
                  (access.canReuseThread &&
                    contextMode === "reuse_thread" &&
                    !targetThreadId) ||
                  createTask.isPending
                }
              >
                {st.create.submit}
              </Button>
            </div>
          ) : access.canReadTasks ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t.agents.permissionActionsLimited(
                getMissingPermissions(user, [
                  PERMISSIONS.THREADS_WRITE,
                  PERMISSIONS.RUNS_CREATE,
                ]).join(", "),
              )}
            </p>
          ) : null}
          {threadId && (
            <div className="text-muted-foreground text-sm">
              {st.detail.filteredByThread.replace("{id}", threadId)}
            </div>
          )}
          {access.canReadTasks && tasksQuery.isError && (
            <div
              className="flex flex-col items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid="scheduled-task-load-error"
              role="alert"
            >
              <div className="flex items-start gap-3">
                <TriangleAlertIcon
                  className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <p className="text-sm">
                  {data === undefined
                    ? st.detail.loadFailed
                    : st.detail.refreshFailed}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={tasksQuery.isFetching}
                onClick={() => void tasksQuery.refetch()}
              >
                {tasksQuery.isFetching ? st.detail.retrying : st.detail.retry}
              </Button>
            </div>
          )}
          {access.canReadTasks ? (
            <>
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={st.filters.statusLabel}
                >
                  <span className="text-muted-foreground w-full text-xs font-medium sm:w-auto">
                    {st.filters.statusLabel}
                  </span>
                  <Button
                    variant={statusFilter === "all" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={statusFilter === "all"}
                    onClick={() => setStatusFilter("all")}
                  >
                    {st.filters.allStatuses}
                  </Button>
                  <Button
                    variant={statusFilter === "enabled" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={statusFilter === "enabled"}
                    onClick={() => setStatusFilter("enabled")}
                  >
                    {st.filters.enabled}
                  </Button>
                  <Button
                    variant={statusFilter === "paused" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={statusFilter === "paused"}
                    onClick={() => setStatusFilter("paused")}
                  >
                    {st.filters.paused}
                  </Button>
                  <Button
                    variant={
                      statusFilter === "completed" ? "default" : "outline"
                    }
                    size="sm"
                    aria-pressed={statusFilter === "completed"}
                    onClick={() => setStatusFilter("completed")}
                  >
                    {st.filters.completed}
                  </Button>
                  <Button
                    variant={statusFilter === "failed" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={statusFilter === "failed"}
                    onClick={() => setStatusFilter("failed")}
                  >
                    {st.filters.failed}
                  </Button>
                </div>
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={st.filters.typeLabel}
                >
                  <span className="text-muted-foreground w-full text-xs font-medium sm:w-auto">
                    {st.filters.typeLabel}
                  </span>
                  <Button
                    variant={typeFilter === "all" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={typeFilter === "all"}
                    onClick={() => setTypeFilter("all")}
                  >
                    {st.filters.allTypes}
                  </Button>
                  <Button
                    variant={typeFilter === "cron" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={typeFilter === "cron"}
                    onClick={() => setTypeFilter("cron")}
                  >
                    {st.filters.cron}
                  </Button>
                  <Button
                    variant={typeFilter === "once" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={typeFilter === "once"}
                    onClick={() => setTypeFilter("once")}
                  >
                    {st.filters.once}
                  </Button>
                  <Button
                    variant={typeFilter === "interval" ? "default" : "outline"}
                    size="sm"
                    aria-pressed={typeFilter === "interval"}
                    onClick={() => setTypeFilter("interval")}
                  >
                    {st.filters.interval}
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div
                  data-testid="scheduled-task-list"
                  className="flex flex-col gap-3"
                >
                  {/* 区分正在加载、加载失败、成功但为空，避免列表空白被误认为没有任务。 */}
                  {tasksQuery.isPending && data === undefined ? (
                    <div
                      className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm"
                      role="status"
                    >
                      {st.detail.loading}
                    </div>
                  ) : tasksQuery.isError &&
                    data === undefined ? null : filteredData.length === 0 ? (
                    <div
                      className="text-muted-foreground rounded-xl border border-dashed p-6 text-center"
                      role="status"
                    >
                      <p className="text-sm">
                        {data && data.length > 0
                          ? st.detail.noFilterResults
                          : st.detail.empty}
                      </p>
                      {data && data.length > 0 && (
                        <Button
                          className="mt-3"
                          variant="link"
                          size="sm"
                          onClick={() => {
                            setStatusFilter("all");
                            setTypeFilter("all");
                          }}
                        >
                          {st.filters.clearFilters}
                        </Button>
                      )}
                    </div>
                  ) : (
                    filteredData.map((task) => {
                      const isSelected = selectedTask?.id === task.id;
                      return (
                        <button
                          type="button"
                          key={task.id}
                          onClick={() => setSelectedTaskId(task.id)}
                          data-testid={`scheduled-task-item-${task.id}`}
                          className={cn(
                            "rounded-lg border p-4 text-left",
                            isSelected ? "border-foreground" : "border-border",
                          )}
                        >
                          <div className="font-medium">{task.title}</div>
                          <div className="text-muted-foreground text-sm">
                            {taskSummary(task)}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                <div
                  className="rounded-lg border p-4"
                  data-testid="scheduled-task-detail"
                >
                  {selectedTask ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-lg font-semibold">
                          {selectedTask.title}
                        </div>
                        {access.canUpdateTask ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing((value) => !value)}
                          >
                            {editing ? st.actions.cancelEdit : st.actions.edit}
                          </Button>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {st.detail.contextMode}:{" "}
                        {contextModeLabel(selectedTask.context_mode)}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {st.detail.agent}:{" "}
                        {agentDisplayName(
                          selectedTask.assistant_id,
                          st.create.leadAgent,
                        )}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {selectedTask.context_mode === "reuse_thread"
                          ? `${st.detail.thread}: ${selectedTask.thread_id ?? NONE}`
                          : `${st.detail.lastThread}: ${selectedTask.last_thread_id ?? NONE}`}
                      </div>
                      {selectedTask.context_mode === "reuse_thread" && (
                        <ReuseThreadNotice
                          title={st.context.reuseNoticeTitle}
                          description={st.context.reuseNoticeDescription}
                        />
                      )}
                      <div className="text-muted-foreground text-sm">
                        {st.detail.schedule}:{" "}
                        {scheduleTypeLabel(selectedTask.schedule_type)}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {st.detail.nextRun}:{" "}
                        {formatTimestamp(selectedTask.next_run_at, locale)}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {st.detail.lastRun}:{" "}
                        {formatTimestamp(selectedTask.last_run_at, locale)}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {st.detail.lastRunId}:{" "}
                        {selectedTask.last_run_id ?? NONE}
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {st.detail.lastError}: {selectedTask.last_error ?? NONE}
                      </div>
                      {editing && access.canUpdateTask ? (
                        <div className="flex flex-col gap-2 rounded-lg border p-3">
                          <Input
                            value={editTitle}
                            onChange={(event) =>
                              setEditTitle(event.target.value)
                            }
                            placeholder={st.edit.titlePlaceholder}
                            aria-label={st.edit.titlePlaceholder}
                          />
                          <Textarea
                            rows={4}
                            value={editPrompt}
                            onChange={(event) =>
                              setEditPrompt(event.target.value)
                            }
                            placeholder={st.edit.promptPlaceholder}
                            aria-label={st.edit.promptPlaceholder}
                          />
                          <Select
                            value={editAssistantId}
                            onValueChange={setEditAssistantId}
                          >
                            <SelectTrigger
                              className="w-full"
                              data-testid="scheduled-task-edit-agent"
                              aria-label={st.create.agent}
                            >
                              <SelectValue placeholder={st.create.agent} />
                            </SelectTrigger>
                            <SelectContent>
                              {agentOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <ScheduledTaskScheduleInput
                            key={selectedTask.id}
                            initial={editSchedule}
                            onChange={setEditSchedule}
                            scheduleTypeLocked
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              if (
                                !ensurePermissions([
                                  PERMISSIONS.THREADS_WRITE,
                                  PERMISSIONS.RUNS_CREATE,
                                ])
                              ) {
                                return;
                              }
                              const pinned =
                                selectedTask.assistant_id ??
                                DEFAULT_ASSISTANT_ID;
                              updateTask.mutate({
                                title: editTitle,
                                prompt: editPrompt,
                                ...(editAssistantId !== pinned
                                  ? { assistant_id: editAssistantId }
                                  : {}),
                                schedule_spec: editSchedule.schedule_spec,
                                timezone: editSchedule.timezone || "UTC",
                              });
                            }}
                            disabled={updateTask.isPending}
                          >
                            {st.edit.submit}
                          </Button>
                        </div>
                      ) : (
                        <div className="text-sm">{selectedTask.prompt}</div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {selectedTask.status === "paused" ? (
                          access.canResumeTask ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (
                                  ensurePermissions([
                                    PERMISSIONS.THREADS_WRITE,
                                    PERMISSIONS.RUNS_CREATE,
                                  ])
                                ) {
                                  resumeTask.mutate(selectedTask.id);
                                }
                              }}
                            >
                              {st.actions.resume}
                            </Button>
                          ) : null
                        ) : access.canPauseTask ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (
                                ensurePermissions([PERMISSIONS.THREADS_WRITE])
                              ) {
                                pauseTask.mutate(selectedTask.id);
                              }
                            }}
                          >
                            {st.actions.pause}
                          </Button>
                        ) : null}
                        {access.canTriggerTask ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (
                                ensurePermissions([
                                  PERMISSIONS.THREADS_WRITE,
                                  PERMISSIONS.RUNS_CREATE,
                                ])
                              ) {
                                triggerTask.mutate(selectedTask.id);
                              }
                            }}
                          >
                            {st.actions.trigger}
                          </Button>
                        ) : null}
                        {access.canCreateTask ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (
                                ensurePermissions([
                                  PERMISSIONS.THREADS_WRITE,
                                  PERMISSIONS.RUNS_CREATE,
                                ])
                              ) {
                                duplicateTask(selectedTask);
                              }
                            }}
                          >
                            <CopyIcon />
                            {st.actions.duplicate}
                          </Button>
                        ) : null}
                        {access.canDeleteTask ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                ensurePermissions([PERMISSIONS.THREADS_DELETE])
                              ) {
                                setDeleteOpen(true);
                              }
                            }}
                          >
                            {st.actions.delete}
                          </Button>
                        ) : null}
                      </div>
                      {access.canReadRunHistory ? (
                        <>
                          <nav
                            aria-label={st.history.navigation}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                taskRunsQuery.page === 0 ||
                                taskRunsQuery.isFetching
                              }
                              onClick={taskRunsQuery.newer}
                            >
                              {st.history.newer}
                            </Button>
                            <span className="text-muted-foreground text-sm">
                              {st.history.page.replace(
                                "{page}",
                                String(taskRunsQuery.page + 1),
                              )}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                !taskRunsQuery.hasOlder ||
                                taskRunsQuery.isFetching
                              }
                              onClick={taskRunsQuery.older}
                            >
                              {st.history.older}
                            </Button>
                            {taskRunsQuery.page > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={taskRunsQuery.latest}
                              >
                                {st.history.latest}
                              </Button>
                            )}
                          </nav>
                          {taskRunsQuery.page > 0 && (
                            <p className="text-muted-foreground text-xs">
                              {st.history.paused}
                            </p>
                          )}
                          {taskRunsQuery.isPending && (
                            <p role="status">{st.history.loading}</p>
                          )}
                          {taskRunsQuery.isError && (
                            <div role="alert">
                              <p>{st.history.loadFailed}</p>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={taskRunsQuery.isFetching}
                                onClick={() => void taskRunsQuery.refetch()}
                              >
                                {st.history.retry}
                              </Button>
                            </div>
                          )}
                          {!taskRunsQuery.isPending &&
                            !taskRunsQuery.isError && (
                              <div data-testid="scheduled-task-runs">
                                {(taskRunsQuery.data ?? []).length === 1
                                  ? st.detail.runsCountOne.replace(
                                      "{count}",
                                      String((taskRunsQuery.data ?? []).length),
                                    )
                                  : st.detail.runsCount.replace(
                                      "{count}",
                                      String((taskRunsQuery.data ?? []).length),
                                    )}
                              </div>
                            )}
                          <div
                            className="flex flex-col gap-2"
                            data-testid="scheduled-task-run-list"
                          >
                            {(taskRunsQuery.data ?? []).length > 0 ? (
                              (taskRunsQuery.data ?? []).map((run) => (
                                <div
                                  key={run.id}
                                  className="rounded-md border p-3 text-sm"
                                >
                                  <div className="font-medium">
                                    {runSummary(run)}
                                  </div>
                                  <div className="text-muted-foreground text-xs">
                                    {run.run_id ?? NONE}
                                  </div>
                                  <div className="text-muted-foreground text-xs">
                                    {formatTimestamp(run.scheduled_for, locale)}
                                  </div>
                                  {run.error && (
                                    <div className="text-destructive text-xs">
                                      {run.error}
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : !taskRunsQuery.isPending &&
                              !taskRunsQuery.isError ? (
                              <div className="text-muted-foreground text-sm">
                                {st.detail.noRuns}
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <p
                          role="status"
                          className="text-muted-foreground text-sm"
                        >
                          {t.agents.permissionActionsLimited(
                            getMissingPermissions(user, [
                              PERMISSIONS.RUNS_READ,
                              PERMISSIONS.THREADS_READ,
                            ]).join(", "),
                          )}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-sm">
                      {st.detail.noSelection}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </WorkspaceBody>

      {/* 删除请求是持久化写操作；提交后锁定弹窗，避免把关闭误解为取消。 */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deleteTask.isPending) return;
          setDeleteOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={!deleteTask.isPending}
          aria-busy={deleteTask.isPending}
          onEscapeKeyDown={(event) => {
            if (deleteTask.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deleteTask.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{st.actions.delete}</DialogTitle>
            <DialogDescription>{st.deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteTask.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (
                  selectedTask &&
                  ensurePermissions([PERMISSIONS.THREADS_DELETE])
                ) {
                  deleteTask.mutate(selectedTask.id, {
                    onSuccess: () => setDeleteOpen(false),
                  });
                }
              }}
              disabled={deleteTask.isPending}
            >
              {deleteTask.isPending ? t.common.loading : st.actions.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceContainer>
  );
}
