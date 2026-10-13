"use client";

import {
  DownloadIcon,
  PenLineIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createMarkdownLinkComponent } from "@/components/workspace/messages/markdown-link";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  getMissingPermissions,
  hasPermission,
  PERMISSIONS,
} from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";
import { exportMemory } from "@/core/memory/api";
import {
  useClearMemory,
  useCreateMemoryFact,
  useDeleteMemoryFact,
  useImportMemory,
  useMemory,
  useUpdateMemoryFact,
} from "@/core/memory/hooks";
import type {
  MemoryFactInput,
  MemoryFactPatchInput,
  UserMemory,
} from "@/core/memory/types";
import {
  SafeStreamdown,
  toStreamdownComponents,
} from "@/core/streamdown/components";
import { streamdownPlugins } from "@/core/streamdown/plugins";
import { pathOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

import { SettingsSection } from "./settings-section";

type MemoryViewFilter = "all" | "facts" | "summaries";
type MemoryFact = UserMemory["facts"][number];

type MemorySection = {
  title: string;
  summary: string;
  updatedAt?: string;
};

type MemorySectionGroup = {
  title: string;
  sections: MemorySection[];
};

type PendingImport = {
  ownerId: string;
  fileName: string;
  memory: UserMemory;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMemorySection(value: unknown): value is {
  summary: string;
  updatedAt: string;
} {
  return (
    isRecord(value) &&
    typeof value.summary === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isMemoryFact(value: unknown): value is UserMemory["facts"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.content === "string" &&
    typeof value.category === "string" &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    typeof value.createdAt === "string" &&
    typeof value.source === "string"
  );
}

function isImportedMemory(value: unknown): value is UserMemory {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.version !== "string" ||
    typeof value.lastUpdated !== "string" ||
    !isRecord(value.user) ||
    !isRecord(value.history) ||
    !Array.isArray(value.facts)
  ) {
    return false;
  }

  return (
    isMemorySection(value.user.workContext) &&
    isMemorySection(value.user.personalContext) &&
    isMemorySection(value.user.topOfMind) &&
    isMemorySection(value.history.recentMonths) &&
    isMemorySection(value.history.earlierContext) &&
    isMemorySection(value.history.longTermBackground) &&
    value.facts.every(isMemoryFact)
  );
}

type FactFormState = {
  content: string;
  category: string;
  confidence: string;
};

const DEFAULT_FACT_FORM_STATE: FactFormState = {
  content: "",
  category: "context",
  confidence: "0.8",
};

function confidenceToLevelKey(confidence: unknown): {
  key: "veryHigh" | "high" | "normal" | "unknown";
  value?: number;
} {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { key: "unknown" };
  }

  const value = Math.min(1, Math.max(0, confidence));
  if (value >= 0.85) return { key: "veryHigh", value };
  if (value >= 0.65) return { key: "high", value };
  return { key: "normal", value };
}

function formatMemorySection(
  section: MemorySection,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const content =
    section.summary.trim() ||
    `<span class="text-muted-foreground">${t.settings.memory.markdown.empty}</span>`;
  return [
    `### ${section.title}`,
    content,
    "",
    section.updatedAt &&
      `> ${t.settings.memory.markdown.updatedAt}: \`${formatTimeAgo(section.updatedAt)}\``,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMemorySectionGroups(
  memory: UserMemory,
  t: ReturnType<typeof useI18n>["t"],
): MemorySectionGroup[] {
  return [
    {
      title: t.settings.memory.markdown.userContext,
      sections: [
        {
          title: t.settings.memory.markdown.work,
          summary: memory.user.workContext.summary,
          updatedAt: memory.user.workContext.updatedAt,
        },
        {
          title: t.settings.memory.markdown.personal,
          summary: memory.user.personalContext.summary,
          updatedAt: memory.user.personalContext.updatedAt,
        },
        {
          title: t.settings.memory.markdown.topOfMind,
          summary: memory.user.topOfMind.summary,
          updatedAt: memory.user.topOfMind.updatedAt,
        },
      ],
    },
    {
      title: t.settings.memory.markdown.historyBackground,
      sections: [
        {
          title: t.settings.memory.markdown.recentMonths,
          summary: memory.history.recentMonths.summary,
          updatedAt: memory.history.recentMonths.updatedAt,
        },
        {
          title: t.settings.memory.markdown.earlierContext,
          summary: memory.history.earlierContext.summary,
          updatedAt: memory.history.earlierContext.updatedAt,
        },
        {
          title: t.settings.memory.markdown.longTermBackground,
          summary: memory.history.longTermBackground.summary,
          updatedAt: memory.history.longTermBackground.updatedAt,
        },
      ],
    },
  ];
}

function summariesToMarkdown(
  memory: UserMemory,
  sectionGroups: MemorySectionGroup[],
  t: ReturnType<typeof useI18n>["t"],
) {
  const parts: string[] = [];

  parts.push(`## ${t.settings.memory.markdown.overview}`);
  parts.push(
    `- **${t.common.lastUpdated}**: \`${formatTimeAgo(memory.lastUpdated)}\``,
  );

  for (const group of sectionGroups) {
    parts.push(`\n## ${group.title}`);
    for (const section of group.sections) {
      parts.push(formatMemorySection(section, t));
    }
  }

  const markdown = parts.join("\n\n");
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  for (const line of lines) {
    i++;
    if (i !== 1 && line.startsWith("## ")) {
      if (out.length === 0 || out[out.length - 1] !== "---") {
        out.push("---");
      }
    }
    out.push(line);
  }

  return out.join("\n");
}

function isMemorySummaryEmpty(memory: UserMemory) {
  return (
    memory.user.workContext.summary.trim() === "" &&
    memory.user.personalContext.summary.trim() === "" &&
    memory.user.topOfMind.summary.trim() === "" &&
    memory.history.recentMonths.summary.trim() === "" &&
    memory.history.earlierContext.summary.trim() === "" &&
    memory.history.longTermBackground.summary.trim() === ""
  );
}

function truncateFactPreview(content: string, maxLength = 140) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const ellipsis = "...";
  if (maxLength <= ellipsis.length) {
    return normalized.slice(0, maxLength);
  }
  return `${normalized.slice(0, maxLength - ellipsis.length)}${ellipsis}`;
}

function upperFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function MemorySettingsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canReadMemory = hasPermission(user, PERMISSIONS.MEMORY_READ);
  const canWriteMemory = hasPermission(user, PERMISSIONS.MEMORY_WRITE);
  const canDeleteMemory = hasPermission(user, PERMISSIONS.MEMORY_DELETE);
  const memoryOwnerId = user?.id ?? null;
  const currentMemoryOwnerId = useRef(memoryOwnerId);
  const currentCanReadMemory = useRef(canReadMemory);
  const currentCanWriteMemory = useRef(canWriteMemory);
  const currentCanDeleteMemory = useRef(canDeleteMemory);
  const previousMemoryOwnerId = useRef(memoryOwnerId);
  currentMemoryOwnerId.current = memoryOwnerId;
  currentCanReadMemory.current = canReadMemory;
  currentCanWriteMemory.current = canWriteMemory;
  currentCanDeleteMemory.current = canDeleteMemory;
  const missingActionPermissions = getMissingPermissions(user, [
    PERMISSIONS.MEMORY_WRITE,
    PERMISSIONS.MEMORY_DELETE,
  ]);
  const { memory, isLoading, isFetching, error, refetch } = useMemory(
    canReadMemory,
    memoryOwnerId,
  );
  const clearMemory = useClearMemory();
  const createMemoryFact = useCreateMemoryFact();
  const deleteMemoryFact = useDeleteMemoryFact();
  const importMemoryMutation = useImportMemory();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const updateMemoryFact = useUpdateMemoryFact();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearDialogOwnerId, setClearDialogOwnerId] = useState<string | null>(
    null,
  );
  const [factToDelete, setFactToDelete] = useState<MemoryFact | null>(null);
  const [factToDeleteOwnerId, setFactToDeleteOwnerId] = useState<string | null>(
    null,
  );
  const [factToEdit, setFactToEdit] = useState<MemoryFact | null>(null);
  const [factEditorOwnerId, setFactEditorOwnerId] = useState<string | null>(
    null,
  );
  const [factEditorOpen, setFactEditorOpen] = useState(false);
  const [factForm, setFactForm] = useState<FactFormState>(
    DEFAULT_FACT_FORM_STATE,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemoryViewFilter>("all");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);
  const exportAbortRef = useRef<AbortController | null>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const factContentInputId = useId();
  const factCategoryInputId = useId();
  const factConfidenceInputId = useId();
  const factConfidenceHintId = useId();

  const clearAllLabel = t.settings.memory.clearAll ?? "Clear all memory";
  const clearAllConfirmTitle =
    t.settings.memory.clearAllConfirmTitle ?? "Clear all memory?";
  const clearAllConfirmDescription =
    t.settings.memory.clearAllConfirmDescription ??
    "This will remove all saved summaries and facts. This action cannot be undone.";
  const clearAllSuccess =
    t.settings.memory.clearAllSuccess ?? "All memory cleared";
  const factDeleteConfirmTitle =
    t.settings.memory.factDeleteConfirmTitle ?? "Delete this fact?";
  const factDeleteConfirmDescription =
    t.settings.memory.factDeleteConfirmDescription ??
    "This fact will be removed from memory immediately. This action cannot be undone.";
  const factDeleteSuccess =
    t.settings.memory.factDeleteSuccess ?? "Fact deleted";
  const addFactLabel = t.settings.memory.addFact;
  const addFactTitle = t.settings.memory.addFactTitle;
  const editFactTitle = t.settings.memory.editFactTitle;
  const addFactSuccess = t.settings.memory.addFactSuccess;
  const editFactSuccess = t.settings.memory.editFactSuccess;
  const factContentLabel = t.settings.memory.factContentLabel;
  const factCategoryLabel = t.settings.memory.factCategoryLabel;
  const factConfidenceLabel = t.settings.memory.factConfidenceLabel;
  const factContentPlaceholder = t.settings.memory.factContentPlaceholder;
  const factCategoryPlaceholder = t.settings.memory.factCategoryPlaceholder;
  const factConfidenceHint = t.settings.memory.factConfidenceHint;
  const factSave = t.settings.memory.factSave;
  const factValidationContent = t.settings.memory.factValidationContent;
  const factValidationConfidence = t.settings.memory.factValidationConfidence;
  const noFacts = t.settings.memory.noFacts ?? "No saved facts yet.";
  const summaryReadOnly = t.settings.memory.summaryReadOnly;
  const memoryFullyEmpty =
    t.settings.memory.memoryFullyEmpty ?? "No memory saved yet.";
  const factPreviewLabel =
    t.settings.memory.factPreviewLabel ?? "Fact to delete";
  const searchPlaceholder =
    t.settings.memory.searchPlaceholder ?? "Search memory";
  const filterAll = t.settings.memory.filterAll ?? "All";
  const filterFacts = t.settings.memory.filterFacts ?? "Facts";
  const filterSummaries = t.settings.memory.filterSummaries ?? "Summaries";
  const noMatches = t.settings.memory.noMatches ?? "No matching memory found";
  const exportButton = t.settings.memory.exportButton ?? t.common.export;
  const exportSuccess =
    t.settings.memory.exportSuccess ?? t.common.exportSuccess;
  const importButton = t.settings.memory.importButton ?? t.common.import;
  const importSuccess = t.settings.memory.importSuccess ?? "Memory imported";

  // 权限撤回或账号切换时清除本地待确认操作，避免新账号继承旧账号的写入意图。
  useEffect(() => {
    return () => exportAbortRef.current?.abort();
  }, [memoryOwnerId, canReadMemory]);

  useEffect(() => {
    const ownerChanged = previousMemoryOwnerId.current !== memoryOwnerId;
    previousMemoryOwnerId.current = memoryOwnerId;
    // 撤权会关闭草稿；即使新旧账号都有写权限，切号也必须清空旧意图。
    if (!canWriteMemory || ownerChanged) {
      setPendingImport(null);
      setFactEditorOpen(false);
      setFactToEdit(null);
      setFactEditorOwnerId(null);
      setFactForm(DEFAULT_FACT_FORM_STATE);
    }
    if (!canDeleteMemory || ownerChanged) {
      setClearDialogOpen(false);
      setClearDialogOwnerId(null);
      setFactToDelete(null);
      setFactToDeleteOwnerId(null);
    }
  }, [canDeleteMemory, canWriteMemory, memoryOwnerId]);

  const sectionGroups = memory ? buildMemorySectionGroups(memory, t) : [];
  const filteredSectionGroups = sectionGroups
    .map((group) => ({
      ...group,
      sections: group.sections.filter((section) =>
        normalizedQuery
          ? `${section.title} ${section.summary}`
              .toLowerCase()
              .includes(normalizedQuery)
          : true,
      ),
    }))
    .filter((group) => group.sections.length > 0);

  const filteredFacts = memory
    ? memory.facts.filter((fact) =>
        normalizedQuery
          ? `${fact.content} ${fact.category}`
              .toLowerCase()
              .includes(normalizedQuery)
          : true,
      )
    : [];

  const showSummaries = filter !== "facts";
  const showFacts = filter !== "summaries";
  const shouldRenderSummariesBlock =
    showSummaries && (filteredSectionGroups.length > 0 || !normalizedQuery);
  const shouldRenderFactsBlock =
    showFacts &&
    (filteredFacts.length > 0 || !normalizedQuery || filter === "facts");
  const hasMatchingVisibleContent =
    !memory ||
    (showSummaries && filteredSectionGroups.length > 0) ||
    (showFacts && filteredFacts.length > 0);

  async function handleExportMemory() {
    if (!canReadMemory || !memoryOwnerId) return;
    // 记忆后端可能返回实现细节；页面错误统一使用双语操作提示，不透传原始 detail。
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      setIsExporting(true);
      const exportedMemory = await exportMemory(
        memoryOwnerId,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        currentMemoryOwnerId.current !== memoryOwnerId ||
        !currentCanReadMemory.current
      ) {
        return;
      }
      const fileName = `deerflow-memory-${(exportedMemory.lastUpdated || new Date().toISOString()).replace(/[:.]/g, "-")}.json`;
      const blob = new Blob([JSON.stringify(exportedMemory, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(exportSuccess);
    } catch {
      if (!controller.signal.aborted) {
        toast.error(t.settings.memory.exportFailed);
      }
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null;
      setIsExporting(false);
    }
  }

  async function handleImportFileSelection(event: {
    target: HTMLInputElement;
  }) {
    if (!canWriteMemory || !memoryOwnerId) return;
    const selectedOwnerId = memoryOwnerId;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (
        currentMemoryOwnerId.current !== selectedOwnerId ||
        !currentCanWriteMemory.current
      ) {
        return;
      }
      if (!isImportedMemory(parsed)) {
        toast.error(t.settings.memory.importInvalidFile);
        return;
      }
      setPendingImport({
        ownerId: selectedOwnerId,
        fileName: file.name,
        memory: parsed,
      });
    } catch {
      if (
        currentMemoryOwnerId.current === selectedOwnerId &&
        currentCanWriteMemory.current
      ) {
        toast.error(t.settings.memory.importInvalidFile);
      }
    }
  }

  async function handleConfirmImport() {
    if (
      !canWriteMemory ||
      !memoryOwnerId ||
      !pendingImport ||
      pendingImport.ownerId !== memoryOwnerId
    ) {
      return;
    }

    const operationOwnerId = pendingImport.ownerId;
    try {
      await importMemoryMutation.mutateAsync({
        memory: pendingImport.memory,
        ownerId: memoryOwnerId,
      });
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanWriteMemory.current
      ) {
        return;
      }
      toast.success(importSuccess);
      setPendingImport(null);
    } catch {
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanWriteMemory.current
      ) {
        return;
      }
      toast.error(t.settings.memory.importFailed);
    }
  }

  async function handleClearMemory() {
    if (
      !canDeleteMemory ||
      !memoryOwnerId ||
      clearDialogOwnerId !== memoryOwnerId
    ) {
      return;
    }
    const operationOwnerId = memoryOwnerId;
    try {
      await clearMemory.mutateAsync({ ownerId: memoryOwnerId });
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanDeleteMemory.current
      ) {
        return;
      }
      toast.success(clearAllSuccess);
      setClearDialogOpen(false);
      setClearDialogOwnerId(null);
    } catch {
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanDeleteMemory.current
      ) {
        return;
      }
      toast.error(t.settings.memory.clearAllFailed);
    }
  }

  async function handleDeleteFact() {
    if (
      !canDeleteMemory ||
      !memoryOwnerId ||
      !factToDelete ||
      factToDeleteOwnerId !== memoryOwnerId
    ) {
      return;
    }
    const operationOwnerId = memoryOwnerId;

    try {
      await deleteMemoryFact.mutateAsync({
        factId: factToDelete.id,
        ownerId: memoryOwnerId,
      });
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanDeleteMemory.current
      ) {
        return;
      }
      toast.success(factDeleteSuccess);
      setFactToDelete(null);
      setFactToDeleteOwnerId(null);
    } catch {
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanDeleteMemory.current
      ) {
        return;
      }
      toast.error(t.settings.memory.factDeleteFailed);
    }
  }

  function openCreateFactDialog() {
    if (!canWriteMemory || !memoryOwnerId) return;
    setFactToEdit(null);
    setFactEditorOwnerId(memoryOwnerId);
    setFactForm(DEFAULT_FACT_FORM_STATE);
    setFactEditorOpen(true);
  }

  function openEditFactDialog(fact: MemoryFact) {
    if (!canWriteMemory || !memoryOwnerId) return;
    setFactToEdit(fact);
    setFactEditorOwnerId(memoryOwnerId);
    setFactForm({
      content: fact.content,
      category: fact.category,
      confidence: String(fact.confidence),
    });
    setFactEditorOpen(true);
  }

  async function handleSaveFact() {
    if (
      !canWriteMemory ||
      !memoryOwnerId ||
      factEditorOwnerId !== memoryOwnerId
    ) {
      return;
    }
    const operationOwnerId = memoryOwnerId;
    const trimmedContent = factForm.content.trim();
    if (!trimmedContent) {
      toast.error(factValidationContent);
      return;
    }

    const confidence = Number(factForm.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      toast.error(factValidationConfidence);
      return;
    }

    const input: MemoryFactInput = {
      content: trimmedContent,
      category: factForm.category.trim() || "context",
      confidence,
    };

    try {
      if (factToEdit) {
        const patchInput: MemoryFactPatchInput = {
          content: input.content,
          category: input.category,
          confidence: input.confidence,
        };
        await updateMemoryFact.mutateAsync({
          factId: factToEdit.id,
          input: patchInput,
          ownerId: memoryOwnerId,
        });
      } else {
        await createMemoryFact.mutateAsync({
          input,
          ownerId: memoryOwnerId,
        });
      }
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanWriteMemory.current
      ) {
        return;
      }
      toast.success(factToEdit ? editFactSuccess : addFactSuccess);
      setFactEditorOpen(false);
      setFactToEdit(null);
      setFactEditorOwnerId(null);
      setFactForm(DEFAULT_FACT_FORM_STATE);
    } catch {
      if (
        currentMemoryOwnerId.current !== operationOwnerId ||
        !currentCanWriteMemory.current
      ) {
        return;
      }
      toast.error(t.settings.memory.factSaveFailed);
    }
  }

  const isFactFormPending =
    createMemoryFact.isPending || updateMemoryFact.isPending;

  return (
    <>
      <SettingsSection
        title={t.settings.memory.title}
        description={t.settings.memory.description}
      >
        {!canReadMemory ? (
          <p role="alert" className="text-muted-foreground text-sm">
            {t.agents.permissionRequired(PERMISSIONS.MEMORY_READ)}
          </p>
        ) : isLoading ? (
          <div className="text-muted-foreground text-sm">
            {t.common.loading}
          </div>
        ) : error && !memory ? (
          <div
            role="alert"
            className="border-destructive/30 flex flex-col items-start gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p>{t.settings.memory.loadFailed}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching
                ? t.settings.memory.retrying
                : t.settings.memory.retry}
            </Button>
          </div>
        ) : !memory ? (
          <div className="text-muted-foreground text-sm">
            {t.settings.memory.empty}
          </div>
        ) : (
          <div className="space-y-4">
            {missingActionPermissions.length > 0 ? (
              <p role="status" className="text-muted-foreground text-sm">
                {t.agents.permissionActionsLimited(
                  missingActionPermissions.join(", "),
                )}
              </p>
            ) : null}
            {error ? (
              <div
                role="alert"
                className="border-destructive/30 flex flex-col items-start gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <p>{t.settings.memory.refreshFailed}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {isFetching
                    ? t.settings.memory.retrying
                    : t.settings.memory.retry}
                </Button>
              </div>
            ) : null}

            {isMemorySummaryEmpty(memory) && memory.facts.length === 0 ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                {memoryFullyEmpty}
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {/* Row 1: search + filter tabs */}
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="min-w-0 flex-1 sm:max-w-md"
                />
                <ToggleGroup
                  type="single"
                  value={filter}
                  onValueChange={(value) => {
                    if (value) setFilter(value as MemoryViewFilter);
                  }}
                  variant="outline"
                  className="shrink-0 self-start sm:ml-auto sm:self-auto"
                >
                  <ToggleGroupItem value="all" className="whitespace-nowrap">
                    {filterAll}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="facts" className="whitespace-nowrap">
                    {filterFacts}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="summaries"
                    className="whitespace-nowrap"
                  >
                    {filterSummaries}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {/* Row 2: actions — constructive group on the left, destructive separated to the right */}
              <div className="flex flex-wrap items-center gap-2">
                {canWriteMemory ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(event) =>
                        void handleImportFileSelection(event)
                      }
                    />
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importMemoryMutation.isPending}
                    >
                      <UploadIcon className="mr-2 h-4 w-4" />
                      {importButton}
                    </Button>
                    <Button variant="outline" onClick={openCreateFactDialog}>
                      <PlusIcon className="mr-2 h-4 w-4" />
                      {addFactLabel}
                    </Button>
                  </>
                ) : null}
                {canReadMemory ? (
                  <Button
                    variant="outline"
                    onClick={() => void handleExportMemory()}
                    disabled={isExporting}
                  >
                    <DownloadIcon className="mr-2 h-4 w-4" />
                    {isExporting ? t.common.loading : exportButton}
                  </Button>
                ) : null}
                {canDeleteMemory ? (
                  <Button
                    variant="destructive"
                    className="ml-auto"
                    onClick={() => {
                      if (!memoryOwnerId) return;
                      setClearDialogOwnerId(memoryOwnerId);
                      setClearDialogOpen(true);
                    }}
                    disabled={clearMemory.isPending}
                  >
                    {clearMemory.isPending ? t.common.loading : clearAllLabel}
                  </Button>
                ) : null}
              </div>
            </div>

            {!hasMatchingVisibleContent && normalizedQuery ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                {noMatches}
              </div>
            ) : null}

            {shouldRenderSummariesBlock ? (
              <div className="min-w-0 rounded-lg border p-4">
                <div className="text-muted-foreground mb-4 text-sm">
                  {summaryReadOnly}
                </div>
                <SafeStreamdown
                  className="size-full min-w-0 [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  {...streamdownPlugins}
                  components={toStreamdownComponents({
                    // Defense in depth on top of the rehype-sanitize step in
                    // streamdownPlugins: memory summaries are LLM/stored
                    // content, so never render an unsafe href (javascript:,
                    // data:, …) as a clickable anchor.
                    a: createMarkdownLinkComponent(),
                  })}
                >
                  {summariesToMarkdown(memory, filteredSectionGroups, t)}
                </SafeStreamdown>
              </div>
            ) : null}

            {shouldRenderFactsBlock ? (
              <div className="min-w-0 rounded-lg border p-4">
                <div className="mb-4">
                  <h3 className="text-base font-medium">
                    {t.settings.memory.markdown.facts}
                  </h3>
                </div>

                {filteredFacts.length === 0 ? (
                  <div className="text-muted-foreground text-sm">
                    {normalizedQuery ? noMatches : noFacts}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredFacts.map((fact) => {
                      const { key } = confidenceToLevelKey(fact.confidence);
                      const confidenceText =
                        t.settings.memory.markdown.table.confidenceLevel[key];

                      return (
                        <div
                          key={fact.id}
                          className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                        >
                          <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                              <span>
                                <span className="text-muted-foreground">
                                  {t.settings.memory.markdown.table.category}:
                                </span>{" "}
                                {upperFirst(fact.category)}
                              </span>
                              <span>
                                <span className="text-muted-foreground">
                                  {t.settings.memory.markdown.table.confidence}:
                                </span>{" "}
                                {confidenceText}
                              </span>
                              <span>
                                <span className="text-muted-foreground">
                                  {t.settings.memory.markdown.table.createdAt}:
                                </span>{" "}
                                {formatTimeAgo(fact.createdAt)}
                              </span>
                              <span>
                                <span className="text-muted-foreground">
                                  {t.settings.memory.markdown.table.source}:
                                </span>{" "}
                                {fact.source === "manual" ? (
                                  t.settings.memory.manualFactSource
                                ) : (
                                  <Link
                                    href={pathOfThread(fact.source)}
                                    className="text-primary underline-offset-4 hover:underline"
                                  >
                                    {t.settings.memory.markdown.table.view}
                                  </Link>
                                )}
                              </span>
                            </div>
                            <p className="text-sm [overflow-wrap:anywhere]">
                              {fact.content}
                            </p>
                          </div>

                          {canWriteMemory || canDeleteMemory ? (
                            <div className="flex shrink-0 items-center gap-1 self-start sm:ml-3">
                              {canWriteMemory ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  onClick={() => openEditFactDialog(fact)}
                                  disabled={updateMemoryFact.isPending}
                                  title={t.common.edit}
                                  aria-label={t.common.edit}
                                >
                                  <PenLineIcon className="h-4 w-4" />
                                </Button>
                              ) : null}
                              {canDeleteMemory ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive shrink-0"
                                  onClick={() => {
                                    if (!memoryOwnerId) return;
                                    setFactToDeleteOwnerId(memoryOwnerId);
                                    setFactToDelete(fact);
                                  }}
                                  disabled={deleteMemoryFact.isPending}
                                  title={t.common.delete}
                                  aria-label={t.common.delete}
                                >
                                  <Trash2Icon className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </SettingsSection>

      <Dialog
        open={
          canDeleteMemory &&
          clearDialogOpen &&
          clearDialogOwnerId === memoryOwnerId
        }
        onOpenChange={(open) => {
          if (!open && clearMemory.isPending) return;
          setClearDialogOpen(open);
          if (!open) setClearDialogOwnerId(null);
        }}
      >
        <DialogContent
          showCloseButton={!clearMemory.isPending}
          aria-busy={clearMemory.isPending}
          onEscapeKeyDown={(event) => {
            if (clearMemory.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (clearMemory.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{clearAllConfirmTitle}</DialogTitle>
            <DialogDescription>{clearAllConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setClearDialogOpen(false);
                setClearDialogOwnerId(null);
              }}
              disabled={clearMemory.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleClearMemory()}
              disabled={clearMemory.isPending}
            >
              {clearMemory.isPending ? t.common.loading : clearAllLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          canWriteMemory &&
          factEditorOpen &&
          factEditorOwnerId === memoryOwnerId
        }
        onOpenChange={(open) => {
          // 保存请求已经提交后，关闭弹窗不会取消请求；锁定当前草稿直到请求结束。
          if (!open && isFactFormPending) return;
          setFactEditorOpen(open);
          if (!open) {
            setFactToEdit(null);
            setFactEditorOwnerId(null);
            setFactForm(DEFAULT_FACT_FORM_STATE);
          }
        }}
      >
        <DialogContent
          showCloseButton={!isFactFormPending}
          aria-busy={isFactFormPending}
          onEscapeKeyDown={(event) => {
            if (isFactFormPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (isFactFormPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {factToEdit ? editFactTitle : addFactTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={factContentInputId}
              >
                {factContentLabel}
              </label>
              <Textarea
                id={factContentInputId}
                disabled={isFactFormPending}
                value={factForm.content}
                onChange={(event) =>
                  setFactForm((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
                placeholder={factContentPlaceholder}
                rows={4}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor={factCategoryInputId}
                >
                  {factCategoryLabel}
                </label>
                <Input
                  id={factCategoryInputId}
                  disabled={isFactFormPending}
                  value={factForm.category}
                  onChange={(event) =>
                    setFactForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  placeholder={factCategoryPlaceholder}
                />
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor={factConfidenceInputId}
                >
                  {factConfidenceLabel}
                </label>
                <Input
                  id={factConfidenceInputId}
                  aria-describedby={factConfidenceHintId}
                  disabled={isFactFormPending}
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={factForm.confidence}
                  onChange={(event) =>
                    setFactForm((current) => ({
                      ...current,
                      confidence: event.target.value,
                    }))
                  }
                />
                <div
                  className="text-muted-foreground text-xs"
                  id={factConfidenceHintId}
                >
                  {factConfidenceHint}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFactEditorOpen(false);
                setFactToEdit(null);
                setFactEditorOwnerId(null);
                setFactForm(DEFAULT_FACT_FORM_STATE);
              }}
              disabled={isFactFormPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => void handleSaveFact()}
              disabled={isFactFormPending}
            >
              {isFactFormPending ? t.common.loading : factSave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          canDeleteMemory &&
          factToDelete !== null &&
          factToDeleteOwnerId === memoryOwnerId
        }
        onOpenChange={(open) => {
          if (!open && deleteMemoryFact.isPending) return;
          if (!open) {
            setFactToDelete(null);
            setFactToDeleteOwnerId(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={!deleteMemoryFact.isPending}
          aria-busy={deleteMemoryFact.isPending}
          onEscapeKeyDown={(event) => {
            if (deleteMemoryFact.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deleteMemoryFact.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{factDeleteConfirmTitle}</DialogTitle>
            <DialogDescription>
              {factDeleteConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          {factToDelete ? (
            <div className="bg-muted rounded-md border p-3 text-sm">
              <div className="text-muted-foreground mb-1 font-medium">
                {factPreviewLabel}
              </div>
              <p className="break-words">
                {truncateFactPreview(factToDelete.content)}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFactToDelete(null);
                setFactToDeleteOwnerId(null);
              }}
              disabled={deleteMemoryFact.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteFact()}
              disabled={deleteMemoryFact.isPending}
            >
              {deleteMemoryFact.isPending ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          canWriteMemory &&
          pendingImport !== null &&
          pendingImport.ownerId === memoryOwnerId
        }
        onOpenChange={(open) => {
          if (!open && importMemoryMutation.isPending) return;
          if (!open) {
            setPendingImport(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={!importMemoryMutation.isPending}
          aria-busy={importMemoryMutation.isPending}
          onEscapeKeyDown={(event) => {
            if (importMemoryMutation.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (importMemoryMutation.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.settings.memory.importConfirmTitle}</DialogTitle>
            <DialogDescription>
              {t.settings.memory.importConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          {pendingImport ? (
            <div className="bg-muted rounded-md border p-3 text-sm">
              <div>
                <span className="text-muted-foreground">
                  {t.settings.memory.importFileLabel}:
                </span>{" "}
                {pendingImport.fileName}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t.settings.memory.markdown.facts}:
                </span>{" "}
                {pendingImport.memory.facts.length}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t.common.lastUpdated}:
                </span>{" "}
                {pendingImport.memory.lastUpdated
                  ? formatTimeAgo(pendingImport.memory.lastUpdated)
                  : "-"}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingImport(null)}
              disabled={importMemoryMutation.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => void handleConfirmImport()}
              disabled={importMemoryMutation.isPending}
            >
              {importMemoryMutation.isPending
                ? t.common.loading
                : t.common.import}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
