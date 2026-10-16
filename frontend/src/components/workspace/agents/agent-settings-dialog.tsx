"use client";

import { ChevronRightIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { useUpdateAgent } from "@/core/agents";
import { useAuth } from "@/core/auth/AuthProvider";
import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";
import type { Agent, ReasoningEffort } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { useSubagents } from "@/core/subagents";

import {
  allowedSubagentsToSelection,
  DEFAULT_MODEL_VALUE,
  INHERIT_VALUE,
  MAX_AGENT_OUTPUT_TOKENS,
  parseAgentModelSettingsDraft,
  resolveEffectiveModel,
  selectionToAllowedSubagents,
  selectionToThinkingEnabled,
  type SubagentAccessSelection,
  type ThinkingSelection,
  thinkingEnabledToSelection,
} from "./agent-settings-dialog-helpers";

const REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

interface AgentSettingsDialogProps {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit?: boolean;
}

type AgentSettingsDraft = {
  displayName: string;
  model: string;
  temperature: string;
  maxTokens: string;
  thinking: ThinkingSelection;
  reasoningEffort: string;
  subagentAccess: SubagentAccessSelection;
  selectedSubagents: string[];
};

function createAgentSettingsDraft(agent: Agent): AgentSettingsDraft {
  return {
    displayName: agent.display_name ?? "",
    model: agent.model ?? DEFAULT_MODEL_VALUE,
    temperature:
      agent.model_settings?.temperature != null
        ? String(agent.model_settings.temperature)
        : "",
    maxTokens:
      agent.model_settings?.max_tokens != null
        ? String(agent.model_settings.max_tokens)
        : "",
    thinking: thinkingEnabledToSelection(agent.thinking_enabled),
    reasoningEffort: agent.reasoning_effort ?? INHERIT_VALUE,
    subagentAccess: allowedSubagentsToSelection(agent.allowed_subagents),
    selectedSubagents: agent.allowed_subagents ?? [],
  };
}

function agentSettingsDraftsMatch(
  left: AgentSettingsDraft,
  right: AgentSettingsDraft,
) {
  return (
    left.displayName === right.displayName &&
    left.model === right.model &&
    left.temperature === right.temperature &&
    left.maxTokens === right.maxTokens &&
    left.thinking === right.thinking &&
    left.reasoningEffort === right.reasoningEffort &&
    left.subagentAccess === right.subagentAccess &&
    left.selectedSubagents.length === right.selectedSubagents.length &&
    left.selectedSubagents.every((name) =>
      right.selectedSubagents.includes(name),
    )
  );
}

/**
 * 编辑自定义智能体的展示名和模型行为；保存请求写入稳定标识 agent.name，
 * 模型、温度、输出上限与推理设置从下一次运行开始生效。
 */
export function AgentSettingsDialog({
  agent,
  open,
  onOpenChange,
  canEdit = true,
}: AgentSettingsDialogProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canReadSubagents = hasPermission(user, PERMISSIONS.SUBAGENTS_READ);
  const {
    models,
    error: modelsError,
    isFetching: modelsFetching,
    refetch: refetchModels,
  } = useModels();
  const {
    subagents,
    error: subagentsError,
    isFetching: subagentsFetching,
    refetch: refetchSubagents,
  } = useSubagents(canReadSubagents);
  const subagentDescriptionId = useId();
  const updateAgent = useUpdateAgent();
  // AgentCard 只在弹窗打开时挂载本组件，初始快照不会被后台刷新覆盖。
  const [initialDraft] = useState<AgentSettingsDraft>(() =>
    createAgentSettingsDraft(agent),
  );
  const [displayName, setDisplayName] = useState(initialDraft.displayName);
  const [model, setModel] = useState(initialDraft.model);
  const [temperature, setTemperature] = useState(initialDraft.temperature);
  const [maxTokens, setMaxTokens] = useState(initialDraft.maxTokens);
  const [thinking, setThinking] = useState(initialDraft.thinking);
  const [reasoningEffort, setReasoningEffort] = useState(
    initialDraft.reasoningEffort,
  );
  const [subagentAccess, setSubagentAccess] = useState<SubagentAccessSelection>(
    initialDraft.subagentAccess,
  );
  const [selectedSubagents, setSelectedSubagents] = useState<string[]>(
    initialDraft.selectedSubagents,
  );
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const currentDraft: AgentSettingsDraft = {
    displayName,
    model,
    temperature,
    maxTokens,
    thinking,
    reasoningEffort,
    subagentAccess,
    selectedSubagents,
  };
  const hasUnsavedChanges = !agentSettingsDraftsMatch(
    currentDraft,
    initialDraft,
  );

  // 只有模型目录明确声明能力时才显示思考/推理控件；目录不可用时保存其他字段
  // 必须保留原值，不能把“未知”误当成“不支持”并清空配置。
  const selectedModel = useMemo(
    () => resolveEffectiveModel(models, model),
    [models, model],
  );
  const hasSelectedModelMetadata = selectedModel !== undefined;
  const supportsThinking = selectedModel?.supports_thinking ?? false;
  const supportsReasoningEffort =
    selectedModel?.supports_reasoning_effort ?? false;
  const selectableSubagents = useMemo(
    () =>
      Array.from(
        new Map(
          subagents
            .filter((item) => item.enabled && !item.conflict)
            .map((item) => [item.name, item]),
        ).values(),
      ),
    [subagents],
  );
  const missingSubagents = useMemo(() => {
    // 首次读取失败时没有可信目录，不能把现有绑定误报为已删除。
    if (!canReadSubagents || (subagentsError && subagents.length === 0)) {
      return [];
    }
    const selectableNames = new Set(
      selectableSubagents.map((item) => item.name),
    );
    return selectedSubagents.filter((name) => !selectableNames.has(name));
  }, [
    selectableSubagents,
    selectedSubagents,
    subagents.length,
    subagentsError,
    canReadSubagents,
  ]);

  function requestClose() {
    if (updateAgent.isPending) return;
    if (hasUnsavedChanges) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(false);
  }

  async function handleSave() {
    if (!canEdit) {
      toast.error(t.agents.permissionRequired(PERMISSIONS.AGENTS_WRITE));
      return;
    }
    if ([...displayName.trim()].length > 100) {
      toast.error(t.agents.settingsDisplayNameTooLong);
      return;
    }
    const parsedSettings = parseAgentModelSettingsDraft({
      temperature,
      maxTokens,
    });
    if (!parsedSettings.ok) {
      toast.error(
        parsedSettings.error === "temperature"
          ? t.agents.settingsInvalidTemperature
          : t.agents.settingsInvalidMaxTokens,
      );
      return;
    }

    try {
      await updateAgent.mutateAsync({
        name: agent.name,
        request: {
          display_name: displayName.trim() || null,
          model: model === DEFAULT_MODEL_VALUE ? null : model,
          model_settings: parsedSettings.modelSettings,
          thinking_enabled: hasSelectedModelMetadata
            ? supportsThinking
              ? selectionToThinkingEnabled(thinking)
              : null
            : (agent.thinking_enabled ?? null),
          reasoning_effort: hasSelectedModelMetadata
            ? supportsReasoningEffort && reasoningEffort !== INHERIT_VALUE
              ? (reasoningEffort as ReasoningEffort)
              : null
            : (agent.reasoning_effort ?? null),
          // 没有独立的目录读取权限时保留原绑定，不把不可见目录写成空白名单。
          ...(canReadSubagents
            ? {
                allowed_subagents: selectionToAllowedSubagents(
                  subagentAccess,
                  selectedSubagents,
                ),
              }
            : {}),
        },
      });
      toast.success(t.agents.settingsSaved);
      onOpenChange(false);
    } catch {
      // 配置写入异常保留在诊断渠道，用户只看到本地化提示。
      toast.error(t.agents.settingsSaveFailed);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) requestClose();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
          showCloseButton={!updateAgent.isPending}
          onEscapeKeyDown={(event) => {
            if (updateAgent.isPending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (updateAgent.isPending) event.preventDefault();
          }}
        >
          <DialogHeader className="pr-6">
            <DialogTitle>{t.agents.settingsTitle}</DialogTitle>
            <DialogDescription>
              {t.agents.settingsDescription}
            </DialogDescription>
          </DialogHeader>

          {!canEdit ? (
            <p className="text-destructive text-sm" role="alert">
              {t.agents.permissionRequired(PERMISSIONS.AGENTS_WRITE)}
            </p>
          ) : null}

          <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain px-1 py-1">
            <div className="space-y-1.5">
              <label
                htmlFor="agent-display-name"
                className="text-sm font-medium"
              >
                {t.agents.settingsDisplayName}
              </label>
              <Input
                id="agent-display-name"
                value={displayName}
                disabled={updateAgent.isPending || !canEdit}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={agent.name}
                aria-describedby="agent-display-name-hint"
              />
              <p
                id="agent-display-name-hint"
                className="text-muted-foreground text-xs"
              >
                {t.agents.settingsDisplayNameHint} ({agent.name}){" · "}
                {[...displayName.trim()].length}/100
              </p>
            </div>
            {/* Default model */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                {t.agents.settingsModel}
              </span>
              <Select
                value={model}
                disabled={updateAgent.isPending || !canEdit}
                onValueChange={setModel}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={t.agents.settingsModel}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MODEL_VALUE}>
                    {t.agents.settingsModelDefault}
                  </SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.name} value={m.name}>
                      {m.display_name || m.name}
                    </SelectItem>
                  ))}
                  {agent.model &&
                    !models.some((item) => item.name === agent.model) && (
                      <SelectItem value={agent.model}>
                        {t.agents.settingsCurrentModel(agent.model)}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
              {modelsError ? (
                <div
                  role="alert"
                  className="border-destructive/30 flex flex-col items-start gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>{t.agents.settingsModelLoadFailed}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      modelsFetching || updateAgent.isPending || !canEdit
                    }
                    onClick={() => void refetchModels()}
                  >
                    {modelsFetching
                      ? t.agents.settingsModelRetrying
                      : t.agents.settingsModelRetry}
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Temperature */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                {t.agents.settingsTemperature}
              </span>
              <Input
                type="number"
                aria-label={t.agents.settingsTemperature}
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                disabled={updateAgent.isPending || !canEdit}
                placeholder={t.agents.settingsInherit}
                onChange={(e) => setTemperature(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t.agents.settingsTemperatureHint}
              </p>
            </div>

            {/* Max output tokens */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                {t.agents.settingsMaxTokens}
              </span>
              <Input
                type="number"
                aria-label={t.agents.settingsMaxTokens}
                min={1}
                max={MAX_AGENT_OUTPUT_TOKENS}
                step={1}
                value={maxTokens}
                disabled={updateAgent.isPending || !canEdit}
                placeholder={t.agents.settingsMaxTokensPlaceholder}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>

            {/* Thinking mode (only when the selected model supports it) */}
            {supportsThinking && (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">
                  {t.agents.settingsThinking}
                </span>
                <Select
                  value={thinking}
                  disabled={updateAgent.isPending || !canEdit}
                  onValueChange={(value) =>
                    setThinking(value as typeof thinking)
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t.agents.settingsThinking}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_VALUE}>
                      {t.agents.settingsInherit}
                    </SelectItem>
                    <SelectItem value="on">
                      {t.agents.settingsThinkingOn}
                    </SelectItem>
                    <SelectItem value="off">
                      {t.agents.settingsThinkingOff}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Reasoning effort (only when supported) */}
            {supportsReasoningEffort && (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">
                  {t.agents.settingsReasoningEffort}
                </span>
                <Select
                  value={reasoningEffort}
                  disabled={updateAgent.isPending || !canEdit}
                  onValueChange={setReasoningEffort}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t.agents.settingsReasoningEffort}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_VALUE}>
                      {t.agents.settingsInherit}
                    </SelectItem>
                    {REASONING_EFFORTS.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {effort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2 border-t pt-4">
              <div>
                <p className="text-sm font-medium">
                  {t.settings.subagents.bindingTitle}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t.settings.subagents.bindingDescription}
                </p>
                {!canReadSubagents ? (
                  <p
                    role="status"
                    className="text-muted-foreground mt-2 text-xs"
                  >
                    {t.agents.permissionRequired(PERMISSIONS.SUBAGENTS_READ)}
                  </p>
                ) : null}
              </div>
              <Select
                value={subagentAccess}
                disabled={
                  updateAgent.isPending || !canEdit || !canReadSubagents
                }
                onValueChange={(value) =>
                  setSubagentAccess(value as SubagentAccessSelection)
                }
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={t.settings.subagents.bindingTitle}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t.settings.subagents.allAllowed}
                  </SelectItem>
                  <SelectItem value="none">
                    {t.settings.subagents.noneAllowed}
                  </SelectItem>
                  <SelectItem value="selected">
                    {t.settings.subagents.selectedAllowed}
                  </SelectItem>
                </SelectContent>
              </Select>
              {subagentsError ? (
                <div
                  role="alert"
                  className="border-destructive/30 flex flex-col items-start gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    {subagents.length === 0
                      ? t.settings.subagents.loadFailed
                      : t.settings.subagents.refreshFailed}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      subagentsFetching || updateAgent.isPending || !canEdit
                    }
                    onClick={() => void refetchSubagents()}
                  >
                    {subagentsFetching
                      ? t.settings.subagents.retrying
                      : t.settings.subagents.retry}
                  </Button>
                </div>
              ) : null}
              {canReadSubagents && subagentAccess === "selected" && (
                <div className="space-y-3 rounded-md border p-3">
                  {!subagentsError &&
                  selectableSubagents.length === 0 &&
                  missingSubagents.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {t.settings.subagents.empty}
                    </p>
                  ) : null}
                  {selectableSubagents.map((item) => (
                    <div key={item.name} className="min-w-0 space-y-1">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0"
                          checked={selectedSubagents.includes(item.name)}
                          disabled={updateAgent.isPending || !canEdit}
                          onChange={(event) =>
                            setSelectedSubagents((current) =>
                              event.target.checked
                                ? [...current, item.name]
                                : current.filter((name) => name !== item.name),
                            )
                          }
                        />
                        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                          {item.display_name ?? item.name}
                        </span>
                      </label>
                      {item.description && (
                        <details
                          className="group text-muted-foreground ml-6 text-xs"
                          onToggle={(event) => {
                            if (event.currentTarget.open) {
                              event.currentTarget
                                .querySelector("p")
                                ?.scrollIntoView({ block: "nearest" });
                            }
                          }}
                        >
                          <summary
                            className="focus-visible:ring-ring flex cursor-pointer list-none items-start gap-1 rounded-sm focus-visible:ring-2 [&::-webkit-details-marker]:hidden"
                            aria-label={`${item.display_name ?? item.name}: ${t.settings.subagents.descriptionLabel}`}
                            aria-describedby={`${subagentDescriptionId}-${item.name}`}
                          >
                            <ChevronRightIcon className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                            <span
                              id={`${subagentDescriptionId}-${item.name}`}
                              className="line-clamp-2 [overflow-wrap:anywhere] group-open:hidden"
                            >
                              {item.description}
                            </span>
                            <span className="hidden group-open:inline">
                              {t.settings.subagents.descriptionLabel}
                            </span>
                          </summary>
                          <p className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
                            {item.description}
                          </p>
                        </details>
                      )}
                    </div>
                  ))}
                  {missingSubagents.map((name) => (
                    <label
                      key={name}
                      className="text-muted-foreground flex items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0"
                        checked
                        disabled={updateAgent.isPending || !canEdit}
                        onChange={() =>
                          setSelectedSubagents((current) =>
                            current.filter((item) => item !== name),
                          )
                        }
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="font-medium">{name}</span>
                        <span className="block text-xs">
                          {t.settings.subagents.missing}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {hasUnsavedChanges && !updateAgent.isPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t.agents.settingsUnsaved}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={requestClose}
              disabled={updateAgent.isPending || !canEdit}
            >
              {t.common.cancel}
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateAgent.isPending || !hasUnsavedChanges || !canEdit}
            >
              {updateAgent.isPending ? t.common.loading : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmingDiscard}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmingDiscard(false);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.settings.unsavedChangesTitle}</DialogTitle>
            <DialogDescription>
              {t.settings.unsavedChangesDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDiscard(false)}
            >
              {t.settings.keepEditing}
            </Button>
            <Button variant="destructive" onClick={() => onOpenChange(false)}>
              {t.settings.discardChanges}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
