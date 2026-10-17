"use client";

import { ChevronDownIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, type User } from "@/core/auth/AuthProvider";
import { getMissingPermissions, PERMISSIONS } from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";
import { isStaticWebsiteOnly } from "@/core/static-mode";
import {
  downloadProductDataJobArtifact,
  ProductDataJobsApiError,
  ProductSettingsApiError,
  type ProductDataJob,
  type ProductDataDeletionScope,
  type ProductDataExportScope,
} from "@/product/api";
import {
  getDataJobFailureReason,
  isRetryableDataJobFailure,
} from "@/product/data-job-failure";
import { getDataJobRequiredPermissions } from "@/product/data-job-permissions";
import {
  clearPendingDataJobSubmission,
  readPendingDataJobSubmission,
  savePendingDataJobSubmission,
  type PendingDataJobSubmission,
} from "@/product/data-job-submission";
import { useProductDataCapabilities } from "@/product/hooks";
import {
  useCancelProductDataJob,
  useCreateProductDataDeletion,
  useCreateProductDataExport,
  useProductDataJobs,
  useProductSettings,
  useSaveProductSetting,
} from "@/product/settings-hooks";

import { SettingsSection } from "./settings-section";
import type { SettingsUnsavedChangesHandler } from "./settings-unsaved-changes";

type Density = "comfortable" | "compact";
const SETTING_KEY = "workspace.display";

function isDensity(value: unknown): value is Density {
  return value === "comfortable" || value === "compact";
}

// 多个布尔状态表示“任一条件阻止操作”；这里需要 OR 语义，不能用 ?? 合并。
function hasBlockingCondition(...conditions: boolean[]) {
  return conditions.some(Boolean);
}

/** 明确拒绝时在按钮层提示，未知权限快照仍兼容旧 Gateway。 */
function getMissingDataJobPermissions(
  user: User | null,
  kind: "export" | "deletion",
  scope: string,
) {
  if (kind === "export") {
    const required = getDataJobRequiredPermissions(
      "export",
      scope as ProductDataExportScope,
    );
    return required ? getMissingPermissions(user, required) : [];
  }
  if (scope === "account") return [];
  const required = getDataJobRequiredPermissions(
    "deletion",
    scope as ProductDataDeletionScope,
  );
  return required ? getMissingPermissions(user, required) : [];
}

export function ProductPreferencesPage({
  onUnsavedChangesChange,
}: {
  onUnsavedChangesChange?: SettingsUnsavedChangesHandler;
} = {}) {
  const { user } = useAuth();

  // 删除确认词和导出草稿属于当前账号；切换身份必须关闭并卸载旧页面状态。
  return (
    <ProductPreferencesContent
      key={user?.id ?? "anonymous"}
      onUnsavedChangesChange={onUnsavedChangesChange}
    />
  );
}

function ProductPreferencesContent({
  onUnsavedChangesChange,
}: {
  onUnsavedChangesChange?: SettingsUnsavedChangesHandler;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const settings = useProductSettings();
  const save = useSaveProductSetting();
  // 服务器值作为默认值；用户改动单独放在草稿状态，避免同步 effect 引发额外渲染。
  const [densityDraft, setDensityDraft] = useState<Density | null>(null);
  const savedValue = settings.data?.settings.find(
    (item) => item.key === SETTING_KEY,
  )?.value;
  const savedDensity = isDensity(savedValue) ? savedValue : "comfortable";
  const density = densityDraft ?? savedDensity;
  const hasUnsavedDensity = density !== savedDensity;
  const resetSave = save.reset;

  useEffect(() => {
    if (!onUnsavedChangesChange) return;
    onUnsavedChangesChange(
      hasUnsavedDensity
        ? {
            isPending: save.isPending,
            discard: () => {
              setDensityDraft(null);
              resetSave();
            },
          }
        : null,
    );
    return () => onUnsavedChangesChange(null);
  }, [hasUnsavedDensity, onUnsavedChangesChange, resetSave, save.isPending]);

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t.settings.productPreferences.title}
        description={t.settings.productPreferences.description}
      >
        <div className="max-w-xl space-y-4">
          {!settings.canRead ? (
            <p role="alert" className="text-destructive text-sm">
              {t.agents.permissionRequired(PERMISSIONS.PREFERENCES_READ)}
            </p>
          ) : settings.isPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t.settings.productPreferences.loading}
            </p>
          ) : settings.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {settings.error instanceof ProductSettingsApiError &&
              settings.error.status === 404
                ? t.settings.productPreferences.extensionMissing
                : t.settings.productPreferences.loadError}
            </p>
          ) : (
            <label className="block space-y-2 text-sm font-medium">
              <span>{t.settings.productPreferences.densityLabel}</span>
              <Select
                value={density}
                disabled={save.isPending || !save.canWrite}
                onValueChange={(value) => {
                  if (save.canWrite && isDensity(value)) {
                    // 新选择属于新的草稿，上一轮保存结果不再描述当前值。
                    save.reset();
                    setDensityDraft(value);
                  }
                }}
              >
                <SelectTrigger
                  aria-label={t.settings.productPreferences.densityLabel}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfortable">
                    {t.settings.productPreferences.comfortable}
                  </SelectItem>
                  <SelectItem value="compact">
                    {t.settings.productPreferences.compact}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={hasBlockingCondition(
                settings.isPending,
                settings.isError,
                save.isPending,
                !settings.canRead,
                !save.canWrite,
                !hasUnsavedDensity,
              )}
              onClick={() =>
                save.mutate(
                  {
                    actorUserId: user?.id ?? null,
                    key: SETTING_KEY,
                    value: density,
                  },
                  { onSuccess: () => setDensityDraft(null) },
                )
              }
            >
              {save.isPending
                ? t.settings.productPreferences.saving
                : t.settings.productPreferences.save}
            </Button>
            {settings.canRead && !save.canWrite && (
              <span role="status" className="text-muted-foreground text-sm">
                {t.agents.permissionRequired(PERMISSIONS.PREFERENCES_WRITE)}
              </span>
            )}
            {hasUnsavedDensity && (
              <span role="status" className="text-muted-foreground text-sm">
                {t.settings.productPreferences.unsaved}
              </span>
            )}
            {save.isSuccess && !hasUnsavedDensity && (
              <span role="status" className="text-muted-foreground text-sm">
                {t.settings.productPreferences.saved}
              </span>
            )}
            {save.isError && (
              <span role="alert" className="text-destructive text-sm">
                {t.settings.productPreferences.saveError}
              </span>
            )}
          </div>
        </div>
      </SettingsSection>
      <PreferenceDataJobs locale={locale} />
    </div>
  );
}

