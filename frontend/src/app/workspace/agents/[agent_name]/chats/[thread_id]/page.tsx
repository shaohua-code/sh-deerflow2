"use client";

import {
  AlertCircleIcon,
  BotIcon,
  LoaderCircleIcon,
  PlusSquare,
  RefreshCwIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { AgentWelcome } from "@/components/workspace/agent-welcome";
import { ArtifactTrigger } from "@/components/workspace/artifacts";
import { BrowserTrigger } from "@/components/workspace/browser-view";
import { ChatBox, useThreadChat } from "@/components/workspace/chats";
import { ContextUsageBadge } from "@/components/workspace/context-usage-badge";
import { ExportTrigger } from "@/components/workspace/export-trigger";
import { GoalStatus } from "@/components/workspace/goal-status";
import {
  InputBox,
  type InputBoxSubmitOptions,
} from "@/components/workspace/input-box";
import {
  MessageList,
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
} from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import {
  SidecarProvider,
  SidecarTrigger,
} from "@/components/workspace/sidecar";
import { ThreadArchiveStatus } from "@/components/workspace/thread-archive-status";
import { ThreadBackgroundTasks } from "@/components/workspace/thread-background-tasks";
import { ThreadSubagentBatches } from "@/components/workspace/thread-subagent-batches";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { TokenUsageIndicator } from "@/components/workspace/token-usage-indicator";
import { Tooltip } from "@/components/workspace/tooltip";
import { useActiveGoal } from "@/components/workspace/use-active-goal";
import { useAgent } from "@/core/agents";
import { GatewayApiError } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  getChatSubmissionBlock,
  hasPermission,
  PERMISSIONS,
} from "@/core/auth/permissions";
import { useBrowserControlEnabled } from "@/core/features";
import { useI18n } from "@/core/i18n/hooks";
import {
  buildHumanInputResponseText,
  hasOpenHumanInputRequest,
  type HumanInputRequest,
  type HumanInputResponse,
} from "@/core/messages/human-input";
import { isHiddenFromUIMessage } from "@/core/messages/utils";
import { useModels } from "@/core/models/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings, useThreadSettings } from "@/core/settings";
import { resolveThreadContext } from "@/core/settings/store";
import {
  useThreadMetadata,
  useThreadStream,
  useThreadTokenUsage,
} from "@/core/threads/hooks";
import {
  selectContextUsage,
  threadTokenUsageToTokenUsage,
} from "@/core/threads/token-usage";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";
import { WorkspaceSidebarTrigger } from "@/product/workspace-sidebar-trigger";

