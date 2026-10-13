"use client";

import { LoaderCircleIcon, LogOutIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetch, getCsrfHeaders } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";
import { parseAuthError } from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";
import {
  createUserDataExport,
  type DataExportProgress,
} from "@/product/data-export";

import { SettingsSection } from "./settings-section";
import type { SettingsUnsavedChangesHandler } from "./settings-unsaved-changes";

export function AccountSettingsPage({
  onUnsavedChangesChange,
}: {
  onUnsavedChangesChange?: SettingsUnsavedChangesHandler;
} = {}) {
  const { user } = useAuth();

  // 密码表单和导出进度都只属于当前账号；身份变化时卸载旧状态并中止进行中的导出。
  return (
    <AccountSettingsContent
      key={user?.id ?? "anonymous"}
      onUnsavedChangesChange={onUnsavedChangesChange}
    />
  );
}

function AccountSettingsContent({
  onUnsavedChangesChange,
}: {
  onUnsavedChangesChange?: SettingsUnsavedChangesHandler;
}) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const isSsoUser = Boolean(user?.oauth_provider);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportCancelled, setExportCancelled] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [exportProgress, setExportProgress] =
    useState<DataExportProgress | null>(null);
  const activeExport = useRef<AbortController | null>(null);
  const hasPasswordDraft = Boolean(
    currentPassword || newPassword || confirmPassword,
  );

  useEffect(() => {
    if (!onUnsavedChangesChange) return;
    onUnsavedChangesChange(
      hasPasswordDraft
        ? {
            isPending: loading,
            discard: () => {
              setCurrentPassword("");
              setNewPassword("");
              setConfirmPassword("");
              setMessage("");
              setError("");
            },
          }
        : null,
    );
    return () => onUnsavedChangesChange(null);
  }, [hasPasswordDraft, loading, onUnsavedChangesChange]);

  useEffect(
    () => () => {
      // 关闭设置或切换页面时停止本页面发起的导出，避免稍后意外触发下载。
      activeExport.current?.abort();
    },
    [],
  );

  const handleExportData = async () => {
    if (!user?.id) return;
    const controller = new AbortController();
    activeExport.current = controller;
    setExporting(true);
    setExportMessage("");
    setExportError("");
    setExportCancelled(false);
    setCancelRequested(false);
    try {
      const data = await createUserDataExport(user.id, setExportProgress, {
        signal: controller.signal,
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `flow-desk-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      // 当前导出器只汇总 Gateway 暴露的数据，不包含可恢复 checkpoint 和密钥，必须始终提醒用户其覆盖范围有限。
      setExportMessage(t.settings.account.exportDataPartial);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setExportCancelled(true);
      } else {
        setExportError(t.settings.account.exportDataError);
      }
    } finally {
      if (activeExport.current === controller) activeExport.current = null;
      setExporting(false);
      setCancelRequested(false);
      setExportProgress(null);
    }
  };

  const handleCancelExport = () => {
    if (!activeExport.current) return;
    setCancelRequested(true);
    activeExport.current.abort();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError(t.settings.account.passwordMismatch);
      return;
    }
    if (newPassword.length < 8) {
      setError(t.settings.account.passwordTooShort);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeaders(),
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const authError = parseAuthError(data);
        setError(authError.message);
        return;
      }

      setMessage(t.settings.account.passwordChangedSuccess);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError(t.settings.account.networkError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title={t.settings.account.profileTitle}>
        <div className="space-y-2">
          <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
            <span className="text-muted-foreground text-sm">
              {t.settings.account.email}
            </span>
            <span className="min-w-0 text-sm font-medium break-all">
              {user?.email ?? "—"}
            </span>
            <span className="text-muted-foreground text-sm">
              {t.settings.account.role}
            </span>
            <span className="text-sm font-medium capitalize">
              {user?.system_role ?? "—"}
            </span>
            {isSsoUser && (
              <>
                <span className="text-muted-foreground text-sm">
                  {t.settings.account.ssoProvider}
                </span>
                <span className="min-w-0 text-sm font-medium break-words capitalize">
                  {user?.oauth_provider}
                </span>
              </>
            )}
          </div>
        </div>
      </SettingsSection>

      {!isSsoUser ? (
        <SettingsSection
          title={t.settings.account.changePasswordTitle}
          description={t.settings.account.changePasswordDescription}
        >
          <form onSubmit={handleChangePassword} className="max-w-sm space-y-3">
            <Input
              type="password"
              placeholder={t.settings.account.currentPassword}
              aria-label={t.settings.account.currentPassword}
              autoComplete="current-password"
              value={currentPassword}
              disabled={loading}
              onChange={(e) => {
                setError("");
                setMessage("");
                setCurrentPassword(e.target.value);
              }}
              required
            />
            <Input
              type="password"
              placeholder={t.settings.account.newPassword}
              aria-label={t.settings.account.newPassword}
              autoComplete="new-password"
              value={newPassword}
              disabled={loading}
              onChange={(e) => {
                setError("");
                setMessage("");
                setNewPassword(e.target.value);
              }}
              required
              minLength={8}
            />
            <Input
              type="password"
              placeholder={t.settings.account.confirmNewPassword}
              aria-label={t.settings.account.confirmNewPassword}
              autoComplete="new-password"
              value={confirmPassword}
              disabled={loading}
              onChange={(e) => {
                setError("");
                setMessage("");
                setConfirmPassword(e.target.value);
              }}
              required
              minLength={8}
            />
            {hasPasswordDraft && !loading && (
              <p role="status" className="text-muted-foreground text-sm">
                {t.settings.account.unsavedPasswordChanges}
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="text-sm text-emerald-600 dark:text-emerald-400"
              >
                {message}
              </p>
            )}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={loading}
            >
              {loading
                ? t.settings.account.updating
                : t.settings.account.updatePassword}
            </Button>
          </form>
        </SettingsSection>
      ) : (
        <SettingsSection
          title={t.settings.account.changePasswordTitle}
          description={t.settings.account.ssoPasswordDescription}
        >
          <p className="text-muted-foreground text-sm">
            {t.settings.account.ssoPasswordMessage.replace(
              "{provider}",
              user?.oauth_provider ?? "",
            )}
          </p>
        </SettingsSection>
      )}

      <SettingsSection
        title={t.settings.account.exportDataTitle}
        description={t.settings.account.exportDataDescription}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportData}
              disabled={exporting || !user?.id}
            >
              {exporting
                ? t.settings.account.exportingData
                : t.settings.account.exportDataButton}
            </Button>
            {exporting && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelExport}
                disabled={cancelRequested}
              >
                {cancelRequested
                  ? t.settings.account.cancellingDataExport
                  : t.settings.account.cancelDataExport}
              </Button>
            )}
          </div>
          {exporting && exportProgress && (
            <ExportProgress progress={exportProgress} />
          )}
          {exportMessage && (
            <p role="status" className="text-sm text-green-600">
              {exportMessage}
            </p>
          )}
          {exportCancelled && (
            <p role="status" className="text-muted-foreground text-sm">
              {t.settings.account.exportDataCancelled}
            </p>
          )}
          {exportError && (
            <p role="alert" className="text-destructive text-sm">
              {exportError}
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="" description="">
        <Button
          variant="destructive"
          size="sm"
          onClick={logout}
          className="gap-2"
        >
          <LogOutIcon className="size-4" />
          {t.settings.account.signOut}
        </Button>
      </SettingsSection>
    </div>
  );
}

/** 把导出器阶段映射成用户能理解的进度，隐藏分页和存储实现细节。 */
function ExportProgress({ progress }: { progress: DataExportProgress }) {
  const { t } = useI18n();
  const stageLabels = {
    inventory: t.settings.account.exportStageInventory,
    history: t.settings.account.exportStageHistory,
    files: t.settings.account.exportStageFiles,
    package: t.settings.account.exportStagePackage,
  };
  const hasCount =
    progress.completed !== undefined &&
    progress.total !== undefined &&
    progress.total > 0;
  const percent = hasCount
    ? Math.round((progress.completed! / progress.total!) * 100)
    : undefined;

  return (
    <div className="max-w-md space-y-2" aria-live="polite">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        <span>
          {stageLabels[progress.stage]}
          {hasCount && ` · ${progress.completed}/${progress.total}`}
        </span>
      </div>
      {percent !== undefined ? (
        <div
          role="progressbar"
          aria-label={stageLabels[progress.stage]}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="bg-muted h-2 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : (
        <div
          role="progressbar"
          aria-label={stageLabels[progress.stage]}
          className="bg-primary/20 h-2 overflow-hidden rounded-full"
        >
          <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
        </div>
      )}
    </div>
  );
}
