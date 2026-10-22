"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  File,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { useTimeAgoText } from "@/components/workspace/time-ago";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useAuth } from "@/core/auth/AuthProvider";
import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";
import type { User } from "@/core/auth/types";
import type { Locale } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import { deleteProjectDocument } from "@/core/projects/api";
import { isStaticWebsiteOnly } from "@/core/static-mode";
import { pathOfThread } from "@/core/threads/utils";
import { deleteUploadedFile } from "@/core/uploads/api";
import {
  fetchProductFiles,
  invalidateProductFileCatalogEntry,
  type ProductFileEntry,
} from "@/product/api";
import { getProductCopy } from "@/product/copy";
import {
  getFileCenterEmptyState,
  type FileCenterRow,
} from "@/product/file-center-data";

const FILE_PAGE_SIZE = 50;
// Gateway 一次返回有界目录后，浏览器端完成检索和翻页，避免每一页都重新遍历磁盘。
const FILE_CATALOG_LIMIT = 10_000;

function formatBytes(size: number, locale: string) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}

function toFileCenterRow(file: ProductFileEntry): FileCenterRow {
  return {
    id: file.file_id,
    name: file.name,
    size: file.size_bytes,
    artifactUrl: file.artifact_url,
    kind:
      file.source === "thread_upload"
        ? "upload"
        : file.source === "thread_output"
          ? "output"
          : file.source === "thread_workspace"
            ? "workspace"
            : "project-document",
    threadId: file.thread_id ?? undefined,
    threadName: file.thread_name ?? undefined,
    deleteName:
      file.source === "thread_upload"
        ? (file.storage_name ?? undefined)
        : undefined,
    projectName: file.project_name ?? undefined,
    projectId: file.project_id ?? undefined,
    documentId: file.document_id ?? undefined,
    modifiedAt: file.modified_at ?? undefined,
  };
}

/** 文件中心目录和删除分别复用 Gateway 的精确路由权限。 */
function getFileDeletePermission(row: FileCenterRow) {
  if (row.kind === "upload") return PERMISSIONS.THREADS_DELETE;
  if (row.kind === "project-document") return PERMISSIONS.PROJECTS_DELETE;
  return null;
}

function getFileCenterPermissionKey(user: User | null) {
  return [
    PERMISSIONS.THREADS_READ,
    PERMISSIONS.PROJECTS_READ,
    PERMISSIONS.THREADS_DELETE,
    PERMISSIONS.PROJECTS_DELETE,
  ]
    .map((permission) => (hasPermission(user, permission) ? "1" : "0"))
    .join("");
}

// 来源由 Gateway 文件目录 DTO 的枚举决定；新增后端来源时同步补双语文案并复核其删除权限。
function sourceLabelOfFile(
  row: FileCenterRow,
  copy: ReturnType<typeof getProductCopy>,
) {
  switch (row.kind) {
    case "upload":
      return copy.filesUpload;
    case "output":
      return copy.filesGenerated;
    case "workspace":
      return copy.filesWorkspace;
    case "project-document":
      return copy.filesProjectDocument;
  }
}

export function FileCenterPage() {
  const { user } = useAuth();

  // 账号或目录/删除权限变化时整体重建内容，清除旧快照和未提交删除草稿。
  const key = `${user?.id ?? "anonymous"}:${getFileCenterPermissionKey(user)}`;
  return <FileCenterContent key={key} user={user} />;
}

