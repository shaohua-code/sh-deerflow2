"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import {
  fetchProductAdminSettings,
  fetchProductAuditEvents,
  fetchAdminUsers,
  updateAdminUserStatus,
  AdminUserStatusConflictError,
  ProductConfigConflictError,
  type ProductAdminSettingsPatch,
  updateProductAdminSettings,
  type AdminUserSummary,
  type ProductFeatureKey,
} from "@/product/api";
import { publishPublicProductBrandUpdate } from "@/product/public-brand";

import { SettingsSection } from "./settings-section";
import type { SettingsUnsavedChangesHandler } from "./settings-unsaved-changes";

const PAGE_SIZE = 50;
const PRODUCT_FEATURE_KEYS: ProductFeatureKey[] = [
  "overview",
  "chats",
  "agents",
  "scheduled_tasks",
  "capabilities",
  "files",
  "data_privacy",
  "administration",
];
const UNIMPLEMENTED_FEATURES: ProductFeatureKey[] = ["data_privacy"];

type ProductConfigForm = {
  name: string;
  name_zh: string;
  features: Record<ProductFeatureKey, boolean>;
};

type ProductConfigDraft = {
  value: ProductConfigForm;
  // 使用开始编辑时的版本提交；服务端已有更新时可触发 409，而不是覆盖新配置。
  baseVersion: number;
};

const EMPTY_FORM: ProductConfigForm = {
  name: "",
  name_zh: "",
  features: {
    overview: true,
    chats: true,
    agents: true,
    scheduled_tasks: true,
    capabilities: true,
    files: false,
    data_privacy: false,
    administration: false,
  },
};

export function ProductAdminPage({
  onUnsavedChangesChange,
}: {
  onUnsavedChangesChange?: SettingsUnsavedChangesHandler;
} = {}) {
  const { user } = useAuth();

  // 管理配置草稿和账号状态确认属于发起操作的管理员，切换身份时应一并清空。
  return (
    <ProductAdminContent
      key={user?.id ?? "anonymous"}
      actorUserId={user?.id ?? ""}
      onUnsavedChangesChange={onUnsavedChangesChange}
    />
  );
}