// 统一允许按钮内文字换行，避免窄屏长范围文案溢出。
const DATA_ACTION_BUTTON_CLASS =
  "h-auto min-h-10 justify-start whitespace-normal text-left leading-5";
const DATA_DELETE_BUTTON_CLASS =
  DATA_ACTION_BUTTON_CLASS +
  " border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive";
const DELETE_CONFIRMATIONS: Record<ProductDataDeletionScope, string> = {
  preferences: "DELETE PREFERENCES",
  threads: "DELETE THREAD HISTORY",
  scheduled_tasks: "DELETE SCHEDULED TASKS",
  agents: "DELETE CUSTOM AGENTS",
  projects: "DELETE MY PROJECTS",
  memory: "DELETE MY MEMORY",
  files: "DELETE MY FILES",
};
const DATA_JOBS_PAGE_SIZE = 20;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "retry_wait"]);
// 浏览器和 Node 的单次定时器最多接受约 24.8 天；更久的到期时间需分段等待。
const MAX_TIMEOUT_DELAY_MS = 2_147_000_000;

/**
 * 这是产品偏好数据任务的用户入口，不等同于账号全量导出/擦除。
 * 后端仍逐次按 Gateway principal 做 owner 校验，前端只负责状态展示。
 */
function PreferenceDataJobs({ locale }: { locale: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const missingPermissionsFor = (kind: "export" | "deletion", scope: string) =>
    getMissingDataJobPermissions(user, kind, scope);
  const capabilities = useProductDataCapabilities();
  // 新版 Gateway 用 next_offset 跳过滚动升级产生的旧 NULL 授权行；历史栈用于准确返回上一页。
  const [jobPageOffsets, setJobPageOffsets] = useState([0]);
  const jobOffset = jobPageOffsets[jobPageOffsets.length - 1] ?? 0;
  const jobsQuery = useProductDataJobs(jobOffset);
  // 浏览旧记录时仍读取最新页，避免看不到正在运行的任务并重复提交。
  const latestJobsQuery = useProductDataJobs(0);
  const createExport = useCreateProductDataExport();
  const createDeletion = useCreateProductDataDeletion();
  const cancelJob = useCancelProductDataJob();
  const [deletionDialogOpen, setDeletionDialogOpen] = useState(false);
  const [deletionScope, setDeletionScope] =
    useState<ProductDataDeletionScope>("preferences");
  const [confirmation, setConfirmation] = useState("");
  const [downloadError, setDownloadError] = useState(false);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const activeDownload = useRef<AbortController | null>(null);
  const [submissionStorageState, setSubmissionStorageState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [pendingSubmission, setPendingSubmission] =
    useState<PendingDataJobSubmission | null>(null);
  const pendingSubmissionRef = useRef<PendingDataJobSubmission | null>(null);
  const submissionLock = useRef(false);
  const copy = t.settings.productPreferences;
  const capabilityCopy = {
    loading: copy.capabilityLoading,
    error: copy.capabilityError,
    retry: copy.capabilityRetry,
    unsupported: copy.capabilityUnsupported,
    changed: copy.capabilityChanged,
    staticMode: copy.capabilityStaticMode,
    signedOut: copy.capabilitySignedOut,
  } as const;
  // 缓存存在并不代表本次读取成功；刷新中、刷新失败或未知能力均禁止产生删除意图。
  const capabilitiesReady =
    capabilities.capabilitiesEnabled &&
    capabilities.isSuccess &&
    !capabilities.isFetching &&
    !capabilities.isError &&
    capabilities.data !== undefined;
  const capabilityStatus = !capabilities.capabilitiesEnabled
    ? isStaticWebsiteOnly()
      ? capabilityCopy.staticMode
      : capabilityCopy.signedOut
    : capabilities.isFetching || capabilities.isPending
      ? capabilityCopy.loading
      : capabilities.isError
        ? capabilityCopy.error
        : null;
  const selectedDeletionSupported =
    capabilitiesReady &&
    capabilities.data?.deletion_scopes[deletionScope] === true;
  const selectedDeletionMissingPermissions = missingPermissionsFor(
    "deletion",
    deletionScope,
  );
  const pendingMissingPermissions = pendingSubmission
    ? missingPermissionsFor(pendingSubmission.kind, pendingSubmission.scope)
    : [];
  const jobs = jobsQuery.data?.jobs ?? [];

  useEffect(() => {
    // 用户身份是 sessionStorage 分区边界；读取失败时不生成新键，也不发送写请求。
    pendingSubmissionRef.current = null;
    setPendingSubmission(null);
    setSubmissionStorageState("loading");
    if (!userId) {
      setSubmissionStorageState("unavailable");
      return;
    }
    try {
      const saved = readPendingDataJobSubmission(userId);
      pendingSubmissionRef.current = saved;
      setPendingSubmission(saved);
      setSubmissionStorageState("ready");
    } catch {
      setSubmissionStorageState("unavailable");
    }
  }, [userId]);

  useEffect(
    () => () => {
      // 身份变化会卸载数据任务列表；同时取消旧账号的制品响应，避免迟到后触发下载。
      activeDownload.current?.abort();
      activeDownload.current = null;
    },
    [],
  );
  // 只有 404 能证明当前 Gateway 没有数据任务路由；网络故障不能误报成未启用。
  const dataJobsFeatureNotFound =
    jobsQuery.error instanceof ProductDataJobsApiError &&
    jobsQuery.error.status === 404;
  const hasActiveJob = latestJobsQuery.data?.jobs.some((job) =>
    ACTIVE_JOB_STATUSES.has(job.status),
  );
  const latestActivityUnknown = hasBlockingCondition(
    latestJobsQuery.isPending,
    latestJobsQuery.isError,
  );
  const hasMore =
    jobsQuery.data?.has_more ??
    jobsQuery.data?.jobs.length === DATA_JOBS_PAGE_SIZE;
  const isMutating = hasBlockingCondition(
    createExport.isPending,
    createDeletion.isPending,
    cancelJob.isPending,
  );
  const actionsDisabled = hasBlockingCondition(
    jobsQuery.isPending,
    jobsQuery.isError,
    latestActivityUnknown,
    hasActiveJob === true,
    isMutating,
    submissionStorageState !== "ready",
    pendingSubmission !== null,
  );
  const exportActions: Array<{
    scope: ProductDataExportScope;
    label: string;
    primary?: boolean;
  }> = [
    { scope: "account", label: copy.dataAccountExport, primary: true },
    { scope: "preferences", label: copy.dataExport },
    { scope: "threads", label: copy.dataThreadsExport },
    { scope: "projects", label: copy.dataProjectsExport },
    { scope: "scheduled_tasks", label: copy.dataScheduledTasksExport },
    { scope: "agents", label: copy.dataAgentsExport },
    { scope: "memory", label: copy.dataMemoryExport },
    { scope: "files", label: copy.dataFilesExport },
  ];
  const deletionActions: Array<{
    scope: ProductDataDeletionScope;
    label: string;
  }> = [
    { scope: "threads", label: copy.dataDeleteThreads },
    { scope: "preferences", label: copy.dataDelete },
    { scope: "scheduled_tasks", label: copy.dataDeleteScheduledTasks },
    { scope: "agents", label: copy.dataDeleteAgents },
    { scope: "memory", label: copy.dataDeleteMemory },
    { scope: "projects", label: copy.dataDeleteProjects },
    { scope: "files", label: copy.dataDeleteFiles },
  ];
  const pendingSubmissionLabel = pendingSubmission
    ? pendingSubmission.kind === "deletion"
      ? deletionActions.find(
          (action) => action.scope === pendingSubmission.scope,
        )?.label
      : exportActions.find((action) => action.scope === pendingSubmission.scope)
          ?.label
    : null;

  function openDeletion(scope: ProductDataDeletionScope) {
    // 不先要求用户输入确认词再让服务端报告范围不可用；POST 仍执行最终权限与能力校验。
    if (
      actionsDisabled ||
      !capabilitiesReady ||
      capabilities.data?.deletion_scopes[scope] !== true ||
      missingPermissionsFor("deletion", scope).length > 0
    )
      return;
    setDeletionScope(scope);
    setConfirmation("");
    setDeletionDialogOpen(true);
  }

  function submitDataJob(
    submission: PendingDataJobSubmission,
    callbacks: { onSuccess?: () => void; onError?: () => void } = {},
  ) {
    if (!userId || submissionLock.current) return;
    if (missingPermissionsFor(submission.kind, submission.scope).length > 0) {
      return;
    }
    const saved = pendingSubmissionRef.current;
    if (
      saved &&
      (saved.kind !== submission.kind ||
        saved.scope !== submission.scope ||
        saved.idempotencyKey !== submission.idempotencyKey)
    ) {
      return;
    }
    if (!saved) {
      // 必须先保存幂等键，再发写请求；存储失败时不会创建不可恢复的新任务。
      if (
        submissionStorageState !== "ready" ||
        !savePendingDataJobSubmission(userId, submission)
      ) {
        setSubmissionStorageState("unavailable");
        return;
      }
      pendingSubmissionRef.current = submission;
      setPendingSubmission(submission);
    }

    submissionLock.current = true;
    // 新任务或恢复请求都回到第一页，以便立即看到服务端的权威状态。
    setJobPageOffsets([0]);
    const onSuccess = () => {
      // 只清除本次响应对应的键；清理失败时保留恢复入口并暂停新建任务。
      if (clearPendingDataJobSubmission(userId, submission.idempotencyKey)) {
        pendingSubmissionRef.current = null;
        setPendingSubmission(null);
      } else {
        setSubmissionStorageState("unavailable");
      }
      callbacks.onSuccess?.();
    };
    const onError = () => callbacks.onError?.();
    const onSettled = () => {
      submissionLock.current = false;
    };

    if (submission.kind === "export") {
      createExport.mutate(
        {
          scope: submission.scope,
          idempotencyKey: submission.idempotencyKey,
        },
        { onSuccess, onError, onSettled },
      );
    } else {
      createDeletion.mutate(
        {
          scope: submission.scope,
          idempotencyKey: submission.idempotencyKey,
        },
        { onSuccess, onError, onSettled },
      );
    }
  }

  function submitExport(scope: ProductDataExportScope) {
    if (pendingSubmissionRef.current || submissionStorageState !== "ready")
      return;
    submitDataJob({
      kind: "export",
      scope,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function retryPendingSubmission() {
    const pending = pendingSubmissionRef.current;
    if (pending) submitDataJob(pending);
  }

  async function download(job: ProductDataJob) {
    // ref 同步锁在 React 重渲染前就生效，连续点击也只能创建一个制品读取请求。
    if (activeDownload.current !== null) return;
    const controller = new AbortController();
    activeDownload.current = controller;
    setDownloadError(false);
    setDownloadingJobId(job.job_id);
    try {
      const blob = await downloadProductDataJobArtifact(
        job.job_id,
        controller.signal,
      );
      // AbortSignal 不能保证读取适配器丢弃已完成的 Blob；卸载/切换账号后禁止迟到下载。
      if (controller.signal.aborted || activeDownload.current !== controller)
        return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        job.scope[0] === "account"
          ? `flow-desk-account-export-partial-${job.job_id}.zip`
          : job.scope[0] === "threads"
            ? `flow-desk-conversations-partial-${job.job_id}.json`
            : job.scope[0] === "projects"
              ? `flow-desk-project-metadata-partial-${job.job_id}.json`
              : job.scope[0] === "scheduled_tasks"
                ? `flow-desk-scheduled-tasks-partial-${job.job_id}.json`
                : job.scope[0] === "agents"
                  ? `flow-desk-agents-partial-${job.job_id}.json`
                  : job.scope[0] === "memory"
                    ? `flow-desk-memory-partial-${job.job_id}.json`
                    : job.scope[0] === "files"
                      ? `flow-desk-files-partial-${job.job_id}.json`
                      : `flow-desk-preferences-${job.job_id}.json`;
      try {
        anchor.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
    } catch {
      // 不显示原始 HTTP 错误，避免把 Gateway 内部信息直接展示给用户。
      if (!controller.signal.aborted && activeDownload.current === controller)
        setDownloadError(true);
    } finally {
      if (activeDownload.current === controller) {
        activeDownload.current = null;
        if (!controller.signal.aborted) setDownloadingJobId(null);
      }
    }
  }

  return (
    <SettingsSection title={copy.dataTitle} description={copy.dataDescription}>
      <div className="max-w-2xl space-y-4">
        <p className="bg-muted/30 text-muted-foreground rounded-md border px-3 py-2 text-sm">
          {copy.dataScopeNote}
        </p>
        {/* 先保留关键边界提示，冗长的各范围排除项由原生折叠区收纳，避免设置页被说明文字挤满。 */}
        <details className="group rounded-md border px-3 py-2">
          <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
            {copy.dataScopeDetails}
            <ChevronDownIcon
              aria-hidden="true"
              className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <ul className="mt-3 grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
            {[
              [copy.dataAccountExport, copy.dataAccountScopeNote],
              [copy.dataThreadsExport, copy.dataThreadsScopeNote],
              [copy.dataProjectsExport, copy.dataProjectsScopeNote],
              [copy.dataScheduledTasksExport, copy.dataScheduledTasksScopeNote],
              [copy.dataAgentsExport, copy.dataAgentsScopeNote],
              [copy.dataMemoryExport, copy.dataMemoryScopeNote],
              [copy.dataFilesExport, copy.dataFilesScopeNote],
            ].map(([title, description]) => (
              <li key={title} className="bg-muted/30 rounded-md p-3">
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground mt-1 leading-relaxed">
                  {description}
                </p>
              </li>
            ))}
          </ul>
        </details>
        {/* 将普通导出与危险删除分区，删除仍进入原有的逐范围确认流程。 */}
        <div className="space-y-5">
          <section
            aria-labelledby="product-data-export-heading"
            className="space-y-3"
          >
            <h3
              id="product-data-export-heading"
              className="text-sm font-semibold"
            >
              {copy.dataExportActionsTitle}
            </h3>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              {exportActions.map(({ scope, label, primary }) => {
                // 数据任务全局互斥，但进度只属于本次提交的范围，不能让所有按钮同时伪装成目标。
                const submitting =
                  createExport.isPending &&
                  createExport.variables?.scope === scope;
                const missingPermissions = missingPermissionsFor(
                  "export",
                  scope,
                );
                const permissionDescriptionId = `product-data-export-${scope}-permission`;
                return (
                  <div key={scope} className="space-y-1">
                    <Button
                      type="button"
                      variant={primary ? "default" : "outline"}
                      className={DATA_ACTION_BUTTON_CLASS}
                      disabled={
                        actionsDisabled || missingPermissions.length > 0
                      }
                      aria-describedby={
                        missingPermissions.length > 0
                          ? permissionDescriptionId
                          : undefined
                      }
                      aria-busy={submitting}
                      onClick={() => submitExport(scope)}
                    >
                      {submitting && (
                        <LoaderIcon className="size-4 shrink-0 animate-spin" />
                      )}
                      {submitting ? copy.dataSubmitting : label}
                    </Button>
                    {missingPermissions.length > 0 && (
                      <p
                        id={permissionDescriptionId}
                        role="status"
                        className="text-muted-foreground text-xs leading-5"
                      >
                        {t.agents.permissionRequired(missingPermissions[0]!)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="product-data-deletion-heading"
            className="border-destructive/20 bg-destructive/5 space-y-3 rounded-xl border p-3 sm:p-4"
          >
            <div className="space-y-1">
              <h3
                id="product-data-deletion-heading"
                className="text-sm font-semibold"
              >
                {copy.dataDeletionActionsTitle}
              </h3>
              <p className="text-muted-foreground text-sm leading-5">
                {copy.dataDeletionActionsDescription}
              </p>
            </div>
            {capabilityStatus && (
              <div
                role={capabilities.isError ? "alert" : "status"}
                className="space-y-2 text-sm"
              >
                <p className="text-muted-foreground">{capabilityStatus}</p>
                {capabilities.capabilitiesEnabled && capabilities.isError && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={capabilities.isFetching}
                    onClick={() => void capabilities.refetch()}
                  >
                    {capabilityCopy.retry}
                  </Button>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              {deletionActions.map(({ scope, label }) => {
                const supported =
                  capabilitiesReady &&
                  capabilities.data?.deletion_scopes[scope] === true;
                const unsupported = capabilitiesReady && !supported;
                const missingPermissions = missingPermissionsFor(
                  "deletion",
                  scope,
                );
                const descriptionId = `product-data-deletion-${scope}-availability`;
                const permissionDescriptionId = `product-data-deletion-${scope}-permission`;
                return (
                  <div key={scope} className="space-y-1">
                    <Button
                      type="button"
                      variant="outline"
                      className={DATA_DELETE_BUTTON_CLASS + " w-full"}
                      disabled={
                        actionsDisabled ||
                        !supported ||
                        missingPermissions.length > 0
                      }
                      aria-describedby={
                        missingPermissions.length > 0
                          ? permissionDescriptionId
                          : unsupported
                            ? descriptionId
                            : undefined
                      }
                      onClick={() => openDeletion(scope)}
                    >
                      {label}
                    </Button>
                    {unsupported && (
                      <p
                        id={descriptionId}
                        className="text-muted-foreground text-xs leading-5"
                      >
                        {capabilityCopy.unsupported}
                      </p>
                    )}
                    {missingPermissions.length > 0 && (
                      <p
                        id={permissionDescriptionId}
                        role="status"
                        className="text-muted-foreground text-xs leading-5"
                      >
                        {t.agents.permissionRequired(missingPermissions[0]!)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {jobsQuery.isPending && (
          <p role="status" className="text-muted-foreground text-sm">
            {copy.dataLoading}
          </p>
        )}
        {jobsQuery.isError && (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">{copy.dataLoadError}</p>
            {dataJobsFeatureNotFound && (
              <p className="text-muted-foreground">{copy.dataNotEnabled}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void jobsQuery.refetch()}
            >
              {copy.dataRetry}
            </Button>
          </div>
        )}
        {jobOffset > 0 && latestJobsQuery.isError && (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-muted-foreground">{copy.dataLoadError}</p>
            <p className="text-muted-foreground">
              {copy.dataActiveCheckFailed}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void latestJobsQuery.refetch()}
            >
              {copy.dataRetry}
            </Button>
          </div>
        )}
        {createExport.isError || createDeletion.isError || cancelJob.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {copy.dataOperationError}
          </p>
        ) : null}
        {submissionStorageState === "unavailable" && userId !== null && (
          <p role="alert" className="text-destructive text-sm">
            {copy.dataRecoveryUnavailable}
          </p>
        )}
        {pendingSubmission && (
          <div
            role="status"
            className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-muted-foreground text-sm leading-5">
              <span className="text-foreground mb-1 block font-medium">
                {pendingSubmission.kind === "deletion"
                  ? copy.dataPendingDeletion
                  : copy.dataPendingExport}
                : {pendingSubmissionLabel ?? pendingSubmission.scope}
              </span>
              {copy.dataSubmissionUnconfirmed}
            </p>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={isMutating || pendingMissingPermissions.length > 0}
              onClick={retryPendingSubmission}
            >
              {isMutating ? copy.dataSubmitting : copy.dataCheckSubmission}
            </Button>
          </div>
        )}
        {pendingSubmission && pendingMissingPermissions.length > 0 && (
          <p role="status" className="text-muted-foreground text-sm">
            {t.agents.permissionRequired(pendingMissingPermissions[0]!)}
          </p>
        )}
        {downloadError && (
          <p role="alert" className="text-destructive text-sm">
            {copy.dataDownloadError}
          </p>
        )}
        {jobsQuery.isSuccess && jobs.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {jobOffset === 0 ? copy.dataEmpty : copy.dataPageEmpty}
          </p>
        )}
        {jobs.length > 0 && (
          <ol aria-label={copy.dataJobsLabel} className="space-y-3">
            {jobs.map((job) => (
              <PreferenceDataJobRow
                key={job.job_id}
                job={job}
                locale={locale}
                copy={copy}
                cancelling={
                  cancelJob.isPending && cancelJob.variables === job.job_id
                }
                downloading={downloadingJobId === job.job_id}
                downloadBusy={downloadingJobId !== null}
                onCancel={() => cancelJob.mutate(job.job_id)}
                onDownload={() => void download(job)}
                onRetryExport={
                  job.kind === "export" &&
                  job.status === "failed" &&
                  isRetryableDataJobFailure(job.error_code)
                    ? () => submitExport(job.scope[0])
                    : undefined
                }
                retryDisabled={actionsDisabled}
              />
            ))}
          </ol>
        )}
        {jobsQuery.isSuccess && (jobOffset > 0 || hasMore) && (
          <nav
            aria-label={copy.dataJobsPagination}
            className="flex items-center justify-between gap-3"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={jobOffset === 0 || jobsQuery.isFetching}
              onClick={() =>
                setJobPageOffsets((current) =>
                  current.length > 1 ? current.slice(0, -1) : current,
                )
              }
            >
              {copy.dataJobsPrevious}
            </Button>
            <span role="status" className="text-muted-foreground text-sm">
              {copy.dataJobsPage.replace(
                "{page}",
                String(jobPageOffsets.length),
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasMore || jobsQuery.isFetching}
              onClick={() => {
                const nextOffset = jobsQuery.data?.next_offset;
                setJobPageOffsets((current) => [
                  ...current,
                  typeof nextOffset === "number"
                    ? nextOffset
                    : jobOffset + DATA_JOBS_PAGE_SIZE,
                ]);
              }}
            >
              {copy.dataJobsNext}
            </Button>
          </nav>
        )}
      </div>

      <Dialog
        open={deletionDialogOpen}
        onOpenChange={(open) => {
          // 删除任务创建请求尚未返回时，关闭弹窗不会取消服务端操作；先锁住退出，避免用户误以为已停止。
          if (createDeletion.isPending) return;
          setDeletionDialogOpen(open);
          if (!open) setConfirmation("");
        }}
      >
        <DialogContent
          showCloseButton={!createDeletion.isPending}
          aria-busy={createDeletion.isPending}
          onEscapeKeyDown={(event) => {
            if (createDeletion.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (createDeletion.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {deletionScope === "threads"
                ? copy.dataDeleteThreadsDialogTitle
                : deletionScope === "projects"
                  ? copy.dataDeleteProjectsDialogTitle
                  : deletionScope === "scheduled_tasks"
                    ? copy.dataDeleteScheduledTasksDialogTitle
                    : deletionScope === "agents"
                      ? copy.dataDeleteAgentsDialogTitle
                      : deletionScope === "memory"
                        ? copy.dataDeleteMemoryDialogTitle
                        : deletionScope === "files"
                          ? copy.dataDeleteFilesDialogTitle
                          : copy.dataDeleteDialogTitle}
            </DialogTitle>
            <DialogDescription>
              {deletionScope === "threads"
                ? copy.dataDeleteThreadsDialogDescription
                : deletionScope === "projects"
                  ? copy.dataDeleteProjectsDialogDescription
                  : deletionScope === "scheduled_tasks"
                    ? copy.dataDeleteScheduledTasksDialogDescription
                    : deletionScope === "agents"
                      ? copy.dataDeleteAgentsDialogDescription
                      : deletionScope === "memory"
                        ? copy.dataDeleteMemoryDialogDescription
                        : deletionScope === "files"
                          ? copy.dataDeleteFilesDialogDescription
                          : copy.dataDeleteDialogDescription}
            </DialogDescription>
          </DialogHeader>
          {(!selectedDeletionSupported ||
            selectedDeletionMissingPermissions.length > 0) &&
            !createDeletion.isPending && (
              <div role="alert" className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {selectedDeletionMissingPermissions.length > 0
                    ? t.agents.permissionRequired(
                        selectedDeletionMissingPermissions[0]!,
                      )
                    : (capabilityStatus ?? capabilityCopy.changed)}
                </p>
                {selectedDeletionMissingPermissions.length === 0 &&
                  capabilities.capabilitiesEnabled &&
                  capabilities.isError && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={capabilities.isFetching}
                      onClick={() => void capabilities.refetch()}
                    >
                      {capabilityCopy.retry}
                    </Button>
                  )}
              </div>
            )}
          <label className="space-y-2 text-sm font-medium">
            <span>
              {deletionScope === "threads"
                ? copy.dataDeleteThreadsPhraseLabel
                : deletionScope === "projects"
                  ? copy.dataDeleteProjectsPhraseLabel
                  : deletionScope === "scheduled_tasks"
                    ? copy.dataDeleteScheduledTasksPhraseLabel
                    : deletionScope === "agents"
                      ? copy.dataDeleteAgentsPhraseLabel
                      : deletionScope === "memory"
                        ? copy.dataDeleteMemoryPhraseLabel
                        : deletionScope === "files"
                          ? copy.dataDeleteFilesPhraseLabel
                          : copy.dataDeletePhraseLabel}
            </span>
            <Input
              autoComplete="off"
              maxLength={DELETE_CONFIRMATIONS[deletionScope].length}
              spellCheck={false}
              disabled={
                createDeletion.isPending ||
                !selectedDeletionSupported ||
                selectedDeletionMissingPermissions.length > 0
              }
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {createDeletion.isError && (
            <p role="alert" className="text-destructive text-sm">
              {copy.dataOperationError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={createDeletion.isPending}
              onClick={() => setDeletionDialogOpen(false)}
            >
              {deletionScope === "threads"
                ? copy.dataDeleteThreadsCancel
                : deletionScope === "projects"
                  ? copy.dataDeleteProjectsCancel
                  : deletionScope === "scheduled_tasks"
                    ? copy.dataDeleteScheduledTasksCancel
                    : deletionScope === "agents"
                      ? copy.dataDeleteAgentsCancel
                      : deletionScope === "memory"
                        ? copy.dataDeleteMemoryCancel
                        : deletionScope === "files"
                          ? copy.dataDeleteFilesCancel
                          : copy.dataDeleteCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={hasBlockingCondition(
                confirmation !== DELETE_CONFIRMATIONS[deletionScope],
                createDeletion.isPending,
                jobsQuery.isPending,
                jobsQuery.isError,
                latestActivityUnknown,
                hasActiveJob === true,
                submissionStorageState !== "ready",
                pendingSubmission !== null,
                !selectedDeletionSupported,
                selectedDeletionMissingPermissions.length > 0,
              )}
              onClick={() => {
                // 弹窗打开后能力可能被撤回或重载，提交时继续检查当前成功快照。
                if (
                  !selectedDeletionSupported ||
                  selectedDeletionMissingPermissions.length > 0 ||
                  actionsDisabled
                )
                  return;
                submitDataJob(
                  {
                    kind: "deletion",
                    scope: deletionScope,
                    idempotencyKey: crypto.randomUUID(),
                  },
                  {
                    onSuccess: () => {
                      setDeletionDialogOpen(false);
                      setConfirmation("");
                    },
                    onError: () => {
                      // 确认短语只留在弹窗内；结果不确定时关闭弹窗，改用已保存的同键恢复。
                      setDeletionDialogOpen(false);
                      setConfirmation("");
                    },
                  },
                );
              }}
            >
              {createDeletion.isPending
                ? copy.dataSubmitting
                : deletionScope === "threads"
                  ? copy.dataDeleteThreadsConfirm
                  : deletionScope === "projects"
                    ? copy.dataDeleteProjectsConfirm
                    : deletionScope === "scheduled_tasks"
                      ? copy.dataDeleteScheduledTasksConfirm
                      : deletionScope === "agents"
                        ? copy.dataDeleteAgentsConfirm
                        : deletionScope === "memory"
                          ? copy.dataDeleteMemoryConfirm
                          : deletionScope === "files"
                            ? copy.dataDeleteFilesConfirm
                            : copy.dataDeleteConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function PreferenceDataJobRow({
  job,
  locale,
  copy,
  cancelling,
  downloading,
  downloadBusy,
  onCancel,
  onDownload,
  onRetryExport,
  retryDisabled,
}: {
  job: ProductDataJob;
  locale: string;
  copy: ReturnType<typeof useI18n>["t"]["settings"]["productPreferences"];
  cancelling: boolean;
  downloading: boolean;
  downloadBusy: boolean;
  onCancel: () => void;
  onDownload: () => void;
  onRetryExport?: () => void;
  retryDisabled: boolean;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const requiredPermissions = getDataJobRequiredPermissions(
    job.kind,
    job.scope[0],
  );
  const missingPermissions = requiredPermissions
    ? getMissingPermissions(user, requiredPermissions)
    : [];
  const permissionBlocked =
    requiredPermissions === null || missingPermissions.length > 0;
  const active = ACTIVE_JOB_STATUSES.has(job.status);
  const statusLabel = copy.status[job.status];
  const stageLabel =
    copy.stage[job.progress.stage as keyof typeof copy.stage] ??
    copy.stage.other;
  const expiresAt = job.result?.expires_at
    ? new Date(job.result.expires_at).getTime()
    : Number.POSITIVE_INFINITY;
  const hasExpiry = Number.isFinite(expiresAt);
  const [expiredArtifactAt, setExpiredArtifactAt] = useState<number | null>(
    null,
  );
  useEffect(() => {
    if (!hasExpiry) return;
    let timer: number | null = null;
    const checkExpiry = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setExpiredArtifactAt(expiresAt);
        return;
      }
      timer = window.setTimeout(
        checkExpiry,
        Math.min(remaining, MAX_TIMEOUT_DELAY_MS),
      );
    };
    timer = window.setTimeout(
      checkExpiry,
      Math.min(Math.max(0, expiresAt - Date.now()), MAX_TIMEOUT_DELAY_MS),
    );
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [expiresAt, hasExpiry]);
  const artifactAvailable =
    job.kind === "export" &&
    job.status === "completed" &&
    (expiresAt === Number.POSITIVE_INFINITY ||
      (hasExpiry && expiredArtifactAt !== expiresAt));

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium">
            {job.kind === "deletion"
              ? job.scope[0] === "threads"
                ? copy.dataDeleteThreadsJob
                : job.scope[0] === "scheduled_tasks"
                  ? copy.dataDeleteScheduledTasksJob
                  : job.scope[0] === "agents"
                    ? copy.dataDeleteAgentsJob
                    : job.scope[0] === "projects"
                      ? copy.dataDeleteProjectsJob
                      : job.scope[0] === "memory"
                        ? copy.dataDeleteMemoryJob
                        : job.scope[0] === "files"
                          ? copy.dataDeleteFilesJob
                          : copy.dataDeleteJob
              : job.scope[0] === "account"
                ? copy.dataAccountExportJob
                : job.scope[0] === "threads"
                  ? copy.dataThreadsExportJob
                  : job.scope[0] === "projects"
                    ? copy.dataProjectsExportJob
                    : job.scope[0] === "scheduled_tasks"
                      ? copy.dataScheduledTasksExportJob
                      : job.scope[0] === "agents"
                        ? copy.dataAgentsExportJob
                        : job.scope[0] === "memory"
                          ? copy.dataMemoryExportJob
                          : job.scope[0] === "files"
                            ? copy.dataFilesExportJob
                            : copy.dataExportJob}
          </p>
          <time
            dateTime={job.created_at}
            className="text-muted-foreground text-xs"
          >
            {new Date(job.created_at).toLocaleString(locale)}
          </time>
        </div>
        <div className="flex flex-wrap gap-2">
          {job.kind === "export" && job.result?.completeness === "partial" && (
            <Badge variant="outline">{copy.dataPartialBadge}</Badge>
          )}
          {job.kind === "deletion" &&
            job.status === "completed" &&
            job.result?.completeness === "partial" && (
              <Badge variant="outline">{copy.dataPartialDeletionBadge}</Badge>
            )}
          <Badge
            variant={job.status === "failed" ? "destructive" : "secondary"}
          >
            {statusLabel}
          </Badge>
        </div>
      </div>
      {active && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">
            {stageLabel}
            {job.progress.total > 0
              ? ` · ${job.progress.completed}/${job.progress.total}`
              : ""}
          </p>
          {job.progress.total > 0 && (
            <progress
              aria-label={copy.dataProgressLabel}
              className="accent-primary h-2 w-full"
              max={job.progress.total}
              value={Math.min(job.progress.completed, job.progress.total)}
            />
          )}
        </div>
      )}
      {job.status === "failed" && (
        <p className="text-destructive text-sm">
          {copy.dataTaskFailureReasons[getDataJobFailureReason(job.error_code)]}
        </p>
      )}
      {job.kind === "export" &&
        job.status === "completed" &&
        job.result?.completeness === "partial" && (
          <p className="text-muted-foreground text-sm">
            {job.scope[0] === "account"
              ? copy.dataAccountExportPartialResultNote
              : job.scope[0] === "projects"
                ? copy.dataProjectsPartialResultNote
                : job.scope[0] === "scheduled_tasks"
                  ? copy.dataScheduledTasksPartialResultNote
                  : job.scope[0] === "agents"
                    ? copy.dataAgentsPartialResultNote
                    : job.scope[0] === "memory"
                      ? copy.dataMemoryPartialResultNote
                      : job.scope[0] === "files"
                        ? copy.dataFilesPartialResultNote
                        : copy.dataPartialResultNote}
          </p>
        )}
      {job.kind === "deletion" && job.status === "completed" && (
        <div className="text-muted-foreground space-y-1 text-sm">
          <p>
            {job.scope[0] === "memory"
              ? copy.dataDeleteMemoryCompleted
              : job.scope[0] === "files"
                ? copy.dataDeletedFilesCount.replace(
                    "{count}",
                    String(job.result?.deleted_resources_count ?? 0),
                  )
                : (job.scope[0] === "threads"
                    ? copy.dataDeletedThreadsCount
                    : job.scope[0] === "scheduled_tasks"
                      ? copy.dataDeletedScheduledTasksCount
                      : job.scope[0] === "agents"
                        ? copy.dataDeletedAgentsCount
                        : job.scope[0] === "projects"
                          ? copy.dataDeletedProjectsCount
                          : copy.dataDeletedCount
                  ).replace(
                    "{count}",
                    String(job.result?.deleted_resources_count ?? 0),
                  )}
          </p>
          {job.scope[0] === "projects" && (
            <p>{copy.dataDeleteProjectsCompleted}</p>
          )}
          {job.scope[0] === "threads" &&
            job.result?.completeness === "partial" && (
              <p>
                {copy.dataDeleteThreadsPartialCount
                  .replace(
                    "{count}",
                    String(job.result.remaining_resources_count ?? 0),
                  )
                  .replace(
                    "{failed}",
                    String(job.result.failed_resources_count ?? 0),
                  )}
              </p>
            )}
          {job.scope[0] === "scheduled_tasks" &&
            job.result?.completeness === "partial" && (
              <p>
                {copy.dataDeleteScheduledTasksPartialCount
                  .replace(
                    "{count}",
                    String(job.result.remaining_resources_count ?? 0),
                  )
                  .replace(
                    "{failed}",
                    String(job.result.failed_resources_count ?? 0),
                  )}
              </p>
            )}
          {job.scope[0] === "agents" &&
            job.result?.completeness === "partial" && (
              <p>
                {copy.dataDeleteAgentsPartialCount
                  .replace(
                    "{count}",
                    String(job.result.remaining_resources_count ?? 0),
                  )
                  .replace(
                    "{failed}",
                    String(job.result.failed_resources_count ?? 0),
                  )}
              </p>
            )}
          {job.scope[0] === "files" &&
            job.result?.completeness === "partial" && (
              <p>
                {copy.dataDeleteFilesPartialCount
                  .replace(
                    "{count}",
                    String(job.result.remaining_resources_count ?? 0),
                  )
                  .replace(
                    "{failed}",
                    String(job.result.failed_resources_count ?? 0),
                  )}
              </p>
            )}
        </div>
      )}
      {job.kind === "export" &&
        job.status === "completed" &&
        !artifactAvailable && (
          <p className="text-muted-foreground text-sm">{copy.dataExpired}</p>
        )}
      {permissionBlocked && (
        <p role="status" className="text-muted-foreground text-sm">
          {missingPermissions.length > 0
            ? t.agents.permissionRequired(missingPermissions[0]!)
            : copy.dataOperationError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {onRetryExport && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={retryDisabled || permissionBlocked}
            onClick={onRetryExport}
          >
            {copy.dataRetryExport}
          </Button>
        )}
        {artifactAvailable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={downloadBusy || permissionBlocked}
            onClick={onDownload}
          >
            {downloading
              ? copy.dataDownloading
              : job.scope[0] === "account"
                ? copy.dataDownloadZip
                : copy.dataDownload}
          </Button>
        )}
        {active && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancelling || permissionBlocked}
            onClick={onCancel}
          >
            {cancelling ? copy.dataCancelling : copy.dataCancelJob}
          </Button>
        )}
      </div>
    </li>
  );
}
