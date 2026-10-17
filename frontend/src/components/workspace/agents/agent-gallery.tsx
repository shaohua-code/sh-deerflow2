"use client";

import {
  AlertCircleIcon,
  BotIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useAgents } from "@/core/agents";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  getMissingPermissions,
  hasPermission,
  PERMISSIONS,
} from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";

import { AgentCard } from "./agent-card";

export function AgentGallery() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canRead = hasPermission(user, PERMISSIONS.AGENTS_READ);
  const canEdit = hasPermission(user, PERMISSIONS.AGENTS_WRITE);
  const canDelete = hasPermission(user, PERMISSIONS.AGENTS_DELETE);
  const createPermissionsMissing = getMissingPermissions(user, [
    PERMISSIONS.AGENTS_READ,
    PERMISSIONS.AGENTS_WRITE,
    PERMISSIONS.RUNS_CREATE,
  ]);
  const restrictedPermissions = getMissingPermissions(user, [
    PERMISSIONS.AGENTS_READ,
    PERMISSIONS.AGENTS_WRITE,
    PERMISSIONS.AGENTS_DELETE,
    PERMISSIONS.RUNS_CREATE,
  ]);
  // 明确缺少目录读取权限时停止请求，避免把缓存里的其他账号数据继续显示。
  const { agents, isLoading, isFetching, error, refetch } = useAgents(canRead);
  const router = useRouter();

  const handleNewAgent = () => {
    router.push("/workspace/agents/new");
  };

  return (
    <div className="flex size-full flex-col">
      {/* Page header */}
      <div className="flex flex-col gap-4 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t.agents.title}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t.agents.description}
          </p>
        </div>
        {/* 窄屏主操作单独占行，给标题和说明留出阅读宽度。 */}
        {createPermissionsMissing.length === 0 ? (
          <Button
            className="w-full shrink-0 sm:w-auto"
            onClick={handleNewAgent}
          >
            <PlusIcon className="mr-1.5 h-4 w-4" />
            {t.agents.newAgent}
          </Button>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {restrictedPermissions.length > 0 ? (
          <p className="text-muted-foreground mb-4 text-sm" role="status">
            {t.agents.permissionActionsLimited(
              restrictedPermissions.join(", "),
            )}
          </p>
        ) : null}
        {/* Gateway 请求失败不能等同于用户没有自建智能体，避免误导成数据丢失。 */}
        {!canRead ? (
          <div
            className="border-destructive/30 bg-destructive/5 flex h-40 items-center justify-center rounded-lg border p-4 text-center text-sm"
            role="alert"
          >
            {t.agents.permissionRequired(PERMISSIONS.AGENTS_READ)}
          </div>
        ) : isLoading ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            {t.common.loading}
          </div>
        ) : error && agents.length === 0 ? (
          <div
            className="flex h-64 flex-col items-center justify-center gap-3 text-center"
            role="alert"
          >
            <div className="bg-destructive/10 flex h-14 w-14 items-center justify-center rounded-full">
              <AlertCircleIcon className="text-destructive h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">{t.agents.loadFailed}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.agents.loadFailedHint}
              </p>
            </div>
            <Button
              variant="outline"
              className="mt-2"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCwIcon
                className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
              {isFetching ? t.agents.retrying : t.agents.retry}
            </Button>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="bg-muted flex h-14 w-14 items-center justify-center rounded-full">
              <BotIcon className="text-muted-foreground h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">{t.agents.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.agents.emptyDescription}
              </p>
            </div>
            {createPermissionsMissing.length === 0 ? (
              <Button
                variant="outline"
                className="mt-2"
                onClick={handleNewAgent}
              >
                <PlusIcon className="mr-1.5 h-4 w-4" />
                {t.agents.newAgent}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div
                className="border-destructive/30 bg-destructive/5 flex items-center justify-between gap-4 rounded-lg border p-3 text-sm"
                role="alert"
              >
                <span>{t.agents.loadFailed}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  <RefreshCwIcon
                    className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                  />
                  {isFetching ? t.agents.retrying : t.agents.retry}
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.name}
                  agent={agent}
                  canEdit={canEdit}
                  canDelete={canDelete}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