export default function AgentChatPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canReadAgent = hasPermission(user, PERMISSIONS.AGENTS_READ);
  // 智能体会话的发送、续答与重新生成都创建 Gateway run。
  const submissionBlock = getChatSubmissionBlock(user);
  const canSubmit = submissionBlock === null;
  const canStopStreaming = hasPermission(user, PERMISSIONS.RUNS_CANCEL);
  // 文本运行允许 `runs:create`，附件上传另由 Gateway 的 `threads:write` 保护。
  const canUploadFiles = hasPermission(user, PERMISSIONS.THREADS_WRITE);
  const router = useRouter();

  const { agent_name } = useParams<{
    agent_name: string;
  }>();

  const {
    agent,
    isLoading: agentLoading,
    isFetching: agentFetching,
    error: agentError,
    refetch: refetchAgent,
  } = useAgent(agent_name, canReadAgent);

  const { threadId, setThreadId, isNewThread, setIsNewThread, isMock } =
    useThreadChat();
  // `isNewThread` gates history/token-usage fetches until the backend creates
  // the thread. `isWelcomeMode` controls only the centered welcome layout, so
  // it can flip immediately on submit without triggering eager history loads.
  const [isWelcomeMode, setIsWelcomeMode] = useState(isNewThread);
  const [settings, setSettings] = useThreadSettings(threadId);
  const [localSettings, setLocalSettings] = useLocalSettings();
  const { enabled: browserControlEnabled } = useBrowserControlEnabled();
  const { tokenUsageEnabled } = useModels();
  const threadTokenUsage = useThreadTokenUsage(
    isNewThread || isMock ? undefined : threadId,
    { enabled: !isMock },
  );
  const threadMetadata = useThreadMetadata(threadId, {
    enabled: !isNewThread && !isMock,
    isMock,
  });
  const backendTokenUsage = threadTokenUsageToTokenUsage(threadTokenUsage.data);
  const contextUsage = selectContextUsage(threadTokenUsage.data);

  const { showNotification } = useNotification();

  useEffect(() => {
    setIsWelcomeMode(isNewThread);
  }, [isNewThread]);

  const {
    thread,
    pendingUsageMessages,
    sendMessage,
    regenerateMessage,
    editAndRegenerateMessage,
    isUploading,
    isHistoryLoading,
    hasMoreHistory,
    loadMoreHistory,
  } = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    displayThreadId: threadId,
    context: { ...settings.context, agent_name: agent_name },
    isMock,
    onSend: () => {
      setIsWelcomeMode(false);
    },
    onStart: (createdThreadId) => {
      // ! Important: Never use next.js router for navigation in this case, otherwise it will cause the thread to re-mount and lose all states. Use native history API instead.
      history.replaceState(
        null,
        "",
        `/workspace/agents/${agent_name}/chats/${createdThreadId}`,
      );
      setThreadId(createdThreadId);
      setIsNewThread(false);
    },
    onFinish: (state) => {
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

  const hasThreadMessages = thread.messages.length > 0;

  useEffect(() => {
    if (
      !isNewThread &&
      !isMock &&
      threadMetadata.data === null &&
      !threadMetadata.isLoading &&
      !threadMetadata.isFetching &&
      !isHistoryLoading &&
      !hasMoreHistory &&
      !hasThreadMessages
    ) {
      router.replace(`/workspace/agents/${agent_name}/chats/new`);
    }
  }, [
    agent_name,
    hasMoreHistory,
    hasThreadMessages,
    isHistoryLoading,
    isMock,
    isNewThread,
    router,
    threadMetadata.data,
    threadMetadata.isFetching,
    threadMetadata.isLoading,
  ]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage, options?: InputBoxSubmitOptions) => {
      if (!canSubmit) return;
      const sendPromise = sendMessage(
        threadId,
        message,
        { agent_name },
        options,
      );
      if (message.files.length > 0) {
        return sendPromise;
      }
      // Text-only submits clear the composer optimistically. The thread hook
      // owns the localized error toast; consume the rejected promise here so
      // a failed request does not become an unhandled browser rejection.
      void sendPromise.catch(() => undefined);
    },
    [canSubmit, sendMessage, threadId, agent_name],
  );

  const handleSubmitHumanInput = useCallback(
    async (request: HumanInputRequest, response: HumanInputResponse) => {
      if (!canSubmit) return false;
      let sent = false;
      await sendMessage(
        threadId,
        {
          text: buildHumanInputResponseText(request, response),
          files: [],
        },
        { agent_name },
        {
          additionalKwargs: {
            hide_from_ui: true,
            human_input_response: response,
          },
          onSent: () => {
            sent = true;
          },
        },
      );
      return sent;
    },
    [agent_name, canSubmit, sendMessage, threadId],
  );

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);
  const handleRegenerate = useCallback(
    (messageId: string, supersededMessageIds: string[]) => {
      if (!canSubmit) return;
      return regenerateMessage(threadId, messageId, supersededMessageIds);
    },
    [canSubmit, regenerateMessage, threadId],
  );
  const handleEditAndRegenerate = useCallback(
    (messageId: string, replacementText: string) => {
      if (!canSubmit) return;
      return editAndRegenerateMessage(threadId, messageId, replacementText);
    },
    [canSubmit, editAndRegenerateMessage, threadId],
  );

  const tokenUsageInlineMode = tokenUsageEnabled
    ? localSettings.tokenUsage.inlineMode
    : "off";
  const hasTodos = (thread.values.todos?.length ?? 0) > 0;
  const agentBrowserEnabled =
    agent !== null &&
    (agent.tool_groups == null || agent.tool_groups.includes("browser"));
  const browserEnabled =
    !isNewThread && !isMock && browserControlEnabled && agentBrowserEnabled;
  const { activeGoal, hasGoal, setLocalGoal } = useActiveGoal(
    threadId,
    thread.values.goal,
  );
  const hasOpenHumanInputCard = useMemo(
    () =>
      hasOpenHumanInputRequest(
        thread.messages,
        (message) => !isHiddenFromUIMessage(message),
      ),
    [thread.messages],
  );

  // 详情读取成功前不展示可发送的输入框，避免不存在或无权限的 Agent
  // 看起来可以对话，直到发送后才暴露一个难以理解的运行失败。
  if (!canReadAgent || agent === null || agentError) {
    return (
      <AgentChatLoadState
        agentName={agent_name}
        error={agentError}
        isLoading={agentLoading}
        isFetching={agentFetching}
        permissionDenied={!canReadAgent}
        onRetry={() => void refetchAgent()}
        onBack={() => router.push("/workspace/agents")}
      />
    );
  }

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <SidecarProvider
        parentThreadId={threadId}
        context={{ ...settings.context, agent_name }}
        isMock={isMock}
      >
        <ChatBox threadId={threadId} browserEnabled={browserEnabled}>
          <div className="relative flex size-full min-h-0 justify-between">
            <header
              className={cn(
                "absolute top-0 right-0 left-0 flex h-12 shrink-0 items-center gap-2 px-2 sm:px-4",
                isWelcomeMode
                  ? "bg-background/0 z-40 backdrop-blur-none"
                  : "bg-background/80 z-30 shadow-xs backdrop-blur",
              )}
            >
              <WorkspaceSidebarTrigger className="md:hidden" />
              {/* Agent badge */}
              <div className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1">
                <BotIcon className="text-primary h-3.5 w-3.5" />
                <span className="hidden max-w-24 truncate text-xs font-medium sm:inline sm:max-w-none">
                  {agent?.display_name?.length
                    ? agent.display_name
                    : (agent?.name ?? agent_name)}
                </span>
              </div>

              <div className="flex min-w-0 flex-1 items-center text-sm font-medium">
                <ThreadTitle
                  threadId={threadId}
                  thread={thread}
                  canonicalTitle={threadMetadata.data?.values?.title}
                />
                {!isNewThread &&
                  !isMock &&
                  env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" && (
                    <ThreadArchiveStatus
                      threadId={threadId}
                      metadata={threadMetadata.data?.metadata}
                    />
                  )}
              </div>
              <div className="flex shrink-0 items-center sm:mr-4">
                {!isNewThread &&
                  !isMock &&
                  env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" && (
                    <ThreadBackgroundTasks threadId={threadId} />
                  )}
                {!isNewThread &&
                  !isMock &&
                  env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" && (
                    <ThreadSubagentBatches threadId={threadId} />
                  )}
                <Tooltip content={t.agents.newChat}>
                  <Button
                    className="px-2 sm:px-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      router.push(`/workspace/agents/${agent_name}/chats/new`);
                    }}
                  >
                    <PlusSquare />
                    <span className="hidden sm:inline">{t.agents.newChat}</span>
                  </Button>
                </Tooltip>
                {tokenUsageEnabled ? (
                  <TokenUsageIndicator
                    threadId={isNewThread ? undefined : threadId}
                    backendUsage={backendTokenUsage}
                    contextUsage={contextUsage}
                    enabled={tokenUsageEnabled}
                    messages={thread.messages}
                    pendingMessages={pendingUsageMessages}
                    preferences={localSettings.tokenUsage}
                    onPreferencesChange={(preferences) =>
                      setLocalSettings("tokenUsage", preferences)
                    }
                  />
                ) : (
                  <ContextUsageBadge contextUsage={contextUsage} />
                )}
                <SidecarTrigger />
                {browserEnabled && <BrowserTrigger />}
                <ExportTrigger threadId={threadId} />
                <ArtifactTrigger />
              </div>
            </header>

            <main className="flex min-h-0 max-w-full grow flex-col">
              <div className="flex min-h-0 flex-1 justify-center">
                <MessageList
                  archiveDownloadsEnabled={
                    isNewThread || isMock || threadMetadata.data != null
                  }
                  className={cn("size-full", !isWelcomeMode && "pt-10")}
                  testId="main-message-list"
                  threadId={threadId}
                  thread={thread}
                  enableConversationOutline
                  paddingBottom={MESSAGE_LIST_DEFAULT_PADDING_BOTTOM}
                  hasMoreHistory={hasMoreHistory}
                  loadMoreHistory={loadMoreHistory}
                  isHistoryLoading={isHistoryLoading}
                  tokenUsageInlineMode={tokenUsageInlineMode}
                  canRegenerate={
                    canSubmit &&
                    !isNewThread &&
                    !isMock &&
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" &&
                    !isUploading &&
                    !thread.isLoading
                  }
                  onRegenerateMessage={handleRegenerate}
                  canEdit={
                    canSubmit &&
                    !isNewThread &&
                    !isMock &&
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" &&
                    !isUploading &&
                    !thread.isLoading &&
                    !hasGoal &&
                    !hasOpenHumanInputCard
                  }
                  onEditAndRegenerateMessage={handleEditAndRegenerate}
                  onSubmitHumanInput={
                    !canSubmit ||
                    isMock ||
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
                      ? undefined
                      : handleSubmitHumanInput
                  }
                />
              </div>

              <div
                className={cn(
                  "right-0 bottom-0 left-0 z-30 flex justify-center px-3 sm:px-4",
                  isWelcomeMode ? "absolute" : "relative shrink-0 pb-4",
                )}
              >
                <div
                  className={cn(
                    "relative w-full",
                    isWelcomeMode &&
                      "-translate-y-[calc(50vh-48px)] sm:-translate-y-[calc(50vh-96px)]",
                    isWelcomeMode
                      ? "max-w-(--container-width-sm)"
                      : "max-w-(--container-width-md)",
                  )}
                >
                  {(hasGoal || hasTodos) && (
                    <div
                      className={cn(
                        "right-0 left-0 z-0",
                        isWelcomeMode ? "absolute -top-4" : "relative",
                      )}
                    >
                      <div
                        className={cn(
                          "right-0 bottom-0 left-0 flex flex-col",
                          isWelcomeMode ? "absolute" : "relative",
                        )}
                      >
                        {activeGoal && <GoalStatus goal={activeGoal} />}
                        {hasTodos && (
                          <TodoList
                            className="bg-background/5"
                            todos={thread.values.todos ?? []}
                            hidden={false}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {submissionBlock && (
                    <p
                      className="text-muted-foreground px-3 pb-2 text-center text-xs"
                      role="status"
                    >
                      {t.inputBox.runPermissionRequired}
                    </p>
                  )}
                  {!canUploadFiles && (
                    <p
                      className="text-muted-foreground px-3 pb-2 text-center text-xs"
                      role="status"
                    >
                      {t.inputBox.uploadPermissionRequired}
                    </p>
                  )}
                  <InputBox
                    className={cn(
                      "bg-background/5 w-full",
                      isWelcomeMode && "-translate-y-2 sm:-translate-y-4",
                    )}
                    isWelcomeMode={isWelcomeMode}
                    threadId={threadId}
                    draftThreadId={isNewThread ? "new" : threadId}
                    draftAgentName={agent_name}
                    agentSkillNames={agent?.skills}
                    agentSkillsLoading={agentLoading}
                    defaultModelName={agent?.model}
                    autoFocus={isWelcomeMode}
                    status={
                      thread.error
                        ? "error"
                        : thread.isLoading
                          ? "streaming"
                          : "ready"
                    }
                    context={settings.context}
                    extraHeader={
                      isWelcomeMode &&
                      !hasGoal &&
                      !hasTodos && (
                        <AgentWelcome agent={agent} agentName={agent_name} />
                      )
                    }
                    disabled={
                      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ||
                      isUploading ||
                      (!isNewThread && isHistoryLoading)
                    }
                    onContextChange={(context, options) => {
                      if (options?.automatic)
                        resolveThreadContext(threadId, context);
                      else setSettings("context", context);
                    }}
                    onGoalChange={setLocalGoal}
                    onSubmit={handleSubmit}
                    onStop={handleStop}
                    canUploadFiles={canUploadFiles}
                    canSubmit={canSubmit}
                    canStopStreaming={canStopStreaming}
                  />
                  {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                    <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                      {t.common.notAvailableInDemoMode}
                    </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        </ChatBox>
      </SidecarProvider>
    </ThreadContext.Provider>
  );
}

function AgentChatLoadState({
  agentName,
  error,
  isLoading,
  isFetching,
  permissionDenied,
  onRetry,
  onBack,
}: {
  agentName: string;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  permissionDenied: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const notFound = error instanceof GatewayApiError && error.status === 404;

  return (
    <div className="flex size-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
        <WorkspaceSidebarTrigger className="md:hidden" />
        <div className="flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1">
          <BotIcon className="text-primary size-3.5 shrink-0" />
          <span className="truncate text-xs font-medium">{agentName}</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        {permissionDenied ? (
          <div
            className="flex w-full max-w-md flex-col items-center gap-4 text-center"
            role="alert"
          >
            <div className="bg-destructive/10 flex size-14 items-center justify-center rounded-full">
              <AlertCircleIcon className="text-destructive size-7" />
            </div>
            <p className="text-muted-foreground text-sm">
              {t.agents.permissionRequired(PERMISSIONS.AGENTS_READ)}
            </p>
            <Button variant="outline" onClick={onBack}>
              {t.agents.backToGallery}
            </Button>
          </div>
        ) : isLoading || error === null ? (
          <div
            className="text-muted-foreground flex flex-col items-center gap-3 text-center"
            role="status"
            aria-live="polite"
          >
            <LoaderCircleIcon className="text-primary size-8 animate-spin" />
            <p className="text-sm">{t.agents.detailLoading}</p>
          </div>
        ) : (
          <div
            className="flex w-full max-w-md flex-col items-center gap-4 text-center"
            role="alert"
          >
            <div className="bg-destructive/10 flex size-14 items-center justify-center rounded-full">
              <AlertCircleIcon className="text-destructive size-7" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-semibold">
                {notFound ? t.agents.detailNotFound : t.agents.detailLoadFailed}
              </h1>
              <p className="text-muted-foreground text-sm">
                {notFound
                  ? t.agents.detailNotFoundHint
                  : t.agents.detailLoadFailedHint}
              </p>
            </div>
            <div className="flex w-full flex-col-reverse justify-center gap-2 sm:w-auto sm:flex-row">
              <Button variant="outline" onClick={onBack}>
                {t.agents.backToGallery}
              </Button>
              <Button disabled={isFetching} onClick={onRetry}>
                <RefreshCwIcon
                  className={`size-4 ${isFetching ? "animate-spin" : ""}`}
                />
                {isFetching ? t.agents.retrying : t.agents.retry}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
