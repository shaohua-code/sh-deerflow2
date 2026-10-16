"use client";

import {
  ArrowLeftIcon,
  BotIcon,
  CheckCircleIcon,
  InfoIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SaveIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  PromptInput,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth/AuthProvider";
import { getMissingPermissions, PERMISSIONS } from "@/core/auth/permissions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import type { Agent } from "@/core/agents";
import {
  AgentNameCheckError,
  AgentsApiDisabledError,
  checkAgentName,
  getAgent,
} from "@/core/agents/api";
import { useI18n } from "@/core/i18n/hooks";
import {
  buildHumanInputResponseText,
  type HumanInputRequest,
  type HumanInputResponse,
} from "@/core/messages/human-input";
import { safeLocalStorage } from "@/core/settings/local";
import { hasToolResult, useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";
import { isIMEComposing } from "@/lib/ime";
import { cn } from "@/lib/utils";

type Step = "name" | "chat";
type SetupAgentStatus = "idle" | "requested" | "reading" | "lookup_failed";

const NAME_RE = /^[A-Za-z0-9-]+$/;
const SAVE_HINT_STORAGE_KEY = "deerflow.agent-create.save-hint-seen";
const AGENT_READ_RETRY_DELAYS_MS = [200, 500, 1_000, 2_000];

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getAgentWithRetry(agentName: string) {
  for (const delay of [0, ...AGENT_READ_RETRY_DELAYS_MS]) {
    if (delay > 0) {
      await wait(delay);
    }

    try {
      return await getAgent(agentName);
    } catch {
      // Retry until the write settles or the attempts are exhausted.
    }
  }

  return null;
}

export default function NewAgentPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  // 新建流程会查重、创建一次 Agent run，再由 setup_agent 持久化定义。
  const missingPermission =
    getMissingPermissions(user, [
      PERMISSIONS.AGENTS_READ,
      PERMISSIONS.AGENTS_WRITE,
      PERMISSIONS.RUNS_CREATE,
    ])[0] ?? null;
  // 保存本次渲染的权限结果，查名异步返回时用它阻止撤权后的旧回调继续启动 Agent。
  const missingPermissionRef = useRef(missingPermission);
  missingPermissionRef.current = missingPermission;
  const nameCheckAbortControllerRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<Step>("name");
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [showSaveHint, setShowSaveHint] = useState(false);
  const [setupAgentStatus, setSetupAgentStatus] =
    useState<SetupAgentStatus>("idle");
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  );

  // 初始化失败后的重试要使用新会话；旧请求可能已被 Gateway 接收，但页面无法确认结果。
  const [threadId, setThreadId] = useState(() => uuid());

  useEffect(() => {
    if (missingPermission) {
      nameCheckAbortControllerRef.current?.abort();
    }
    return () => {
      nameCheckAbortControllerRef.current?.abort();
    };
  }, [missingPermission]);

  const readSavedAgent = useCallback(async (name: string) => {
    // setup_agent 已成功后只重试读取；再次发送保存命令可能重复创建或覆盖智能体。
    setSetupAgentStatus("reading");
    const fetched = await getAgentWithRetry(name);
    if (fetched) {
      setAgent(fetched);
      return;
    }
    setSetupAgentStatus("lookup_failed");
  }, []);

  const { thread, sendMessage } = useThreadStream({
    threadId: undefined,
    context: {
      mode: "flash",
      is_bootstrap: true,
    },
    onFinish(state) {
      if (agent || setupAgentStatus !== "requested") {
        return;
      }
      if (!agentName || !hasToolResult(state.messages, "setup_agent")) {
        setSetupAgentStatus("idle");
        // 明确保存却没有对应工具结果时，恢复保存入口并告诉用户本次并未落盘。
        toast.error(t.agents.saveNotCompleted);
        return;
      }
      void readSavedAgent(agentName);
    },
  });
  const hasUnsavedCreation =
    step === "name"
      ? Boolean(nameInput.trim())
      : !agent && setupAgentStatus !== "lookup_failed";

  const requestNavigation = useCallback(
    (href: string) => {
      if (hasUnsavedCreation) {
        setPendingNavigation(href);
        return;
      }
      router.push(href);
    },
    [hasUnsavedCreation, router],
  );

  useEffect(() => {
    if (!hasUnsavedCreation) return;

    // 浏览器刷新/关闭只能使用原生 beforeunload；站内链接由下方产品弹窗接管。
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.download ||
        (anchor.target && anchor.target !== "_self")
      ) {
        return;
      }
      const url = new URL(anchor.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === window.location.pathname &&
          url.search === window.location.search)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(`${url.pathname}${url.search}${url.hash}`);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedCreation]);
  useEffect(() => {
    if (typeof window === "undefined" || step !== "chat") {
      return;
    }
    if (safeLocalStorage.getItem(SAVE_HINT_STORAGE_KEY) === "1") {
      return;
    }
    setShowSaveHint(true);
    safeLocalStorage.setItem(SAVE_HINT_STORAGE_KEY, "1");
  }, [step]);

  const handleConfirmName = useCallback(async () => {
    if (missingPermission) {
      setNameError(t.agents.permissionRequired(missingPermission));
      return;
    }
    if (isCheckingName) return;
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (!NAME_RE.test(trimmed)) {
      setNameError(t.agents.nameStepInvalidError);
      return;
    }

    setNameError("");
    const controller = new AbortController();
    nameCheckAbortControllerRef.current?.abort();
    nameCheckAbortControllerRef.current = controller;
    setIsCheckingName(true);
    let normalizedName = trimmed.toLowerCase();
    try {
      const result = await checkAgentName(trimmed, {
        signal: controller.signal,
      });
      // Gateway 是最终授权边界；这次复核避免已知撤权后的客户端继续发起新运行。
      if (controller.signal.aborted || missingPermissionRef.current) return;
      if (!result.available) {
        setNameError(t.agents.nameStepAlreadyExistsError);
        return;
      }
      // 后续运行上下文、保存后读取和路由必须使用 Gateway 返回的同一规范标识。
      if (!NAME_RE.test(result.name)) {
        setNameError(t.agents.nameStepCheckError);
        return;
      }
      normalizedName = result.name;
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof AgentsApiDisabledError) {
        setNameError(t.agents.nameStepApiDisabledError);
      } else if (
        err instanceof AgentNameCheckError &&
        err.reason === "backend_unreachable"
      ) {
        setNameError(t.agents.nameStepNetworkError);
      } else if (
        err instanceof AgentNameCheckError &&
        err.reason === "request_failed"
      ) {
        // Gateway detail 可能包含内部异常或未本地化文本，界面只展示安全的本地化提示。
        setNameError(t.agents.nameStepCheckError);
      } else {
        setNameError(t.agents.nameStepCheckError);
      }
      return;
    } finally {
      if (nameCheckAbortControllerRef.current === controller) {
        nameCheckAbortControllerRef.current = null;
      }
      setIsCheckingName(false);
    }

    if (controller.signal.aborted || missingPermissionRef.current) return;

    setNameInput(normalizedName);
    setAgentName(normalizedName);
    setStep("chat");
    try {
      await sendMessage(
        threadId,
        {
          text: t.agents.nameStepBootstrapMessage.replace(
            "{name}",
            normalizedName,
          ),
          files: [],
        },
        { agent_name: normalizedName },
      );
    } catch {
      // 不把 Gateway/模型的原始异常写进界面；保留名称并让用户重新校验后重试。
      // 新会话避免对可能已被服务端接收的旧初始化请求重复提交。
      setAgentName("");
      setThreadId(uuid());
      setStep("name");
      setNameError(t.agents.nameStepBootstrapError);
    }
  }, [
    isCheckingName,
    nameInput,
    sendMessage,
    t.agents.nameStepAlreadyExistsError,
    t.agents.nameStepApiDisabledError,
    t.agents.nameStepNetworkError,
    t.agents.nameStepBootstrapMessage,
    t.agents.nameStepBootstrapError,
    t.agents.nameStepCheckError,
    t.agents.nameStepInvalidError,
    threadId,
    missingPermission,
    t.agents.permissionRequired,
  ]);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isIMEComposing(e)) {
      e.preventDefault();
      void handleConfirmName();
    }
  };

  const handleChatSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thread.isLoading || missingPermission) return;
      await sendMessage(
        threadId,
        { text: trimmed, files: [] },
        { agent_name: agentName },
      );
    },
    [agentName, missingPermission, sendMessage, thread.isLoading, threadId],
  );

  const handleSubmitHumanInput = useCallback(
    async (request: HumanInputRequest, response: HumanInputResponse) => {
      if (!agentName || missingPermission) {
        return false;
      }

      let sent = false;
      await sendMessage(
        threadId,
        {
          text: buildHumanInputResponseText(request, response),
          files: [],
        },
        { agent_name: agentName },
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
    [agentName, missingPermission, sendMessage, threadId],
  );

  const handleSaveAgent = useCallback(async () => {
    if (
      !agentName ||
      missingPermission ||
      agent ||
      thread.isLoading ||
      setupAgentStatus !== "idle"
    ) {
      return;
    }

    setSetupAgentStatus("requested");
    setShowSaveHint(false);
    try {
      await sendMessage(
        threadId,
        { text: t.agents.saveCommandMessage, files: [] },
        { agent_name: agentName },
        { additionalKwargs: { hide_from_ui: true } },
      );
    } catch {
      setSetupAgentStatus("idle");
      // 保存 Agent 的调用错误可能包含 Gateway 内部 detail，只显示产品提示。
      toast.error(t.agents.saveFailed);
    }
  }, [
    agent,
    agentName,
    sendMessage,
    setupAgentStatus,
    missingPermission,
    t.agents.permissionRequired,
    t.agents.saveCommandMessage,
    t.agents.saveFailed,
    thread.isLoading,
    threadId,
  ]);

  const header = (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t.agents.backToGallery}
          title={t.agents.backToGallery}
          onClick={() => requestNavigation("/workspace/agents")}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold">{t.agents.createPageTitle}</h1>
      </div>

      {step === "chat" &&
      !missingPermission &&
      !agent &&
      (setupAgentStatus === "idle" || setupAgentStatus === "requested") ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t.agents.more}>
              <MoreHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => void handleSaveAgent()}
              disabled={[
                Boolean(agent),
                thread.isLoading,
                setupAgentStatus !== "idle",
              ].some(Boolean)}
            >
              <SaveIcon className="h-4 w-4" />
              {setupAgentStatus === "requested"
                ? t.agents.saving
                : t.agents.save}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </header>
  );

  if (step === "name") {
    return (
      <>
        <div className="flex size-full flex-col">
          {header}
          <main className="flex flex-1 flex-col items-center justify-center px-4">
            <div className="w-full max-w-sm space-y-8">
              <div className="space-y-3 text-center">
                <div className="bg-primary/10 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
                  <BotIcon className="text-primary h-7 w-7" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">
                    {t.agents.nameStepTitle}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {t.agents.nameStepHint}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {missingPermission ? (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>
                      {t.agents.permissionRequired(missingPermission)}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Input
                  autoFocus
                  aria-label={t.agents.nameStepTitle}
                  placeholder={t.agents.nameStepPlaceholder}
                  value={nameInput}
                  disabled={isCheckingName || Boolean(missingPermission)}
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    setNameError("");
                  }}
                  onKeyDown={handleNameKeyDown}
                  className={cn(nameError && "border-destructive")}
                />
                {nameError ? (
                  <p className="text-destructive text-sm">{nameError}</p>
                ) : null}
                <Button
                  className="w-full"
                  onClick={() => void handleConfirmName()}
                  disabled={
                    !nameInput.trim() ||
                    isCheckingName ||
                    Boolean(missingPermission)
                  }
                >
                  {t.agents.nameStepContinue}
                </Button>
              </div>
            </div>
          </main>
        </div>
        <DiscardAgentCreationDialog
          pendingNavigation={pendingNavigation}
          onKeepEditing={() => setPendingNavigation(null)}
          onDiscard={(href) => {
            setPendingNavigation(null);
            router.push(href);
          }}
        />
      </>
    );
  }

  return (
    <>
      <ThreadContext.Provider value={{ thread }}>
        <ArtifactsProvider>
          <div className="flex size-full flex-col">
            {header}

            <main className="flex min-h-0 flex-1 flex-col">
              {missingPermission ? (
                <div className="px-4 pt-4">
                  <div className="mx-auto w-full max-w-(--container-width-md)">
                    <Alert variant="destructive" role="alert">
                      <InfoIcon className="h-4 w-4" />
                      <AlertDescription>
                        {t.agents.permissionRequired(missingPermission)}
                      </AlertDescription>
                    </Alert>
                  </div>
                </div>
              ) : null}
              {showSaveHint ? (
                <div className="px-4 pt-4">
                  <div className="mx-auto w-full max-w-(--container-width-md)">
                    <Alert>
                      <InfoIcon className="h-4 w-4" />
                      <AlertDescription>{t.agents.saveHint}</AlertDescription>
                    </Alert>
                  </div>
                </div>
              ) : null}

              <div className="flex min-h-0 flex-1 justify-center">
                <MessageList
                  className={cn("size-full", showSaveHint ? "pt-4" : "pt-10")}
                  threadId={threadId}
                  thread={thread}
                  onSubmitHumanInput={
                    agentName ? handleSubmitHumanInput : undefined
                  }
                />
              </div>

              <div className="bg-background flex shrink-0 justify-center border-t px-4 py-4">
                <div className="w-full max-w-(--container-width-md)">
                  {agent ? (
                    <div className="flex flex-col items-center gap-4 rounded-2xl border py-8 text-center">
                      <CheckCircleIcon className="text-primary h-10 w-10" />
                      <p className="font-semibold">{t.agents.agentCreated}</p>
                      <div className="flex gap-2">
                        <Button
                          onClick={() =>
                            router.push(
                              `/workspace/agents/${agentName}/chats/new`,
                            )
                          }
                        >
                          {t.agents.startChatting}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => router.push("/workspace/agents")}
                        >
                          {t.agents.backToGallery}
                        </Button>
                      </div>
                    </div>
                  ) : setupAgentStatus === "reading" ? (
                    <div
                      className="flex flex-col items-center gap-3 rounded-2xl border py-8 text-center"
                      role="status"
                    >
                      <LoaderCircleIcon className="text-primary h-8 w-8 animate-spin" />
                      <p className="text-muted-foreground text-sm">
                        {t.agents.loadingCreatedAgent}
                      </p>
                    </div>
                  ) : setupAgentStatus === "lookup_failed" ? (
                    <div
                      className="flex flex-col items-center gap-4 rounded-2xl border px-4 py-8 text-center"
                      role="alert"
                    >
                      <InfoIcon className="text-primary h-8 w-8" />
                      <p className="max-w-md text-sm">
                        {t.agents.agentCreatedPendingRefresh}
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button onClick={() => void readSavedAgent(agentName)}>
                          <RefreshCwIcon className="mr-1.5 h-4 w-4" />
                          {t.agents.retry}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => router.push("/workspace/agents")}
                        >
                          {t.agents.backToGallery}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // 受控草稿会等发送 Promise 成功才清空；失败时保留文字供用户重试。
                    <PromptInputProvider>
                      <PromptInput
                        disabled={
                          thread.isLoading || Boolean(missingPermission)
                        }
                        // 创建向导当前只提交文本；不要接收随后会被忽略的附件。
                        fileUploadsEnabled={false}
                        onSubmit={({ text }) => handleChatSubmit(text)}
                      >
                        <PromptInputTextarea
                          autoFocus
                          placeholder={t.agents.createPageSubtitle}
                          disabled={
                            thread.isLoading || Boolean(missingPermission)
                          }
                        />
                        <PromptInputFooter className="justify-end">
                          <PromptInputSubmit
                            disabled={
                              thread.isLoading || Boolean(missingPermission)
                            }
                          />
                        </PromptInputFooter>
                      </PromptInput>
                    </PromptInputProvider>
                  )}
                </div>
              </div>
            </main>
          </div>
        </ArtifactsProvider>
      </ThreadContext.Provider>
      <DiscardAgentCreationDialog
        pendingNavigation={pendingNavigation}
        onKeepEditing={() => setPendingNavigation(null)}
        onDiscard={(href) => {
          setPendingNavigation(null);
          router.push(href);
        }}
      />
    </>
  );
}

function DiscardAgentCreationDialog({
  pendingNavigation,
  onKeepEditing,
  onDiscard,
}: {
  pendingNavigation: string | null;
  onKeepEditing: () => void;
  onDiscard: (href: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={pendingNavigation !== null}
      onOpenChange={(open) => {
        if (!open) onKeepEditing();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.agents.leaveCreationTitle}</DialogTitle>
          <DialogDescription>
            {t.agents.leaveCreationDescription}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onKeepEditing}>
            {t.agents.keepDesigning}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (pendingNavigation) onDiscard(pendingNavigation);
            }}
          >
            {t.agents.leaveCreation}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