function FileCenterContent({ user }: { user: User | null }) {
  const { locale } = useI18n();
  const copy = getProductCopy(locale);
  // 文件目录 API 同时读取会话与项目来源；缺少任一读取权限时不请求，也不展示旧快照。
  const canReadFiles =
    hasPermission(user, PERMISSIONS.THREADS_READ) &&
    hasPermission(user, PERMISSIONS.PROJECTS_READ);
  const canDeleteUploads = hasPermission(user, PERMISSIONS.THREADS_DELETE);
  const canDeleteProjectDocuments = hasPermission(
    user,
    PERMISSIONS.PROJECTS_DELETE,
  );
  const [filePage, setFilePage] = useState(0);
  const [catalogRows, setCatalogRows] = useState<FileCenterRow[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [hasCoverageGaps, setHasCoverageGaps] = useState(false);
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState<string | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);
  const [catalogRefreshDeferred, setCatalogRefreshDeferred] = useState(false);
  // 零行也是一次有效的成功快照；仅凭 catalogRows.length 无法判断能否显示“旧目录”提示。
  const hasCatalogSnapshot = useRef(false);
  const [loading, setLoading] = useState(
    () => !isStaticWebsiteOnly() && canReadFiles,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileCenterRow | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // React 状态要等下一次渲染才更新；同步 ref 防止用户连续点击造成重复删除请求。
  const deleteInFlightRef = useRef(false);

  // 首次请求只负责读取数据，结果由 Promise 回调同步到页面状态；首屏 loading
  // 已由初始化状态决定，避免 effect 运行时先触发一次无意义的同步渲染。
  const loadCatalog = useCallback(
    (signal: AbortSignal, force = false) =>
      fetchProductFiles(FILE_CATALOG_LIMIT, 0, "", signal, force),
    [],
  );

  const applyCatalog = useCallback(
    (result: Awaited<ReturnType<typeof loadCatalog>>) => {
      hasCatalogSnapshot.current = true;
      setCatalogRows(result.files.map(toFileCenterRow));
      setFailedCount(result.failed_count);
      setTruncated(result.truncated);
      setHasCoverageGaps(result.coverage_notes.length > 0);
      setCatalogUpdatedAt(result.catalog_updated_at ?? null);
      setCatalogStale(result.catalog_stale ?? false);
      setCatalogRefreshDeferred(result.catalog_refresh_deferred ?? false);
    },
    [],
  );

  const markCatalogLoadFailed = useCallback(() => {
    setError(copy.filesLoadError);
    // 仅在已成功取得目录后标记旧快照；首次失败没有可称为“陈旧”的目录。
    setCatalogStale((current) => current || hasCatalogSnapshot.current);
  }, [copy.filesLoadError]);

  const refresh = useCallback(
    (signal: AbortSignal, force = false) => {
      // 演示站不加载个人目录；页面空态会说明这一点。
      if (isStaticWebsiteOnly() || !canReadFiles) return;
      setLoading(true);
      setError(null);
      setNotice(null);
      setCatalogRefreshDeferred(false);
      return loadCatalog(signal, force)
        .then((result) => {
          if (!signal.aborted) applyCatalog(result);
        })
        .catch(() => {
          if (!signal.aborted) markCatalogLoadFailed();
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    },
    [applyCatalog, canReadFiles, loadCatalog, markCatalogLoadFailed],
  );

  useEffect(() => {
    // 演示站和缺少目录读取权限的账号都不请求个人文件目录。
    if (isStaticWebsiteOnly() || !canReadFiles) return;
    const controller = new AbortController();
    void loadCatalog(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) applyCatalog(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) markCatalogLoadFailed();
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [applyCatalog, canReadFiles, loadCatalog, markCatalogLoadFailed]);

  // 搜索字段和 Gateway 一致：文件名、关联会话名、项目名；不搜索正文。
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    const readableRows = canReadFiles ? catalogRows : [];
    if (!needle) return readableRows;
    return readableRows.filter((row) =>
      [row.name, row.threadName, row.projectName].some((value) =>
        value?.toLocaleLowerCase(locale).includes(needle),
      ),
    );
  }, [canReadFiles, catalogRows, locale, query]);
  // 刷新或删除可能让最后一页消失；渲染时裁剪页码，避免 effect 再次写状态。
  const lastPage = Math.max(
    0,
    Math.ceil(filteredRows.length / FILE_PAGE_SIZE) - 1,
  );
  const visiblePage = Math.min(filePage, lastPage);
  const rows = filteredRows.slice(
    visiblePage * FILE_PAGE_SIZE,
    (visiblePage + 1) * FILE_PAGE_SIZE,
  );
  const hasNext = (visiblePage + 1) * FILE_PAGE_SIZE < filteredRows.length;

  // 目录覆盖告警与整次加载失败分开渲染：失败由错误卡片说明，覆盖告警只拼接实际存在的原因。
  // 空目录判断仍把加载失败视为来源不可用，避免把故障误写成“没有文件”。
  const coverageWarnings = [
    canReadFiles && failedCount > 0
      ? `${copy.filesLoadError} (${failedCount})`
      : null,
    canReadFiles && truncated ? copy.filesTruncated : null,
    canReadFiles && hasCoverageGaps ? copy.filesSourcesPartial : null,
  ].filter((warning): warning is string => warning !== null);
  const hasUnavailableSources = coverageWarnings.length > 0 || Boolean(error);
  const emptyState = getFileCenterEmptyState(query, hasUnavailableSources);

  // 自有文件中心使用品牌化、可访问的确认弹窗，不依赖浏览器原生 confirm。
  const removeFile = (row: FileCenterRow) => {
    const permission = getFileDeletePermission(row);
    if (!canReadFiles || !permission || !hasPermission(user, permission))
      return;
    setDeleteError(null);
    setPendingDelete(row);
  };

  const confirmRemoveFile = async () => {
    const row = pendingDelete;
    if (!row || deleteInFlightRef.current) return;
    const permission = getFileDeletePermission(row);
    if (!canReadFiles || !permission) return;
    if (!hasPermission(user, permission)) {
      setDeleteError(copy.filesDeletePermissionRequired(permission));
      return;
    }
    deleteInFlightRef.current = true;
    const key = row.id;
    setDeletingKey(key);
    setDeleteError(null);
    setNotice(null);
    try {
      try {
        if (
          row.kind === "project-document" &&
          row.projectId &&
          row.documentId
        ) {
          await deleteProjectDocument(row.projectId, row.documentId);
        } else if (row.threadId && row.deleteName) {
          await deleteUploadedFile(row.threadId, row.deleteName);
        } else {
          throw new Error(copy.filesDeleteFailed);
        }
      } catch (cause) {
        // 删除接口异常可能包含服务端路径，只写入诊断日志并显示产品文案。
        console.error("Failed to delete file from file center:", cause);
        setDeleteError(copy.filesDeleteFailed);
        return;
      }

      // Gateway 已确认删除后，本页立即移除该行；缓存通知只清理本人快照行，
      // 不重复扫描磁盘。下一次成功扫描会补入其他新文件。
      setCatalogRows((current) => current.filter((item) => item.id !== row.id));
      setCatalogStale(true);
      setPendingDelete(null);
      try {
        await invalidateProductFileCatalogEntry(row.id);
        setNotice(copy.filesDeleted);
      } catch {
        // 删除已经提交，不把通知失败误报成删除失败；陈旧状态提示用户目录还需更新。
        setNotice(copy.filesDeletedCatalogStale);
      }
    } finally {
      deleteInFlightRef.current = false;
      setDeletingKey(null);
    }
  };

  const deletionPending =
    pendingDelete !== null && deletingKey === pendingDelete.id;
  const pendingDeletePermission = pendingDelete
    ? getFileDeletePermission(pendingDelete)
    : null;
  const canConfirmDelete =
    pendingDeletePermission !== null &&
    hasPermission(user, pendingDeletePermission);

  return (
    <WorkspaceContainer className="bg-background">
      <WorkspaceHeader />
      <WorkspaceBody className="overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-12">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-muted-foreground text-sm">
                {copy.filesDescription}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                {copy.filesTitle}
              </h1>
              <p className="text-muted-foreground mt-2 text-sm">
                {copy.filesPage(visiblePage + 1)} ·{" "}
                {copy.filesCount(filteredRows.length)}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:max-w-lg">
              <div className="relative w-full">
                <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  disabled={!canReadFiles}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setFilePage(0);
                  }}
                  className="pl-9"
                  placeholder={copy.filesSearch}
                  aria-label={copy.filesSearch}
                />
                <p className="text-muted-foreground mt-2 text-xs leading-5">
                  {copy.filesSearchScope}
                </p>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 text-xs leading-5">
                  {canReadFiles && catalogUpdatedAt && (
                    <FileCatalogUpdatedLine
                      catalogUpdatedAt={catalogUpdatedAt}
                      locale={locale}
                      label={copy.filesCatalogUpdated}
                    />
                  )}
                  {canReadFiles && catalogStale && (
                    <p
                      role="status"
                      className="text-amber-700 dark:text-amber-300"
                    >
                      {copy.filesCatalogStale}
                    </p>
                  )}
                  {canReadFiles && catalogRefreshDeferred && (
                    <p
                      role="status"
                      className="text-amber-700 dark:text-amber-300"
                    >
                      {copy.filesCatalogRefreshDeferred}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={loading || !canReadFiles}
                  onClick={() => {
                    const controller = new AbortController();
                    void refresh(controller.signal, true);
                  }}
                >
                  {loading ? (
                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 size-4" />
                  )}
                  {copy.filesCatalogRefresh}
                </Button>
              </div>
            </div>
          </div>

          {coverageWarnings.length > 0 && (
            <p
              role="status"
              className="mt-5 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            >
              <AlertCircle className="size-4 shrink-0" />
              {coverageWarnings.join(" · ")}
            </p>
          )}
          {canReadFiles && error && (
            <div
              role="alert"
              className="border-destructive/30 mt-5 flex items-center justify-between gap-4 rounded-xl border p-4 text-sm"
            >
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const controller = new AbortController();
                  void refresh(controller.signal, true);
                }}
              >
                {copy.retry}
              </Button>
            </div>
          )}
          {canReadFiles && notice && (
            <p
              role="status"
              className="mt-4 text-sm text-emerald-700 dark:text-emerald-300"
            >
              {notice}
            </p>
          )}

          <div className="border-border/70 bg-card mt-6 overflow-hidden rounded-2xl border">
            {!canReadFiles ? (
              <p
                role="alert"
                className="text-muted-foreground p-12 text-center text-sm"
              >
                {copy.filesReadPermissionRequired}
              </p>
            ) : loading && catalogRows.length === 0 ? (
              <div
                role="status"
                className="text-muted-foreground flex items-center justify-center gap-2 p-12 text-sm"
              >
                <LoaderCircle className="size-4 animate-spin" />
                {copy.loading}
              </div>
            ) : rows.length ? (
              <ul className="divide-border/70 divide-y">
                {rows.map((row) => {
                  const filename = row.name;
                  const deletePermission = getFileDeletePermission(row);
                  const canDelete =
                    deletePermission !== null &&
                    (deletePermission === PERMISSIONS.THREADS_DELETE
                      ? canDeleteUploads
                      : canDeleteProjectDocuments);
                  const deletePermissionHint = deletePermission
                    ? copy.filesDeletePermissionRequired(deletePermission)
                    : undefined;
                  return (
                    <li
                      key={row.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5"
                    >
                      <span className="bg-primary/8 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                        {filename.includes(".") ? (
                          <FileText className="size-4" />
                        ) : (
                          <File className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p
                            className="min-w-0 flex-1 truncate text-sm font-medium"
                            title={filename}
                          >
                            {filename}
                          </p>
                          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4">
                            {sourceLabelOfFile(row, copy)}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {row.threadId ? (
                            <Link
                              href={pathOfThread(row.threadId)}
                              className="hover:text-primary max-w-full min-w-0 truncate"
                            >
                              {row.threadName ??
                                row.projectName ??
                                copy.filesConversation}
                            </Link>
                          ) : (
                            <Link
                              href={`/workspace/projects/${encodeURIComponent(row.projectId ?? "")}`}
                              className="hover:text-primary max-w-full min-w-0 truncate"
                            >
                              {row.projectName}
                            </Link>
                          )}
                          {row.modifiedAt && (
                            <FileRowModifiedLine
                              modifiedAt={row.modifiedAt}
                              locale={locale}
                              label={copy.filesModified}
                            />
                          )}
                        </div>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {formatBytes(row.size, locale)}
                      </span>
                      {row.artifactUrl && (
                        <a
                          href={row.artifactUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={copy.filesOpenInNewTab(filename)}
                          className="text-primary rounded-md px-2 py-1 text-sm hover:underline"
                        >
                          {copy.filesOpen}
                        </a>
                      )}
                      {row.kind !== "output" && row.kind !== "workspace" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${copy.filesDelete}: ${filename}`}
                          title={!canDelete ? deletePermissionHint : undefined}
                          disabled={deletingKey === row.id || !canDelete}
                          onClick={() => void removeFile(row)}
                        >
                          {deletingKey === row.id ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-muted-foreground flex flex-col items-center gap-3 p-12 text-center">
                <File className="size-8 opacity-50" />
                <p className="text-sm">
                  {emptyState === "filtered"
                    ? copy.filesPageNoResults
                    : isStaticWebsiteOnly()
                      ? copy.filesDemoEmpty
                      : emptyState === "partial"
                        ? copy.filesPartialEmpty
                        : copy.filesEmpty}
                </p>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <Button
              variant="outline"
              disabled={loading || visiblePage === 0}
              onClick={() => setFilePage(Math.max(0, visiblePage - 1))}
            >
              <ArrowLeft className="mr-2 size-4" />
              {copy.filesPrevious}
            </Button>
            <span className="text-muted-foreground text-xs">
              {copy.filesPage(visiblePage + 1)}
            </span>
            <Button
              variant="outline"
              disabled={loading || !hasNext}
              onClick={() => setFilePage(visiblePage + 1)}
            >
              {copy.filesNext}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </div>
      </WorkspaceBody>
      <Dialog
        open={canReadFiles && pendingDelete !== null}
        onOpenChange={(open) => {
          // 关闭弹窗不会取消 Gateway 请求；提交期间必须保留当前状态，避免误导用户。
          if (!open && !deletionPending) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={!deletionPending}
          aria-busy={deletionPending}
          onEscapeKeyDown={(event) => {
            if (deletionPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deletionPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{copy.filesDeleteTitle}</DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === "project-document"
                ? copy.filesDeleteProjectConfirm(pendingDelete.name)
                : pendingDelete
                  ? copy.filesDeleteConfirm(pendingDelete.name)
                  : null}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-destructive text-sm">
              {deleteError}
            </p>
          )}
          {pendingDelete && !canConfirmDelete && pendingDeletePermission && (
            <p role="alert" className="text-destructive text-sm">
              {copy.filesDeletePermissionRequired(pendingDeletePermission)}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deletionPending}
              onClick={() => {
                setPendingDelete(null);
                setDeleteError(null);
              }}
            >
              {copy.filesDeleteCancel}
            </Button>
            <Button
              variant="destructive"
              disabled={deletionPending || !canConfirmDelete}
              onClick={() => void confirmRemoveFile()}
            >
              {deletionPending ? copy.filesDeleting : copy.filesDeleteAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceContainer>
  );
}

function FileCatalogUpdatedLine({
  catalogUpdatedAt,
  locale,
  label,
}: {
  catalogUpdatedAt: string;
  locale: Locale;
  label: (time: string) => string;
}) {
  const timeAgo = useTimeAgoText(catalogUpdatedAt, locale);
  return <p className="text-muted-foreground">{label(timeAgo)}</p>;
}

function FileRowModifiedLine({
  modifiedAt,
  locale,
  label,
}: {
  modifiedAt: string;
  locale: Locale;
  label: (time: string) => string;
}) {
  const timeAgo = useTimeAgoText(modifiedAt, locale);
  return <span className="shrink-0">{label(timeAgo)}</span>;
}
