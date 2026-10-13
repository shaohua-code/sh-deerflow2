"use client";

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/core/auth/AuthProvider";
import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import {
  useCreateManagedSubagent,
  useDeleteManagedSubagent,
  useSubagents,
  useUpdateManagedSubagent,
} from "@/core/subagents";
import type { Subagent } from "@/core/subagents";

import { SettingsSection } from "./settings-section";
import {
  isValidManagedSubagentName,
  optionalNameListFromDraft,
  optionalNameListToDraft,
  positiveInteger,
  type OptionalNameListMode,
} from "./subagent-settings-helpers";

type Draft = {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolsMode: OptionalNameListMode;
  tools: string;
  skillsMode: OptionalNameListMode;
  skills: string;
  maxTurns: string;
  timeoutSeconds: string;
};

const DRAFT_FIELDS: (keyof Draft)[] = [
  "name",
  "displayName",
  "description",
  "systemPrompt",
  "model",
  "toolsMode",
  "tools",
  "skillsMode",
  "skills",
  "maxTurns",
  "timeoutSeconds",
];

const EMPTY_DRAFT: Draft = {
  name: "",
  displayName: "",
  description: "",
  systemPrompt: "",
  model: "inherit",
  toolsMode: "all",
  tools: "",
  skillsMode: "all",
  skills: "",
  maxTurns: "50",
  timeoutSeconds: "900",
};

function formatOverrideValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function draftFrom(subagent: Subagent): Draft {
  const tools = optionalNameListToDraft(subagent.tools);
  const skills = optionalNameListToDraft(subagent.skills);
  return {
    name: subagent.name,
    displayName: subagent.display_name ?? "",
    description: subagent.description,
    systemPrompt: subagent.system_prompt ?? "",
    model: subagent.model,
    toolsMode: tools.mode,
    tools: tools.text,
    skillsMode: skills.mode,
    skills: skills.text,
    maxTurns: String(subagent.max_turns),
    timeoutSeconds: String(subagent.timeout_seconds),
  };
}

function draftsMatch(left: Draft, right: Draft) {
  return DRAFT_FIELDS.every((field) => left[field] === right[field]);
}