function ProductAdminContent({
  actorUserId,
  onUnsavedChangesChange,
}: {
  actorUserId: string;
  onUnsavedChangesChange?: SettingsUnsavedChangesHandler;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [accountOffset, setAccountOffset] = useState(0);
  const [accountToUpdate, setAccountToUpdate] = useState<{
    user: AdminUserSummary;
    isActive: boolean;
  } | null>(null);
  const [accountRunNotice, setAccountRunNotice] = useState<{
    message: string;
    needsAttention: boolean;
  } | null>(null);
  // 未保存的编辑与服务端快照分开保存；后台重新验证缓存时不会覆盖用户草稿。
  const [formDraft, setFormDraft] = useState<ProductConfigDraft | null>(null);
  const adminSettings = useQuery({
    queryKey: ["product", "admin-settings", actorUserId],
    queryFn: ({ signal }) => fetchProductAdminSettings(signal),
    enabled: Boolean(actorUserId),
    retry: false,
  });
  const savedForm = adminSettings.data?.product ?? EMPTY_FORM;
  const form = formDraft?.value ?? savedForm;
  // 草稿必须与当前服务端快照逐字段比较，不能只看 formDraft 是否存在：
  // 管理员把值改回原样后，不应继续显示“未保存”或允许重复提交。
  const hasUnsavedConfig =
    formDraft !== null &&
    (form.name !== savedForm.name ||
      form.name_zh !== savedForm.name_zh ||
      PRODUCT_FEATURE_KEYS.some(
        (feature) => form.features[feature] !== savedForm.features[feature],
      ));
  // 后台刷新不会覆盖草稿；版本标签也必须显示草稿真正基于的版本。
  const displayedConfigVersion =
    formDraft?.baseVersion ?? adminSettings.data?.version ?? 0;
  const saveSettings = useMutation({
    mutationFn: ({
      settings,
    }: {
      actorUserId: string;
      settings: ProductAdminSettingsPatch;
    }) => updateProductAdminSettings(settings),
    onSuccess: (result, variables) => {
      // Mutation 完成时也使用发起时的账号分区，避免切账号后的迟到响应污染新账号缓存。
      queryClient.setQueryData(
        ["product", "admin-settings", variables.actorUserId],
        result,
      );
      // 页头和导航共享 bootstrap 缓存，配置保存后立即应用新开关与品牌名。
      queryClient.setQueryData(["product", "bootstrap"], result.product);
      publishPublicProductBrandUpdate({
        name: result.product.name,
        name_zh: result.product.name_zh,
      });
      // 保存结果已写入查询缓存，清掉草稿后由权威响应驱动表单。
      setFormDraft(null);
    },
  });
  function updateForm(
    change: (current: ProductConfigForm) => ProductConfigForm,
  ) {
    // 新一轮编辑开始后，旧的成功或失败提示都不再描述当前草稿。
    saveSettings.reset();
    setFormDraft((draft) => ({
      value: change(draft?.value ?? adminSettings.data?.product ?? EMPTY_FORM),
      baseVersion: draft?.baseVersion ?? adminSettings.data?.version ?? 0,
    }));
  }
  const resetSaveSettings = saveSettings.reset;
  useEffect(() => {
    if (!onUnsavedChangesChange) return;
    onUnsavedChangesChange(
      hasUnsavedConfig
        ? {
            isPending: saveSettings.isPending,
            discard: () => {
              setFormDraft(null);
              resetSaveSettings();
            },
          }
        : null,
    );
    return () => onUnsavedChangesChange(null);
  }, [
    hasUnsavedConfig,
    onUnsavedChangesChange,
    resetSaveSettings,
    saveSettings.isPending,
  ]);
  const audit = useQuery({
    queryKey: ["product", "audit-events", actorUserId, PAGE_SIZE, offset],
    queryFn: ({ signal }) => fetchProductAuditEvents(PAGE_SIZE, offset, signal),
    enabled: Boolean(actorUserId),
    retry: false,
  });
  const accounts = useQuery({
    queryKey: ["product", "admin-users", actorUserId, PAGE_SIZE, accountOffset],
    queryFn: ({ signal }) => fetchAdminUsers(PAGE_SIZE, accountOffset, signal),
    enabled: Boolean(actorUserId),
    retry: false,
  });
  const updateAccount = useMutation({
    mutationFn: ({
      userId,
      isActive,
    }: {
      actorUserId: string;
      userId: string;
      isActive: boolean;
    }) => updateAdminUserStatus(userId, isActive),
    onSuccess: async (result, variables) => {
      setAccountToUpdate(null);
      const {
        active_runs_stopped,
        active_runs_stop_pending,
        active_runs_stop_failed,
      } = result;
      const activeRunCount =
        active_runs_stopped +
        active_runs_stop_pending +
        active_runs_stop_failed;
      if (!variables.isActive && activeRunCount > 0) {
        // 让管理员分清本机已中止、跨 Gateway 仍在传递，以及需要人工排查的运行。
        setAccountRunNotice({
          message: t.settings.productAdmin.accountRunStopSummary
            .replace("{stopped}", String(active_runs_stopped))
            .replace("{pending}", String(active_runs_stop_pending))
            .replace("{failed}", String(active_runs_stop_failed)),
          needsAttention: active_runs_stop_failed > 0,
        });
      } else {
        setAccountRunNotice(null);
      }
      await queryClient.invalidateQueries({
        queryKey: ["product", "admin-users", variables.actorUserId],
      });
    },
    onMutate: () => setAccountRunNotice(null),
    onError: async (_error, variables) => {
      // 409 可能表示最后一个管理员保护条件刚被并发修改；重新读取服务端权威列表。
      await queryClient.invalidateQueries({
        queryKey: ["product", "admin-users", variables.actorUserId],
      });
    },
  });
  // 响应式页面会同时渲染卡片和表格结构；按钮名称必须带目标邮箱，不能只依赖视觉邻近关系。
  const getAccountActionLabel = (account: AdminUserSummary) =>
    account.is_active
      ? t.settings.productAdmin.disableAccountFor(account.email)
      : t.settings.productAdmin.enableAccountFor(account.email);
  function openAccountStatusDialog(account: AdminUserSummary) {
    updateAccount.reset();
    setAccountRunNotice(null);
    setAccountToUpdate({
      user: account,
      isActive: !account.is_active,
    });
  }
  function closeAccountStatusDialog() {
    if (updateAccount.isPending) return;
    setAccountToUpdate(null);
    updateAccount.reset();
  }
  // 服务端审计 DTO 保留稳定动作码；在展示边界转成双语文案，避免把内部 key 暴露给管理员。
  const formatAuditAction = (action: string) => {
    const labels: Record<string, string> = {
      "settings.write": t.settings.productAdmin.auditActions.preferenceSaved,
      "settings.delete": t.settings.productAdmin.auditActions.preferenceDeleted,
      "product.settings.patch":
        t.settings.productAdmin.auditActions.productDisplayUpdated,
      "account.status.enable":
        t.settings.productAdmin.auditActions.accountEnabled,
      "account.status.disable":
        t.settings.productAdmin.auditActions.accountDisabled,
      "data.export.requested":
        t.settings.productAdmin.auditActions.dataExportRequested,
      "data.deletion.requested":
        t.settings.productAdmin.auditActions.dataDeletionRequested,
      "data.export.completed":
        t.settings.productAdmin.auditActions.dataExportCompleted,
      "data.deletion.completed":
        t.settings.productAdmin.auditActions.dataDeletionCompleted,
      "data.export.cancel_requested":
        t.settings.productAdmin.auditActions.dataJobCancelRequested,
      "data.deletion.cancel_requested":
        t.settings.productAdmin.auditActions.dataJobCancelRequested,
      "data.export.cancelled":
        t.settings.productAdmin.auditActions.dataJobCancelled,
      "data.deletion.cancelled":
        t.settings.productAdmin.auditActions.dataJobCancelled,
      "data.export.failed": t.settings.productAdmin.auditActions.dataJobFailed,
      "data.deletion.failed":
        t.settings.productAdmin.auditActions.dataJobFailed,
      "data.export.download_requested":
        t.settings.productAdmin.auditActions.dataExportDownloadRequested,
      "thread.create": t.settings.productAdmin.auditActions.threadCreated,
      "thread.branch": t.settings.productAdmin.auditActions.threadBranched,
      "thread.update": t.settings.productAdmin.auditActions.threadUpdated,
      "thread.move": t.settings.productAdmin.auditActions.threadMoved,
      "thread.delete": t.settings.productAdmin.auditActions.threadDeleted,
      "upload.create": t.settings.productAdmin.auditActions.uploadCreated,
      "upload.delete": t.settings.productAdmin.auditActions.uploadDeleted,
      "project.document.trash":
        t.settings.productAdmin.auditActions.projectDocumentTrashed,
      "project.document.restore":
        t.settings.productAdmin.auditActions.projectDocumentRestored,
      "project.document.purge":
        t.settings.productAdmin.auditActions.projectDocumentPurged,
      "project.trash.empty":
        t.settings.productAdmin.auditActions.projectTrashEmptied,
      "project.create": t.settings.productAdmin.auditActions.projectCreated,
      "project.update": t.settings.productAdmin.auditActions.projectUpdated,
      "project.archive": t.settings.productAdmin.auditActions.projectArchived,
      "project.restore": t.settings.productAdmin.auditActions.projectRestored,
      "project.delete": t.settings.productAdmin.auditActions.projectDeleted,
      "scheduled_task.create":
        t.settings.productAdmin.auditActions.scheduledTaskCreated,
      "scheduled_task.update":
        t.settings.productAdmin.auditActions.scheduledTaskUpdated,
      "scheduled_task.pause":
        t.settings.productAdmin.auditActions.scheduledTaskPaused,
      "scheduled_task.resume":
        t.settings.productAdmin.auditActions.scheduledTaskResumed,
      "scheduled_task.trigger":
        t.settings.productAdmin.auditActions.scheduledTaskTriggered,
      "scheduled_task.delete":
        t.settings.productAdmin.auditActions.scheduledTaskDeleted,
      "memory.clear": t.settings.productAdmin.auditActions.memoryCleared,
      "memory.export": t.settings.productAdmin.auditActions.memoryExported,
      "memory.import": t.settings.productAdmin.auditActions.memoryImported,
      "memory.fact.create":
        t.settings.productAdmin.auditActions.memoryFactCreated,
      "memory.fact.update":
        t.settings.productAdmin.auditActions.memoryFactUpdated,
      "memory.fact.delete":
        t.settings.productAdmin.auditActions.memoryFactDeleted,
      "custom_agent.create":
        t.settings.productAdmin.auditActions.customAgentCreated,
      "custom_agent.update":
        t.settings.productAdmin.auditActions.customAgentUpdated,
      "custom_agent.delete":
        t.settings.productAdmin.auditActions.customAgentDeleted,
      "skill.install": t.settings.productAdmin.auditActions.skillInstalled,
      "skill.custom.update": t.settings.productAdmin.auditActions.skillUpdated,
      "skill.custom.delete": t.settings.productAdmin.auditActions.skillDeleted,
      "skill.custom.rollback":
        t.settings.productAdmin.auditActions.skillRolledBack,
      "skill.enable": t.settings.productAdmin.auditActions.skillEnabled,
      "skill.disable": t.settings.productAdmin.auditActions.skillDisabled,
      "skill.reload": t.settings.productAdmin.auditActions.skillsReloaded,
      "user_profile.update":
        t.settings.productAdmin.auditActions.userProfileUpdated,
      "auth.pat.create": t.settings.productAdmin.auditActions.patCreated,
      "auth.pat.revoke": t.settings.productAdmin.auditActions.patRevoked,
      "auth.password.change":
        t.settings.productAdmin.auditActions.passwordChanged,
      "auth.account.register":
        t.settings.productAdmin.auditActions.accountRegistered,
      "auth.admin.initialize":
        t.settings.productAdmin.auditActions.adminInitialized,
      "auth.oidc.provision":
        t.settings.productAdmin.auditActions.oidcAccountProvisioned,
      "auth.oidc.login":
        t.settings.productAdmin.auditActions.oidcLoginSucceeded,
    };
    return labels[action] ?? t.settings.productAdmin.auditActions.other;
  };
  const formatAuditResource = (resourceType: string) => {
    const labels: Record<string, string> = {
      user_setting: t.settings.productAdmin.auditResources.userSetting,
      product_config:
        t.settings.productAdmin.auditResources.productConfiguration,
      account: t.settings.productAdmin.auditResources.account,
      data_job: t.settings.productAdmin.auditResources.dataJob,
      thread: t.settings.productAdmin.auditResources.thread,
      thread_upload: t.settings.productAdmin.auditResources.threadUpload,
      project_document: t.settings.productAdmin.auditResources.projectDocument,
      project_trash: t.settings.productAdmin.auditResources.projectTrash,
      project: t.settings.productAdmin.auditResources.project,
      scheduled_task: t.settings.productAdmin.auditResources.scheduledTask,
      memory: t.settings.productAdmin.auditResources.memory,
      memory_fact: t.settings.productAdmin.auditResources.memoryFact,
      custom_agent: t.settings.productAdmin.auditResources.customAgent,
      skill: t.settings.productAdmin.auditResources.skill,
      user_profile: t.settings.productAdmin.auditResources.userProfile,
      personal_access_token:
        t.settings.productAdmin.auditResources.personalAccessToken,
    };
    return labels[resourceType] ?? t.settings.productAdmin.auditResources.other;
  };
  const formatAuditOutcome = (outcome: string) => {
    if (outcome === "success")
      return t.settings.productAdmin.auditOutcomes.success;
    if (outcome === "not_found")
      return t.settings.productAdmin.auditOutcomes.notFound;
    if (outcome === "failure")
      return t.settings.productAdmin.auditOutcomes.failure;
    if (outcome === "cancelled")
      return t.settings.productAdmin.auditOutcomes.cancelled;
    return t.settings.productAdmin.auditOutcomes.other;
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t.settings.productAdmin.accountsTitle}
        description={t.settings.productAdmin.accountsDescription}
      >
        {accounts.isPending && !accounts.data ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t.settings.productAdmin.accountsLoading}
          </p>
        ) : accounts.isError && !accounts.data ? (
          <AdminDataErrorNotice
            message={t.settings.productAdmin.accountsLoadError}
            isFetching={accounts.isFetching}
            onRetry={() => void accounts.refetch()}
          />
        ) : (
          <>
            {accounts.isError ? (
              <AdminDataErrorNotice
                message={t.settings.productAdmin.refreshFailed}
                isFetching={accounts.isFetching}
                onRetry={() => void accounts.refetch()}
              />
            ) : null}
            {accounts.data.users.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t.settings.productAdmin.accountsEmpty}
              </p>
            ) : (
              <>
                {/* 手机端使用摘要卡片，桌面端使用表格；同一组服务端数据共享操作状态。 */}
                <ul
                  className="m-0 list-none space-y-3 p-0 md:hidden"
                  aria-label={t.settings.productAdmin.accountsTitle}
                >
                  {accounts.data.users.map((user) => (
                    <li key={user.id}>
                      <article className="space-y-3 rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium break-all">
                              {user.email}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {user.system_role === "admin"
                                ? t.settings.productAdmin.accountAdmin
                                : t.settings.productAdmin.accountMember}
                              <span aria-hidden="true"> · </span>
                              {formatAuditTime(user.created_at, locale)}
                            </p>
                          </div>
                          <Badge
                            variant={user.is_active ? "secondary" : "outline"}
                          >
                            {user.is_active
                              ? t.settings.productAdmin.accountActive
                              : t.settings.productAdmin.accountDisabled}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground text-xs">
                            {user.needs_setup
                              ? t.settings.productAdmin.accountNeedsSetup
                              : t.settings.productAdmin.accountReady}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={getAccountActionLabel(user)}
                            disabled={updateAccount.isPending}
                            onClick={() => openAccountStatusDialog(user)}
                          >
                            {user.is_active
                              ? t.settings.productAdmin.disableAccount
                              : t.settings.productAdmin.enableAccount}
                          </Button>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto rounded-md border md:block">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.accountEmail}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.accountRole}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.accountStatus}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.accountCreated}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.accountSetup}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.accountActions}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.data.users.map((user) => (
                        <tr key={user.id} className="border-t align-middle">
                          <td
                            className="max-w-64 truncate px-3 py-2"
                            title={user.email}
                          >
                            {user.email}
                          </td>
                          <td className="px-3 py-2">
                            {user.system_role === "admin"
                              ? t.settings.productAdmin.accountAdmin
                              : t.settings.productAdmin.accountMember}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={user.is_active ? "secondary" : "outline"}
                            >
                              {user.is_active
                                ? t.settings.productAdmin.accountActive
                                : t.settings.productAdmin.accountDisabled}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatAuditTime(user.created_at, locale)}
                          </td>
                          <td className="px-3 py-2">
                            {user.needs_setup
                              ? t.settings.productAdmin.accountNeedsSetup
                              : t.settings.productAdmin.accountReady}
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={getAccountActionLabel(user)}
                              disabled={updateAccount.isPending}
                              onClick={() => openAccountStatusDialog(user)}
                            >
                              {user.is_active
                                ? t.settings.productAdmin.disableAccount
                                : t.settings.productAdmin.enableAccount}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span>
                    {t.settings.productAdmin.accountCount.replace(
                      "{count}",
                      String(accounts.data.total),
                    )}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={accountOffset === 0}
                      onClick={() =>
                        setAccountOffset(Math.max(0, accountOffset - PAGE_SIZE))
                      }
                    >
                      {t.settings.productAdmin.accountsNewer}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        accountOffset + accounts.data.users.length >=
                        accounts.data.total
                      }
                      onClick={() =>
                        setAccountOffset(accountOffset + PAGE_SIZE)
                      }
                    >
                      {t.settings.productAdmin.accountsOlder}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
        {accountRunNotice && (
          <p
            role={accountRunNotice.needsAttention ? "alert" : "status"}
            className={
              accountRunNotice.needsAttention
                ? "text-destructive text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {accountRunNotice.message}
          </p>
        )}
        <Dialog
          open={accountToUpdate !== null}
          onOpenChange={(open) => {
            if (!open) closeAccountStatusDialog();
          }}
        >
          <DialogContent
            showCloseButton={!updateAccount.isPending}
            aria-busy={updateAccount.isPending}
            onEscapeKeyDown={(event) => {
              if (updateAccount.isPending) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (updateAccount.isPending) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t.settings.productAdmin.confirmAccountStatus}
              </DialogTitle>
              <DialogDescription>
                {accountToUpdate?.isActive
                  ? t.settings.productAdmin.confirmEnableDescription
                  : t.settings.productAdmin.confirmDisableDescription}
                {accountToUpdate && (
                  <span className="text-foreground mt-2 block font-medium break-all">
                    {accountToUpdate.user.email}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            {updateAccount.isError && (
              // 错误必须留在当前模态上下文中，避免被遮罩挡住或残留到下一次账号操作。
              <p role="alert" className="text-destructive text-sm">
                {updateAccount.error instanceof AdminUserStatusConflictError
                  ? t.settings.productAdmin.accountStatusConflict
                  : t.settings.productAdmin.accountUpdateError}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={updateAccount.isPending}
                onClick={closeAccountStatusDialog}
              >
                {t.settings.productAdmin.cancel}
              </Button>
              <Button
                variant={accountToUpdate?.isActive ? "default" : "destructive"}
                disabled={accountToUpdate === null || updateAccount.isPending}
                onClick={() => {
                  if (accountToUpdate) {
                    updateAccount.mutate({
                      actorUserId,
                      userId: accountToUpdate.user.id,
                      isActive: accountToUpdate.isActive,
                    });
                  }
                }}
              >
                {updateAccount.isPending
                  ? t.settings.productAdmin.updatingAccount
                  : t.settings.productAdmin.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsSection>

      <SettingsSection
        title={t.settings.productAdmin.configTitle}
        description={t.settings.productAdmin.configDescription}
      >
        {adminSettings.isPending && !adminSettings.data ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t.settings.productAdmin.loading}
          </p>
        ) : adminSettings.isError && !adminSettings.data ? (
          <AdminDataErrorNotice
            message={t.settings.productAdmin.configLoadError}
            isFetching={adminSettings.isFetching}
            onRetry={() => void adminSettings.refetch()}
          />
        ) : (
          <>
            {adminSettings.isError ? (
              <AdminDataErrorNotice
                message={t.settings.productAdmin.refreshFailed}
                isFetching={adminSettings.isFetching}
                onRetry={() => void adminSettings.refetch()}
              />
            ) : null}
            <div className="max-w-2xl space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm font-medium">
                  <span>{t.settings.productAdmin.englishName}</span>
                  <Input
                    value={form.name}
                    maxLength={80}
                    disabled={saveSettings.isPending}
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  <span>{t.settings.productAdmin.chineseName}</span>
                  <Input
                    value={form.name_zh}
                    maxLength={80}
                    disabled={saveSettings.isPending}
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        name_zh: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">
                  {t.settings.productAdmin.featureTitle}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PRODUCT_FEATURE_KEYS.map((key) => {
                    // 产品开关仅控制入口展示；未交付的能力要明确标记，不能让人误以为只是加载或权限问题。
                    const unavailable =
                      UNIMPLEMENTED_FEATURES.includes(key) &&
                      !form.features[key];
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={form.features[key]}
                          disabled={unavailable || saveSettings.isPending}
                          aria-describedby={
                            unavailable
                              ? "product-admin-unimplemented-features"
                              : undefined
                          }
                          onChange={(event) =>
                            updateForm((current) => ({
                              ...current,
                              features: {
                                ...current.features,
                                [key]: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span className="flex flex-wrap items-center gap-2">
                          {t.settings.productAdmin.features[key]}
                          {unavailable && (
                            <Badge variant="outline">
                              {t.settings.productAdmin.featureUnavailable}
                            </Badge>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t.settings.productAdmin.privacyNote}
                </p>
                <p
                  id="product-admin-unimplemented-features"
                  className="text-muted-foreground text-xs"
                >
                  {t.settings.productAdmin.unimplementedFeaturesNote}
                </p>
              </fieldset>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={[
                    saveSettings.isPending,
                    !hasUnsavedConfig,
                    form.name.trim() === "",
                    form.name_zh.trim() === "",
                  ].some(Boolean)}
                  onClick={() =>
                    saveSettings.mutate({
                      actorUserId,
                      settings: {
                        expected_version:
                          formDraft?.baseVersion ?? adminSettings.data.version,
                        ...form,
                      },
                    })
                  }
                >
                  {saveSettings.isPending
                    ? t.settings.productAdmin.saving
                    : t.settings.productAdmin.save}
                </Button>
                <span className="text-muted-foreground text-xs">
                  {t.settings.productAdmin.version.replace(
                    "{version}",
                    String(displayedConfigVersion),
                  )}
                </span>
                {hasUnsavedConfig && (
                  <span role="status" className="text-muted-foreground text-sm">
                    {t.settings.productAdmin.unsaved}
                  </span>
                )}
                {saveSettings.isSuccess && !hasUnsavedConfig && (
                  <span role="status" className="text-sm text-emerald-600">
                    {t.settings.productAdmin.saved}
                  </span>
                )}
                {saveSettings.isError && (
                  <div role="alert" className="flex items-center gap-2 text-sm">
                    <span className="text-destructive">
                      {saveSettings.error instanceof ProductConfigConflictError
                        ? t.settings.productAdmin.versionConflict
                        : t.settings.productAdmin.saveError}
                    </span>
                    {saveSettings.error instanceof
                      ProductConfigConflictError && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          saveSettings.reset();
                          const result = await adminSettings.refetch();
                          if (result.data) setFormDraft(null);
                        }}
                      >
                        {t.settings.productAdmin.reload}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SettingsSection>

      <SettingsSection
        title={t.settings.productAdmin.title}
        description={t.settings.productAdmin.description}
      >
        {audit.isPending && !audit.data ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t.settings.productAdmin.loading}
          </p>
        ) : audit.isError && !audit.data ? (
          <AdminDataErrorNotice
            message={t.settings.productAdmin.loadError}
            isFetching={audit.isFetching}
            onRetry={() => void audit.refetch()}
          />
        ) : (
          <>
            {audit.isError ? (
              <AdminDataErrorNotice
                message={t.settings.productAdmin.refreshFailed}
                isFetching={audit.isFetching}
                onRetry={() => void audit.refetch()}
              />
            ) : null}
            {audit.data.events.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t.settings.productAdmin.empty}
              </p>
            ) : (
              <>
                {/* 窄屏改为纵向摘要卡片，避免审计表格强制横向滚动；桌面保留完整列。 */}
                <ul
                  className="m-0 list-none space-y-3 p-0 md:hidden"
                  aria-label={t.settings.productAdmin.title}
                >
                  {audit.data.events.map((event) => (
                    <li key={event.event_id}>
                      <article className="space-y-3 rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium">
                              {formatAuditAction(event.action)}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {formatAuditTime(event.occurred_at, locale)}
                            </p>
                          </div>
                          <Badge
                            variant={
                              event.outcome === "success"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {formatAuditOutcome(event.outcome)}
                          </Badge>
                        </div>
                        <p className="text-sm">
                          <span className="text-muted-foreground">
                            {formatAuditResource(event.resource_type)}
                          </span>
                          <span className="mx-1" aria-hidden="true">
                            ·
                          </span>
                          <span className="break-all">{event.resource_id}</span>
                        </p>
                        <p
                          className="text-muted-foreground truncate text-xs"
                          title={event.actor_user_id}
                        >
                          {t.settings.productAdmin.actor}: {event.actor_user_id}
                        </p>
                        {event.request_id && (
                          <details className="text-muted-foreground text-xs">
                            <summary className="cursor-pointer">
                              {t.settings.productAdmin.requestId}
                            </summary>
                            <code className="mt-1 block break-all">
                              {event.request_id}
                            </code>
                          </details>
                        )}
                      </article>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto rounded-md border md:block">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.time}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.actor}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.action}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.resource}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.result}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t.settings.productAdmin.requestId}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.data.events.map((event) => (
                        <tr key={event.event_id} className="border-t align-top">
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatAuditTime(event.occurred_at, locale)}
                          </td>
                          <td
                            className="max-w-44 truncate px-3 py-2"
                            title={event.actor_user_id}
                          >
                            {event.actor_user_id}
                          </td>
                          <td className="px-3 py-2">
                            {formatAuditAction(event.action)}
                          </td>
                          <td
                            className="max-w-44 truncate px-3 py-2"
                            title={event.resource_id}
                          >
                            {formatAuditResource(event.resource_type)}:{" "}
                            {event.resource_id}
                          </td>
                          <td className="px-3 py-2">
                            {formatAuditOutcome(event.outcome)}
                          </td>
                          <td
                            className="max-w-40 truncate px-3 py-2"
                            title={event.request_id ?? undefined}
                          >
                            {event.request_id ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    {t.settings.productAdmin.newer}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    // 新版 API 精确报告是否还有记录；保留旧 Gateway 的页长回退。
                    disabled={
                      !(
                        audit.data.has_more ??
                        audit.data.events.length === PAGE_SIZE
                      )
                    }
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    {t.settings.productAdmin.older}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </SettingsSection>
    </div>
  );
}

function AdminDataErrorNotice({
  message,
  isFetching,
  onRetry,
}: {
  message: string;
  isFetching: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  // 首次加载失败时由页面级错误态接管；刷新失败时保留已缓存的数据，并提供就地重试。
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:text-amber-200"
    >
      <span className="flex items-center gap-2">
        <AlertCircleIcon className="size-4 shrink-0" />
        {message}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={isFetching}
        onClick={onRetry}
      >
        <RefreshCwIcon className="size-4" />
        {isFetching
          ? t.settings.productAdmin.loading
          : t.settings.productAdmin.retry}
      </Button>
    </div>
  );
}

function formatAuditTime(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
