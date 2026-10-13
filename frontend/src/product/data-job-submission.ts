import type { ProductDataDeletionScope, ProductDataExportScope } from "./api";

export type PendingDataJobSubmission =
  | {
      kind: "export";
      scope: ProductDataExportScope;
      idempotencyKey: string;
    }
  | {
      kind: "deletion";
      scope: ProductDataDeletionScope;
      idempotencyKey: string;
    };

const STORAGE_PREFIX = "flow-desk.data-job-submission.v1.";
const EXPORT_SCOPES = new Set<ProductDataExportScope>([
  "preferences",
  "account",
  "threads",
  "projects",
  "scheduled_tasks",
  "agents",
  "memory",
  "files",
]);
const DELETION_SCOPES = new Set<ProductDataDeletionScope>([
  "preferences",
  "threads",
  "scheduled_tasks",
  "agents",
  "projects",
  "memory",
  "files",
]);

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

function isScope<TScope extends string>(
  value: unknown,
  allowed: ReadonlySet<TScope>,
): value is TScope {
  return typeof value === "string" && allowed.has(value as TScope);
}

function isPendingDataJobSubmission(
  value: unknown,
): value is PendingDataJobSubmission {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    typeof record.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(record.idempotencyKey)
  ) {
    return false;
  }
  if (record.kind === "export") return isScope(record.scope, EXPORT_SCOPES);
  if (record.kind === "deletion") return isScope(record.scope, DELETION_SCOPES);
  return false;
}

/**
 * 任务创建可能已成功但响应丢失，因此只把“同一次请求”标记放在当前用户的标签页会话中。
 * 这里不保存确认短语、任务内容或响应正文；重新打开页面后由用户主动选择是否重放。
 */
export function readPendingDataJobSubmission(
  userId: string,
): PendingDataJobSubmission | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isPendingDataJobSubmission(parsed)) return parsed;
  } catch {
    // 损坏记录必须失败关闭，不能丢弃后生成新键，以免重复触发旧操作。
  }
  throw new Error("Unable to read the saved data-task recovery record");
}

/** 请求发送前先持久化同一逻辑提交的幂等键；存储失败时调用方不得发起写请求。 */
export function savePendingDataJobSubmission(
  userId: string,
  submission: PendingDataJobSubmission,
): boolean {
  try {
    window.sessionStorage.setItem(
      storageKey(userId),
      JSON.stringify(submission),
    );
    return true;
  } catch {
    return false;
  }
}

/** 只清理仍属于本次确认响应的记录，避免晚到回调删掉另一笔恢复请求。 */
export function clearPendingDataJobSubmission(
  userId: string,
  idempotencyKey: string,
): boolean {
  try {
    const current = readPendingDataJobSubmission(userId);
    if (current && current.idempotencyKey !== idempotencyKey) return false;
    window.sessionStorage.removeItem(storageKey(userId));
    return true;
  } catch {
    return false;
  }
}