export function SubagentSettingsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.system_role === "admin";
  const canRead = hasPermission(user, PERMISSIONS.SUBAGENTS_READ);
  const canManage =
    isAdmin && canRead && hasPermission(user, PERMISSIONS.SUBAGENTS_ADMIN);
  const { subagents, isLoading, isFetching, error, refetch } =
    useSubagents(canRead);
  const update = useUpdateManagedSubagent();
  const remove = useDeleteManagedSubagent();
  const [editing, setEditing] = useState<Subagent | "new" | null>(null);
  const [deleting, setDeleting] = useState<Subagent | null>(null);

  // 清理权限撤回前留下的编辑和删除意图；恢复权限后不自动打开旧弹窗。
  useEffect(() => {
    if (canManage) return;
    setEditing(null);
    setDeleting(null);
  }, [canManage]);

  async function setEnabled(subagent: Subagent, enabled: boolean) {
    if (!canManage) return;
    try {
      await update.mutateAsync({ name: subagent.name, request: { enabled } });
      toast.success(t.settings.subagents.saved);
    } catch {
      // Gateway detail 供诊断使用，写操作失败只显示双语产品提示。
      toast.error(t.settings.subagents.updateFailed);
    }
  }

  async function deleteSubagent() {
    if (!canManage || !deleting) return;
    try {
      await remove.mutateAsync(deleting.name);
      toast.success(t.settings.subagents.deleted);
      setDeleting(null);
    } catch {
      // 删除错误可能包含运行时或存储信息，不直接展示给用户。
      toast.error(t.settings.subagents.deleteFailed);
    }
  }

  return (
    <SettingsSection
      title={t.settings.subagents.title}
      description={t.settings.subagents.description}
    >
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          {t.settings.subagents.executionNote}
        </p>
        <div className="flex items-center justify-between gap-4">
          {!isAdmin && (
            <p className="text-muted-foreground text-sm">
              {t.settings.subagents.adminNote}
            </p>
          )}
          {isAdmin && canRead && !canManage ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t.agents.permissionRequired(PERMISSIONS.SUBAGENTS_ADMIN)}
            </p>
          ) : null}
          {isAdmin && canManage && (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => setEditing("new")}
            >
              <PlusIcon className="size-4" />
              {t.settings.subagents.create}
            </Button>
          )}
        </div>

        {!canRead ? (
          <p role="alert" className="text-muted-foreground text-sm">
            {t.agents.permissionRequired(PERMISSIONS.SUBAGENTS_READ)}
          </p>
        ) : isLoading ? (
          <p className="text-muted-foreground text-sm">{t.common.loading}</p>
        ) : error && subagents.length === 0 ? (
          <div
            role="alert"
            className="border-destructive/30 flex flex-col items-start gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p>{t.settings.subagents.loadFailed}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching
                ? t.settings.subagents.retrying
                : t.settings.subagents.retry}
            </Button>
          </div>
        ) : subagents.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t.settings.subagents.empty}
          </p>
        ) : (
          <div className="space-y-3">
            {error ? (
              <div
                role="alert"
                className="border-destructive/30 flex flex-col items-start gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <p>{t.settings.subagents.refreshFailed}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {isFetching
                    ? t.settings.subagents.retrying
                    : t.settings.subagents.retry}
                </Button>
              </div>
            ) : null}
            {subagents.map((subagent) => (
              <Item
                variant="outline"
                key={`${subagent.source}-${subagent.name}`}
              >
                <ItemContent>
                  <ItemTitle className="flex flex-wrap items-center gap-2">
                    <span>{subagent.display_name ?? subagent.name}</span>
                    <Badge variant="outline">
                      {subagent.source === "builtin"
                        ? t.settings.subagents.sourceBuiltin
                        : subagent.source === "config"
                          ? t.settings.subagents.sourceConfig
                          : t.settings.subagents.sourceManaged}
                    </Badge>
                    {subagent.conflict && (
                      <Badge variant="destructive">
                        {t.settings.subagents.conflict}
                      </Badge>
                    )}
                  </ItemTitle>
                  <ItemDescription>{subagent.description}</ItemDescription>
                  {Object.keys(subagent.config_overrides).length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      {t.settings.subagents.overridden}:{" "}
                      {Object.entries(subagent.config_overrides)
                        .map(
                          ([field, value]) =>
                            `${field}=${formatOverrideValue(value)}`,
                        )
                        .join("; ")}
                    </p>
                  )}
                </ItemContent>
                <ItemActions className="gap-1">
                  {canManage && subagent.editable && (
                    <>
                      <Switch
                        checked={subagent.enabled}
                        disabled={update.isPending || subagent.conflict}
                        onCheckedChange={(enabled) =>
                          void setEnabled(subagent, enabled)
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(subagent)}
                      >
                        <PencilIcon className="size-4" />
                        <span className="sr-only">{t.common.edit}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleting(subagent)}
                      >
                        <Trash2Icon className="size-4" />
                        <span className="sr-only">{t.common.delete}</span>
                      </Button>
                    </>
                  )}
                </ItemActions>
              </Item>
            ))}
          </div>
        )}
      </div>

      {editing !== null && canManage ? (
        <SubagentEditor
          key={editing === "new" ? "new" : `${editing.source}:${editing.name}`}
          value={editing}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}

      {/* 不可撤销操作统一使用产品弹窗，避免浏览器原生确认框脱离中英文界面。 */}
      <Dialog
        open={canManage && deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        <DialogContent
          showCloseButton={!remove.isPending}
          onEscapeKeyDown={(event) => {
            if (remove.isPending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (remove.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.settings.subagents.deleteTitle}</DialogTitle>
            <DialogDescription>
              <span className="text-foreground font-medium">
                {deleting?.display_name ?? deleting?.name}
              </span>
              {" — "}
              {t.settings.subagents.deleteConfirm}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => void deleteSubagent()}
            >
              {remove.isPending ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function SubagentEditor({
  value,
  onOpenChange,
}: {
  value: Subagent | "new";
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { models } = useModels();
  const create = useCreateManagedSubagent();
  const update = useUpdateManagedSubagent();
  // 编辑对象变化时由父组件的 key 重建编辑器，避免 effect 覆盖用户正在修改的草稿。
  // 初始快照只在 keyed editor 挂载时建立；后台刷新不能改写草稿比较基线。
  const [initialDraft] = useState<Draft>(() =>
    value === "new" ? EMPTY_DRAFT : draftFrom(value),
  );
  const [draft, setDraft] = useState<Draft>(() => initialDraft);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const isNew = value === "new";
  const pending = create.isPending || update.isPending;
  const hasUnsavedChanges = !draftsMatch(draft, initialDraft);

  function set<K extends keyof Draft>(key: K, next: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function requestClose() {
    if (pending) return;
    if (hasUnsavedChanges) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(false);
  }

  async function save() {
    const maxTurns = positiveInteger(draft.maxTurns);
    const timeoutSeconds = positiveInteger(draft.timeoutSeconds);
    if (
      maxTurns === null ||
      timeoutSeconds === null ||
      !isValidManagedSubagentName(draft.name)
    )
      return;

    const payload = {
      display_name: draft.displayName.trim() || null,
      description: draft.description.trim(),
      system_prompt: draft.systemPrompt.trim(),
      model: draft.model,
      tools: optionalNameListFromDraft(draft.toolsMode, draft.tools),
      skills: optionalNameListFromDraft(draft.skillsMode, draft.skills),
      max_turns: maxTurns,
      timeout_seconds: timeoutSeconds,
    };
    try {
      if (isNew) {
        await create.mutateAsync({ name: draft.name.trim(), ...payload });
        toast.success(t.settings.subagents.created);
      } else if (value) {
        await update.mutateAsync({ name: value.name, request: payload });
        toast.success(t.settings.subagents.saved);
      }
      onOpenChange(false);
    } catch {
      // 未知错误不能透传 Gateway detail；按创建或编辑操作显示本地化提示。
      toast.error(
        isNew
          ? t.settings.subagents.createFailed
          : t.settings.subagents.updateFailed,
      );
    }
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          showCloseButton={!pending}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {isNew
                ? t.settings.subagents.createTitle
                : t.settings.subagents.editTitle}
            </DialogTitle>
            <DialogDescription>
              {t.settings.subagents.description}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <Field label={t.settings.subagents.name}>
              <Input
                value={draft.name}
                disabled={pending || !isNew}
                onChange={(event) => set("name", event.target.value)}
              />
              {isNew && (
                <p className="text-muted-foreground text-xs">
                  {t.settings.subagents.nameHint}
                </p>
              )}
            </Field>
            <Field label={t.settings.subagents.displayName}>
              <Input
                value={draft.displayName}
                disabled={pending}
                onChange={(event) => set("displayName", event.target.value)}
              />
            </Field>
            <Field
              className="sm:col-span-2"
              label={t.settings.subagents.descriptionLabel}
            >
              <Textarea
                value={draft.description}
                disabled={pending}
                onChange={(event) => set("description", event.target.value)}
              />
            </Field>
            <Field
              className="sm:col-span-2"
              label={t.settings.subagents.systemPrompt}
            >
              <Textarea
                className="min-h-32"
                value={draft.systemPrompt}
                disabled={pending}
                onChange={(event) => set("systemPrompt", event.target.value)}
              />
            </Field>
            <Field label={t.settings.subagents.model}>
              <Select
                value={draft.model}
                disabled={pending}
                onValueChange={(next) => set("model", next)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">
                    {t.settings.subagents.inheritModel}
                  </SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model.name} value={model.name}>
                      {model.display_name || model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.settings.subagents.tools}>
              <OptionalNameListField
                mode={draft.toolsMode}
                text={draft.tools}
                disabled={pending}
                onModeChange={(mode) => set("toolsMode", mode)}
                onTextChange={(text) => set("tools", text)}
              />
            </Field>
            <Field label={t.settings.subagents.skills}>
              <OptionalNameListField
                mode={draft.skillsMode}
                text={draft.skills}
                disabled={pending}
                onModeChange={(mode) => set("skillsMode", mode)}
                onTextChange={(text) => set("skills", text)}
              />
            </Field>
            <Field label={t.settings.subagents.maxTurns}>
              <Input
                type="number"
                min={1}
                step={1}
                value={draft.maxTurns}
                disabled={pending}
                onChange={(event) => set("maxTurns", event.target.value)}
              />
            </Field>
            <Field label={t.settings.subagents.timeout}>
              <Input
                type="number"
                min={1}
                step={1}
                value={draft.timeoutSeconds}
                disabled={pending}
                onChange={(event) => set("timeoutSeconds", event.target.value)}
              />
            </Field>
          </div>
          {hasUnsavedChanges && !pending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t.settings.subagents.unsaved}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={requestClose} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => void save()}
              disabled={
                pending ||
                !hasUnsavedChanges ||
                !isValidManagedSubagentName(draft.name) ||
                !draft.description.trim() ||
                !draft.systemPrompt.trim() ||
                positiveInteger(draft.maxTurns) === null ||
                positiveInteger(draft.timeoutSeconds) === null
              }
            >
              {pending ? t.common.loading : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmingDiscard}
        onOpenChange={(open) => {
          if (!open) setConfirmingDiscard(false);
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

function OptionalNameListField({
  mode,
  text,
  disabled,
  onModeChange,
  onTextChange,
}: {
  mode: OptionalNameListMode;
  text: string;
  disabled?: boolean;
  onModeChange: (mode: OptionalNameListMode) => void;
  onTextChange: (text: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <Select
        value={mode}
        disabled={disabled}
        onValueChange={(value) => onModeChange(value as OptionalNameListMode)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {t.settings.subagents.listModeAll}
          </SelectItem>
          <SelectItem value="none">
            {t.settings.subagents.listModeNone}
          </SelectItem>
          <SelectItem value="selected">
            {t.settings.subagents.listModeSelected}
          </SelectItem>
        </SelectContent>
      </Select>
      {mode === "selected" && (
        <Input
          value={text}
          disabled={disabled}
          placeholder={t.settings.subagents.listNamesPlaceholder}
          onChange={(event) => onTextChange(event.target.value)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`space-y-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
