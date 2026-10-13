"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Clock3,
  FileText,
  Files,
  LayoutDashboard,
  MessageSquarePlus,
  Search,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useAgentsApiEnabled } from "@/core/agents";
import type { Agent } from "@/core/agents";
import { listAgents } from "@/core/agents/api";
import { useAuth } from "@/core/auth/AuthProvider";
import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";
import type { Locale } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import { isStaticWebsiteOnly } from "@/core/static-mode";
import { searchThreads } from "@/core/threads/api";
import type { AgentThread } from "@/core/threads/types";
import {
  agentNameOfThread,
  pathOfThread,
  titleOfThread,
} from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";
import { fetchProductFiles, type ProductFileEntry } from "@/product/api";

import { BrandMark } from "./brand-mark";
import { getProductCopy } from "./copy";
import { useProductBootstrap, useProductBrandName } from "./hooks";

const RECENT_FILE_LIMIT = 5;
const ACTIVE_TASK_LIMIT = 5;
const RECENT_AGENT_LIMIT = 3;
const DEFAULT_AGENT_ID = "lead_agent";

export function WorkspaceHome() {
  const { locale, t } = useI18n();
  const copy = getProductCopy(locale);
  const brandName = useProductBrandName(locale);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const staticMode = isStaticWebsiteOnly();
  // 后端仅下发经过 allowlist 的产品开关；失败时保留默认入口，API 权限仍由 Gateway 决定。
  const bootstrapQuery = useProductBootstrap();
  const features = bootstrapQuery.data?.features;
  // 总览入口同时受产品展示开关与 Gateway 能力响应约束，避免链接到不可用路由。
  const {
    enabled: agentsApiEnabled,
    isError: agentsCapabilityError,
    isLoading: agentsCapabilityLoading,
  } = useAgentsApiEnabled();
  // 总览线程列表使用现有 owner-scoped 搜索 API，并按账号分区缓存，避免切换账号时短暂串显旧数据。
  const showChats = features?.chats ?? true;
  const canReadThreads = hasPermission(user, PERMISSIONS.THREADS_READ);
  const canReadAgents = hasPermission(user, PERMISSIONS.AGENTS_READ);
  const canReadProjects = hasPermission(user, PERMISSIONS.PROJECTS_READ);
  const canCreateRuns = hasPermission(user, PERMISSIONS.RUNS_CREATE);
  // 总览会话、运行状态与最近文件分别复用 Gateway 路由授权；显式撤权时不显示缓存。
  const showRecentThreads = showChats && canReadThreads;
  const showStartChat = showChats && canCreateRuns;
  const canReadFiles = canReadThreads && canReadProjects;
  const showRecentFiles = features?.files === true && canReadFiles;

  useEffect(() => {
    // 权限在工作台打开期间可能被撤销；隐藏页面内容的同时清掉各自的数据缓存。
    if (!canReadThreads) {
      queryClient.removeQueries({ queryKey: ["product", "dashboard-threads"] });
      queryClient.removeQueries({
        queryKey: ["product", "dashboard-active-threads"],
      });
    }
    if (!canReadAgents) {
      queryClient.removeQueries({ queryKey: ["product", "dashboard-agents"] });
    }
    if (!canReadFiles) {
      queryClient.removeQueries({ queryKey: ["product", "dashboard-files"] });
    }
  }, [canReadAgents, canReadFiles, canReadThreads, queryClient]);

  // 能力探测失败时保留前往可重试错误页的入口，但暂不读取自建 Agent 目录。
  // 浏览器上次缓存的关闭值不能被当成这次 Gateway 的明确关闭结果。
  const showAgentsEntry =
    (features?.agents ?? true) &&
    canReadAgents &&
    (agentsApiEnabled || agentsCapabilityError);
  const showAgentInsights =
    showChats &&
    showAgentsEntry &&
    canReadThreads &&
    canCreateRuns &&
    !agentsCapabilityError &&
    !agentsCapabilityLoading;
  const showCapabilities = features?.capabilities ?? true;
  const actionCardCount =
    Number(showRecentThreads) +
    Number(showAgentsEntry) +
    Number(showCapabilities) +
    Number(showRecentFiles);
  // 按实际启用的入口数选择列数，避免四张卡片时出现孤零零的第二行，或三张卡片被压成窄列。
  const actionGridClassName =
    actionCardCount === 4
      ? "mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      : actionCardCount === 3
        ? "mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        : actionCardCount === 2
          ? "mt-8 grid gap-3 sm:grid-cols-2"
          : "mt-8 grid gap-3";
  const showDashboardInsights = showRecentThreads || showAgentInsights;
  const recentThreadsQuery = useQuery<AgentThread[]>({
    queryKey: [
      "product",
      "dashboard-threads",
      staticMode ? "demo" : (user?.id ?? null),
    ],
    queryFn: ({ signal }) =>
      searchThreads({ archived: false, limit: 50, offset: 0, signal }),
    enabled: showRecentThreads && (staticMode ? true : Boolean(user?.id)),
    staleTime: 0,
    retry: false,
  });
  // 查询库保留上次成功的数据；后台刷新失败时先展示这份快照，首次读取失败才显示整块错误态。
  const recentThreadPool = recentThreadsQuery.data ?? [];
  const recentThreads = recentThreadPool.slice(0, 5);
  // 只查当前用户仍处于 busy 状态的会话；缓存按账号分区，短间隔刷新让状态跟上 Gateway。
  const activeTasksQuery = useQuery<AgentThread[]>({
    queryKey: ["product", "dashboard-active-threads", user?.id ?? null],
    queryFn: ({ signal }) =>
      searchThreads({
        archived: false,
        status: "busy",
        limit: ACTIVE_TASK_LIMIT,
        offset: 0,
        signal,
      }),
    enabled: showRecentThreads && Boolean(user?.id) && !staticMode,
    staleTime: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  // Agent 目录可能包含当前账号的自建定义，因此也使用账号分区缓存并在静态演示中关闭。
  const agentsDirectoryQuery = useQuery<Agent[]>({
    queryKey: ["product", "dashboard-agents", user?.id ?? null],
    queryFn: listAgents,
    enabled: showAgentInsights && Boolean(user?.id) && !staticMode,
    staleTime: 0,
    retry: false,
  });
  const activeTasks = activeTasksQuery.data ?? [];
  // 使用频次只从当前用户最近 50 个会话摘要计算，不新建另一份行为统计数据。
  const recentAgentUsage = new Map<string, number>();
  for (const thread of recentThreadPool) {
    const agentName = agentNameOfThread(thread) ?? DEFAULT_AGENT_ID;
    recentAgentUsage.set(agentName, (recentAgentUsage.get(agentName) ?? 0) + 1);
  }
  const frequentAgents = (agentsDirectoryQuery.data ?? [])
    .filter((agent) => agent.name !== DEFAULT_AGENT_ID)
    .map((agent) => ({
      agent,
      usageCount: recentAgentUsage.get(agent.name) ?? 0,
    }))
    .filter(({ usageCount }) => usageCount > 0)
    .sort(
      (left, right) =>
        right.usageCount - left.usageCount ||
        left.agent.name.localeCompare(right.agent.name),
    )
    .slice(0, RECENT_AGENT_LIMIT);
  const defaultAgentUsage = recentAgentUsage.get(DEFAULT_AGENT_ID) ?? 0;
  // Query key 按登录用户隔离；文件内容和权限仍由 Gateway 的 artifact URL 负责。
  const recentFilesQuery = useQuery({
    queryKey: ["product", "dashboard-files", user?.id ?? null],
    queryFn: ({ signal }) =>
      fetchProductFiles(RECENT_FILE_LIMIT, 0, "", signal),
    enabled: showRecentFiles && Boolean(user?.id) && !staticMode,
    staleTime: 0,
    retry: false,
  });
  const recentFiles = recentFilesQuery.data?.files ?? [];
  const showCoverageNote =
    recentFilesQuery.data?.truncated === true ||
    (recentFilesQuery.data?.failed_count ?? 0) > 0 ||
    (recentFilesQuery.data?.coverage_notes.length ?? 0) > 0;
  const showTwoPanels = showRecentFiles && showRecentThreads;

  return (
    <WorkspaceContainer className="bg-background">
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-5 pt-8 pb-12 sm:px-8 sm:pt-11 lg:px-12">
          <section className="border-primary/10 from-primary/[0.09] via-card relative isolate overflow-hidden rounded-[1.75rem] border bg-gradient-to-br to-emerald-500/[0.06] px-6 py-8 sm:px-9 sm:py-10 lg:px-11 lg:py-12">
            <div className="border-primary/10 pointer-events-none absolute -top-24 -right-10 -z-10 size-80 rounded-full border" />
            <div className="border-primary/10 pointer-events-none absolute -top-16 -right-2 -z-10 size-64 rounded-full border" />
            <div className="max-w-3xl">
              <div className="border-primary/15 bg-background/70 text-primary mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm">
                <BrandMark className="size-5 rounded-md" />
                {copy.dashboardEyebrow}
              </div>
              <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-[-0.04em] text-balance sm:text-4xl lg:text-[3.25rem]">
                {copy.dashboardTitle}
              </h1>
              <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-6 sm:text-base sm:leading-7">
                {copy.dashboardDescription}
              </p>
              {showStartChat && (
                <Link
                  href="/workspace/chats/new"
                  className="bg-primary text-primary-foreground shadow-primary/15 hover:shadow-primary/20 mt-7 inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <MessageSquarePlus className="size-4" />
                  {copy.startChat}
                  <ArrowRight className="ml-1 size-4" />
                </Link>
              )}
            </div>
          </section>

          {actionCardCount > 0 && (
            <section aria-label={copy.overview} className={actionGridClassName}>
              {showRecentThreads && (
                <ActionCard
                  href="/workspace/chats"
                  icon={<Search className="size-4" />}
                  title={copy.openChats}
                  description={copy.openChatsDescription}
                  tone="blue"
                />
              )}
              {showAgentsEntry && (
                <ActionCard
                  href="/workspace/agents"
                  icon={<Bot className="size-4" />}
                  title={copy.exploreAgents}
                  description={
                    agentsCapabilityError
                      ? copy.exploreAgentsCheckFailed
                      : agentsCapabilityLoading
                        ? copy.exploreAgentsChecking
                        : copy.exploreAgentsDescription
                  }
                  tone="violet"
                />
              )}
              {showCapabilities && (
                <ActionCard
                  href="/workspace/capabilities"
                  icon={<FileText className="size-4" />}
                  title={t.capabilities.title}
                  description={t.capabilities.description}
                  tone="green"
                />
              )}
              {showRecentFiles && (
                <ActionCard
                  href="/workspace/files"
                  icon={<Files className="size-4" />}
                  title={copy.filesTitle}
                  description={copy.filesDescription}
                  tone="green"
                />
              )}
            </section>
          )}

          <div
            className={
              showTwoPanels
                ? "mt-11 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
                : "mt-11 space-y-10"
            }
          >
            {showRecentThreads && (
              <section aria-labelledby="recent-work-title">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <h2
                      id="recent-work-title"
                      className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-[0.15em] uppercase"
                    >
                      <Clock3 className="size-3.5" />
                      {copy.recentWork}
                    </h2>
                    <p className="text-muted-foreground mt-1.5 text-sm">
                      {brandName}
                    </p>
                  </div>
                  <Link
                    href="/workspace/chats"
                    className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                  >
                    {copy.seeAll}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>

                <div className="border-border/70 bg-card overflow-hidden rounded-2xl border">
                  {recentThreadsQuery.isLoading ? (
                    <div className="space-y-3 p-5" role="status">
                      <span className="sr-only">{copy.loading}</span>
                      {[0, 1, 2].map((item) => (
                        <div
                          key={item}
                          className="bg-muted h-12 animate-pulse rounded-xl"
                        />
                      ))}
                    </div>
                  ) : recentThreadsQuery.isError &&
                    recentThreadsQuery.data === undefined ? (
                    <div className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-muted-foreground text-sm">
                        {copy.loadFailed}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void recentThreadsQuery.refetch()}
                      >
                        {copy.retry}
                      </Button>
                    </div>
                  ) : recentThreads.length ? (
                    <ul className="divide-border/70 divide-y">
                      {recentThreads.map((thread) => (
                        <li key={thread.thread_id}>
                          <Link
                            href={pathOfThread(thread)}
                            className="group hover:bg-muted/55 flex items-center gap-4 px-4 py-4 transition-colors sm:px-5"
                          >
                            <span className="bg-primary/8 text-primary group-hover:bg-primary/12 grid size-10 shrink-0 place-items-center rounded-xl transition-colors">
                              <MessageSquarePlus className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {titleOfThread(thread)}
                              </span>
                              <span className="text-muted-foreground mt-1 block text-xs">
                                {thread.updated_at
                                  ? formatTimeAgo(thread.updated_at)
                                  : copy.recentWork}
                              </span>
                            </span>
                            <ArrowRight className="text-muted-foreground/50 group-hover:text-primary size-4 shrink-0 transition duration-200 group-hover:translate-x-0.5" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex flex-col items-center px-6 py-10 text-center">
                      <span className="bg-muted text-muted-foreground grid size-11 place-items-center rounded-2xl">
                        <LayoutDashboard className="size-5" />
                      </span>
                      <p className="text-muted-foreground mt-3 text-sm">
                        {copy.noRecent}
                      </p>
                      {showStartChat && (
                        <Link
                          href="/workspace/chats/new"
                          className="text-primary mt-3 text-sm font-medium hover:underline"
                        >
                          {copy.startChat}
                        </Link>
                      )}
                    </div>
                  )}
                  {recentThreadsQuery.isError &&
                    recentThreadsQuery.data !== undefined && (
                      <RefreshFailureNotice
                        message={copy.recentWorkRefreshFailed}
                        isFetching={recentThreadsQuery.isFetching}
                        onRetry={() => void recentThreadsQuery.refetch()}
                        copy={copy}
                      />
                    )}
                </div>
              </section>
            )}

            {showRecentFiles && (
              <section aria-labelledby="recent-files-title">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <h2
                      id="recent-files-title"
                      className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-[0.15em] uppercase"
                    >
                      <Files className="size-3.5" />
                      {copy.recentFilesTitle}
                    </h2>
                    <p className="text-muted-foreground mt-1.5 text-sm">
                      {copy.recentFilesDescription}
                    </p>
                  </div>
                  <Link
                    href="/workspace/files"
                    className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                  >
                    {copy.seeAll}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>

                <div className="border-border/70 bg-card overflow-hidden rounded-2xl border">
                  {recentFilesQuery.isLoading ? (
                    <div className="space-y-3 p-5" role="status">
                      <span className="sr-only">{copy.recentFilesLoading}</span>
                      {[0, 1, 2].map((item) => (
                        <div
                          key={item}
                          className="bg-muted h-12 animate-pulse rounded-xl"
                        />
                      ))}
                    </div>
                  ) : recentFilesQuery.isError && recentFiles.length === 0 ? (
                    <div
                      className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between"
                      role="alert"
                    >
                      <p className="text-muted-foreground text-sm">
                        {copy.recentFilesLoadFailed}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void recentFilesQuery.refetch()}
                      >
                        {copy.retry}
                      </Button>
                    </div>
                  ) : recentFiles.length > 0 ? (
                    <>
                      {recentFilesQuery.isError && (
                        <div
                          className="flex flex-col items-start justify-between gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:px-5"
                          role="alert"
                        >
                          <p className="text-muted-foreground text-sm">
                            {copy.recentFilesRefreshFailed}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={recentFilesQuery.isFetching}
                            onClick={() => void recentFilesQuery.refetch()}
                          >
                            {copy.retry}
                          </Button>
                        </div>
                      )}
                      <ul className="divide-border/70 divide-y">
                        {recentFiles.map((file) => (
                          <RecentFileRow
                            key={file.file_id}
                            file={file}
                            locale={locale}
                            copy={copy}
                          />
                        ))}
                      </ul>
                      {showCoverageNote && (
                        <p
                          role="status"
                          className="text-muted-foreground border-t px-4 py-3 text-xs leading-5 sm:px-5"
                        >
                          {copy.recentFilesIncomplete}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center px-6 py-10 text-center">
                      <span className="bg-muted text-muted-foreground grid size-11 place-items-center rounded-2xl">
                        <Files className="size-5" />
                      </span>
                      <p className="text-muted-foreground mt-3 max-w-sm text-sm leading-6">
                        {staticMode
                          ? copy.filesDemoEmpty
                          : copy.recentFilesEmpty}
                      </p>
                      {showCoverageNote && (
                        <p
                          role="status"
                          className="text-muted-foreground mt-2 max-w-sm text-xs leading-5"
                        >
                          {copy.recentFilesIncomplete}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>

          {showDashboardInsights && (
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {showRecentThreads && (
                <section aria-labelledby="active-tasks-title">
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                      <h2
                        id="active-tasks-title"
                        className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-[0.15em] uppercase"
                      >
                        <Activity className="size-3.5" />
                        {copy.activeTasksTitle}
                      </h2>
                      <p className="text-muted-foreground mt-1.5 text-sm">
                        {copy.activeTasksDescription}
                      </p>
                    </div>
                    <Link
                      href="/workspace/chats"
                      className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    >
                      {copy.seeAll}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </div>

                  <div className="border-border/70 bg-card overflow-hidden rounded-2xl border">
                    {activeTasksQuery.isLoading ? (
                      <div className="space-y-3 p-5" role="status">
                        <span className="sr-only">
                          {copy.activeTasksLoading}
                        </span>
                        {[0, 1].map((item) => (
                          <div
                            key={item}
                            className="bg-muted h-12 animate-pulse rounded-xl"
                          />
                        ))}
                      </div>
                    ) : activeTasksQuery.isError &&
                      activeTasksQuery.data === undefined ? (
                      <div
                        className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between"
                        role="alert"
                      >
                        <p className="text-muted-foreground text-sm">
                          {copy.activeTasksLoadFailed}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void activeTasksQuery.refetch()}
                        >
                          {copy.retry}
                        </Button>
                      </div>
                    ) : activeTasks.length > 0 ? (
                      <ul className="divide-border/70 divide-y">
                        {activeTasks.map((thread) => (
                          <li key={thread.thread_id}>
                            <Link
                              href={pathOfThread(thread)}
                              aria-label={`${copy.activeTask}: ${titleOfThread(thread)}`}
                              className="group hover:bg-muted/55 flex items-center gap-4 px-4 py-4 transition-colors sm:px-5"
                            >
                              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                <span className="relative flex size-2.5">
                                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-50" />
                                  <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                                </span>
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {titleOfThread(thread)}
                                </span>
                                <span className="text-muted-foreground mt-1 block text-xs">
                                  {copy.activeTask}
                                  {thread.updated_at
                                    ? ` · ${formatTimeAgo(thread.updated_at, locale)}`
                                    : ""}
                                </span>
                              </span>
                              <ArrowRight className="text-muted-foreground/50 group-hover:text-primary size-4 shrink-0 transition duration-200 group-hover:translate-x-0.5" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="flex flex-col items-center px-6 py-10 text-center">
                        <span className="bg-muted text-muted-foreground grid size-11 place-items-center rounded-2xl">
                          <Activity className="size-5" />
                        </span>
                        <p className="text-muted-foreground mt-3 max-w-sm text-sm leading-6">
                          {staticMode
                            ? copy.activeTasksDemoEmpty
                            : copy.activeTasksEmpty}
                        </p>
                      </div>
                    )}
                    {activeTasksQuery.isError &&
                      activeTasksQuery.data !== undefined && (
                        <RefreshFailureNotice
                          message={copy.activeTasksRefreshFailed}
                          isFetching={activeTasksQuery.isFetching}
                          onRetry={() => void activeTasksQuery.refetch()}
                          copy={copy}
                        />
                      )}
                  </div>
                </section>
              )}

              {showAgentInsights && (
                <section aria-labelledby="frequent-agents-title">
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div>
                      <h2
                        id="frequent-agents-title"
                        className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-[0.15em] uppercase"
                      >
                        <Bot className="size-3.5" />
                        {copy.frequentAgentsTitle}
                      </h2>
                      <p className="text-muted-foreground mt-1.5 text-sm">
                        {copy.frequentAgentsDescription}
                      </p>
                    </div>
                    <Link
                      href="/workspace/agents"
                      className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    >
                      {copy.seeAll}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </div>

                  <div className="border-border/70 bg-card overflow-hidden rounded-2xl border">
                    {agentsDirectoryQuery.isLoading ? (
                      <div className="space-y-3 p-5" role="status">
                        <span className="sr-only">
                          {copy.frequentAgentsLoading}
                        </span>
                        {[0, 1].map((item) => (
                          <div
                            key={item}
                            className="bg-muted h-12 animate-pulse rounded-xl"
                          />
                        ))}
                      </div>
                    ) : agentsDirectoryQuery.isError &&
                      agentsDirectoryQuery.data === undefined ? (
                      <div
                        className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between"
                        role="alert"
                      >
                        <p className="text-muted-foreground text-sm">
                          {copy.frequentAgentsLoadFailed}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void agentsDirectoryQuery.refetch()}
                        >
                          {copy.retry}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <ul className="divide-border/70 divide-y">
                          <AgentQuickStartRow
                            href="/workspace/chats/new"
                            title={copy.defaultAgent}
                            description={copy.defaultAgentDescription}
                            usageCount={defaultAgentUsage}
                            copy={copy}
                          />
                          {frequentAgents.map(({ agent, usageCount }) => (
                            <AgentQuickStartRow
                              key={agent.name}
                              href={`/workspace/agents/${encodeURIComponent(agent.name)}/chats/new`}
                              title={agent.display_name ?? agent.name}
                              description={agent.description}
                              usageCount={usageCount}
                              copy={copy}
                            />
                          ))}
                        </ul>
                        {agentsDirectoryQuery.isError &&
                          agentsDirectoryQuery.data !== undefined && (
                            <RefreshFailureNotice
                              message={copy.frequentAgentsRefreshFailed}
                              isFetching={agentsDirectoryQuery.isFetching}
                              onRetry={() =>
                                void agentsDirectoryQuery.refetch()
                              }
                              copy={copy}
                            />
                          )}
                        {recentThreadsQuery.isError ? (
                          <p className="text-muted-foreground border-t px-4 py-3 text-xs leading-5 sm:px-5">
                            {copy.frequentAgentsHistoryUnavailable}
                          </p>
                        ) : frequentAgents.length === 0 ? (
                          <p className="text-muted-foreground border-t px-4 py-3 text-xs leading-5 sm:px-5">
                            {copy.frequentAgentsEmpty}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

function RefreshFailureNotice({
  message,
  isFetching,
  onRetry,
  copy,
}: {
  message: string;
  isFetching: boolean;
  onRetry: () => void;
  copy: ReturnType<typeof getProductCopy>;
}) {
  return (
    <div
      className="border-border/70 bg-muted/30 flex flex-col items-start gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
      role="alert"
    >
      <p className="text-muted-foreground text-xs leading-5">{message}</p>
      <Button variant="ghost" size="sm" disabled={isFetching} onClick={onRetry}>
        {isFetching ? copy.retrying : copy.retry}
      </Button>
    </div>
  );
}

function AgentQuickStartRow({
  href,
  title,
  description,
  usageCount,
  copy,
}: {
  href: string;
  title: string;
  description: string;
  usageCount: number;
  copy: ReturnType<typeof getProductCopy>;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group hover:bg-muted/55 flex items-center gap-4 px-4 py-4 transition-colors sm:px-5"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
          <Bot className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="text-muted-foreground mt-1 block truncate text-xs">
            {description}
          </span>
        </span>
        {usageCount > 0 && (
          <span className="text-muted-foreground hidden shrink-0 text-xs sm:block">
            {copy.agentRecentUseCount(usageCount)}
          </span>
        )}
        <ArrowRight className="text-muted-foreground/50 group-hover:text-primary size-4 shrink-0 transition duration-200 group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function RecentFileRow({
  file,
  locale,
  copy,
}: {
  file: ProductFileEntry;
  locale: Locale;
  copy: ReturnType<typeof getProductCopy>;
}) {
  const context =
    file.thread_name ??
    file.project_name ??
    (file.source === "thread_output"
      ? copy.recentFilesGenerated
      : file.source === "thread_workspace"
        ? copy.recentFilesWorkspace
        : file.source === "project_document"
          ? copy.recentFilesProject
          : copy.recentFilesConversation);

  return (
    <li>
      <a
        href={file.artifact_url}
        target="_blank"
        rel="noreferrer"
        aria-label={`${copy.filesOpen}: ${file.name}`}
        className="group hover:bg-muted/55 flex min-w-0 items-center gap-3 px-4 py-3.5 transition-colors sm:px-5"
      >
        <span className="bg-primary/8 text-primary group-hover:bg-primary/12 grid size-9 shrink-0 place-items-center rounded-xl transition-colors">
          <FileText className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {file.name}
          </span>
          <span className="text-muted-foreground mt-1 block truncate text-xs">
            {context}
          </span>
        </span>
        <span className="text-muted-foreground hidden shrink-0 text-xs sm:block">
          {file.modified_at
            ? formatTimeAgo(file.modified_at, locale)
            : copy.recentFilesNoDate}
        </span>
        <ArrowUpRight className="text-muted-foreground/60 group-hover:text-primary size-4 shrink-0 transition-colors" />
      </a>
    </li>
  );
}

function ActionCard({
  href,
  icon,
  title,
  description,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "blue" | "violet" | "green";
}) {
  const toneClass = {
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  }[tone];

  return (
    <Link
      href={href}
      className="group border-border/70 bg-card hover:border-primary/20 hover:shadow-primary/5 rounded-2xl border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:p-5"
    >
      <div className="flex items-center justify-between">
        <span
          className={`grid size-9 place-items-center rounded-xl ${toneClass}`}
        >
          {icon}
        </span>
        <ArrowRight className="text-muted-foreground/60 group-hover:text-primary size-4 transition duration-200 group-hover:translate-x-0.5" />
      </div>
      <div className="mt-4 text-sm font-semibold">{title}</div>
      <p className="text-muted-foreground mt-1.5 text-xs leading-5">
        {description}
      </p>
    </Link>
  );
}
