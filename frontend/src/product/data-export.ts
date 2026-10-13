import { listAgents } from "@/core/agents/api";
import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { exportMemory } from "@/core/memory/api";
import { listProjects } from "@/core/projects/api";
import { fetchScheduledTasks } from "@/core/scheduled-tasks/api";
import type { AgentThread, RunMessage } from "@/core/threads";
import { fetchThreadHistoryPage, searchThreads } from "@/core/threads/api";
import { listThreadOutputFiles, listUploadedFiles } from "@/core/uploads/api";
import { fetchProductFiles, fetchProductSettings } from "@/product/api";
import {
  loadProjectFilePage,
  loadThreadFilePage,
  mergeFileCenterRows,
  type FileCenterRow,
} from "@/product/file-center-data";

const THREAD_PAGE_SIZE = 1000;
const HISTORY_CONCURRENCY = 4;
const WORKSPACE_CATALOG_EXPORT_LIMIT = 10_000;
// 附件总大小限制是共享状态，因此要串行下载文件；并行响应可能同时通过
// 大小检查，导致最终导出包超出限制。
const FILE_CONCURRENCY = 1;
/** 避免浏览器为超大附件包同时保留过多 base64 文本和原始字节。 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type DataExportStage = "inventory" | "history" | "files" | "package";
export type DataExportProgress = {
  stage: DataExportStage;
  completed?: number;
  total?: number;
};

export type DataExportOptions = {
  signal?: AbortSignal;
};

type ExportFailure = {
  resource: string;
  resource_id?: string;
  reason: "unavailable" | "size_limit";
};

type ExportedFile = {
  id: string;
  name: string;
  size_bytes: number;
  sha256: string | null;
  content_base64: string;
  source: {
    project?: string;
    thread_id?: string;
    kind: FileCenterRow["kind"];
  };
};

function errorRecord(resource: string, resourceId?: string): ExportFailure {
  return {
    resource,
    ...(resourceId ? { resource_id: resourceId } : {}),
    reason: "unavailable",
  };
}

async function settledResource<T>(
  name: string,
  load: () => Promise<T>,
  failures: ExportFailure[],
): Promise<T | null> {
  try {
    return await load();
  } catch {
    // 不要把原始 API 错误写进可下载的数据包，其中可能包含本机路径或内部实现细节。
    // 记录资源 ID 和状态码就足以帮助用户定位失败项。
    failures.push(errorRecord(name));
    return null;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Data export cancelled", "AbortError");
  }
}

async function loadAllThreads(signal?: AbortSignal) {
  const threads: AgentThread[] = [];
  for (let offset = 0; ; offset += THREAD_PAGE_SIZE) {
    throwIfAborted(signal);
    const page = await searchThreads({
      limit: THREAD_PAGE_SIZE,
      offset,
      ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal);
    threads.push(...page);
    if (page.length < THREAD_PAGE_SIZE) return threads;
    if (threads.length > 100_000) {
      throw new Error("Thread export pagination exceeded its safety limit");
    }
  }
}

async function loadFullThreadHistory(
  thread: AgentThread,
  signal?: AbortSignal,
) {
  const messages: RunMessage[] = [];
  let beforeSeq: number | undefined;
  while (true) {
    throwIfAborted(signal);
    const page = await fetchThreadHistoryPage(thread.thread_id, {
      beforeSeq,
      ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal);
    messages.push(...page.data);
    if (!page.has_more) break;
    if (
      page.next_before_seq === null ||
      (beforeSeq !== undefined && page.next_before_seq >= beforeSeq)
    ) {
      throw new Error("Thread history cursor did not move backwards");
    }
    beforeSeq = page.next_before_seq;
  }
  return messages.sort((left, right) => left.seq - right.seq);
}

async function mapInBatches<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  let completed = 0;
  for (let start = 0; start < values.length; start += concurrency) {
    throwIfAborted(signal);
    const batch = values.slice(start, start + concurrency);
    const settled = await Promise.allSettled(
      batch.map((value, index) => operation(value, start + index)),
    );
    // 用户取消后应终止整个包，而不是把 AbortError 写成普通的部分导出失败。
    throwIfAborted(signal);
    results.push(...settled);
    completed += batch.length;
    onProgress?.(completed, values.length);
  }
  return results;
}

function encodeBase64(bytes: Uint8Array) {
  // 分块转换可以避免展开运算符一次接收过多参数，触发浏览器的参数数量限制。
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    // 复制到独立 ArrayBuffer，满足 Web Crypto 的 BufferSource 类型约束，
    // 也兼容不接受共享底层缓冲区 typed-array 视图的浏览器。
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      bytes.slice().buffer,
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}

async function exportFile(
  row: FileCenterRow,
  signal?: AbortSignal,
): Promise<ExportedFile> {
  const response = await fetchWithAuth(row.artifactUrl, {
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("File is unavailable");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES) {
    throw new RangeError("File exceeds limit");
  }
  const bytes = await readBoundedResponse(response, MAX_FILE_BYTES);
  return {
    id: row.id,
    name: row.name,
    size_bytes: bytes.byteLength,
    sha256: await sha256(bytes),
    content_base64: encodeBase64(bytes),
    source: {
      ...(row.projectName ? { project: row.projectName } : {}),
      ...(row.threadId ? { thread_id: row.threadId } : {}),
      kind: row.kind,
    },
  };
}

function isPortableWorkspacePath(name: string) {
  return (
    name.length > 0 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.includes(":") &&
    !name.includes("\0") &&
    name
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function isSensitiveWorkspacePath(name: string) {
  // 与 Gateway 的凭据文件名规则保持一致；只按路径名筛选，不读取内容做密钥扫描。
  return name.split(/[\\/]/).some((part) => {
    const normalized = part.toLowerCase();
    return (
      normalized === ".env" ||
      normalized.startsWith(".env.") ||
      normalized.includes("api_key") ||
      normalized.includes("apikey") ||
      normalized.endsWith(".key") ||
      normalized.endsWith(".pem") ||
      ["credential", "password", "private_key", "secret", "token"].some(
        (marker) => normalized.includes(marker),
      )
    );
  });
}

/**
 * 通过产品 Gateway 的 owner-scoped 文件目录补齐会话工作区文件。
 * 内容下载仍使用目录返回的 Gateway URL；打开每个文件时会再次检查线程归属。
 */
async function loadWorkspaceFileCatalog(signal?: AbortSignal) {
  const rows: FileCenterRow[] = [];
  throwIfAborted(signal);
  const page = await fetchProductFiles(
    WORKSPACE_CATALOG_EXPORT_LIMIT,
    0,
    "",
    signal,
  );
  throwIfAborted(signal);
  let sensitivePathsSkipped = 0;
  let unsafePathsSkipped = 0;

  for (const file of page.files) {
    if (file.source !== "thread_workspace") continue;
    if (!isPortableWorkspacePath(file.name)) {
      unsafePathsSkipped += 1;
      continue;
    }
    if (isSensitiveWorkspacePath(file.name)) {
      sensitivePathsSkipped += 1;
      continue;
    }
    rows.push({
      id: file.file_id,
      name: file.name,
      size: file.size_bytes,
      artifactUrl: file.artifact_url,
      kind: "workspace",
      ...(file.thread_id ? { threadId: file.thread_id } : {}),
      ...(file.thread_name ? { threadName: file.thread_name } : {}),
    });
  }

  return {
    rows,
    coverageNotes: page.coverage_notes,
    failedCount: page.failed_count,
    truncated: page.truncated || page.has_more,
    sensitivePathsSkipped,
    unsafePathsSkipped,
  };
}

/** 流式读取附件并在内存中超过上限时立即中止，避免先完整下载超大文件。 */
async function readBoundedResponse(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new RangeError("File exceeds limit");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RangeError("File exceeds limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

/**
 * 汇总当前登录用户通过 Gateway 公共接口可见的数据，生成可下载 JSON。
 * 身份由各 API 自己从登录态解析；userId 仅用于标记导出包归属，绝不
 * 作为资源查询参数。执行状态只存在当前页面，本包也不是可恢复的备份。
 */
export async function createUserDataExport(
  userId: string,
  onProgress?: (progress: DataExportProgress) => void,
  { signal }: DataExportOptions = {},
) {
  throwIfAborted(signal);
  const generatedAt = new Date().toISOString();
  const failures: ExportFailure[] = [];
  // 导出留在当前浏览器完成；阶段事件供账号页反馈长任务状态，不代表后台作业。
  onProgress?.({ stage: "inventory" });
  const [
    threadsResult,
    agents,
    projectsResult,
    scheduledTasks,
    memory,
    settings,
  ] = await Promise.all([
    settledResource("threads", () => loadAllThreads(signal), failures),
    settledResource("agents", listAgents, failures),
    settledResource(
      "projects",
      async () => {
        const [active, archived] = await Promise.all([
          listProjects("active"),
          listProjects("archived"),
        ]);
        return Array.from(
          new Map(
            [...active, ...archived].map((project) => [project.id, project]),
          ).values(),
        );
      },
      failures,
    ),
    settledResource("scheduled_tasks", fetchScheduledTasks, failures),
    settledResource("memory", exportMemory, failures),
    settledResource("product_settings", fetchProductSettings, failures),
  ]);

  // 当前部分资源清单 API 还不支持 AbortSignal。先等已经发出的读取结束，
  // 再停止后续体量更大的会话历史分页，避免取消后继续请求。
  throwIfAborted(signal);
  const threads = threadsResult ?? [];
  onProgress?.({ stage: "history", completed: 0, total: threads.length });
  const historyResults = await mapInBatches(
    threads,
    HISTORY_CONCURRENCY,
    (thread) => loadFullThreadHistory(thread, signal),
    (completed, total) => onProgress?.({ stage: "history", completed, total }),
    signal,
  );
  const conversations = threads.map((thread, index) => {
    const history = historyResults[index];
    if (!history || history.status === "rejected") {
      failures.push(errorRecord("thread_history", thread.thread_id));
    }
    return {
      thread_id: thread.thread_id,
      title: thread.values?.title ?? "Untitled",
      status: thread.status,
      created_at: thread.created_at,
      updated_at: thread.updated_at,
      metadata: thread.metadata,
      messages: history?.status === "fulfilled" ? history.value : [],
    };
  });

  onProgress?.({ stage: "files", completed: 0, total: threads.length });
  const [threadFiles, projectFiles, workspaceFiles] = await Promise.all([
    loadThreadFilePage(
      threads,
      listUploadedFiles,
      FILE_CONCURRENCY,
      listThreadOutputFiles,
    ),
    settledResource(
      "project_files",
      async () => loadProjectFilePage(projectsResult ?? []),
      failures,
    ),
    settledResource(
      "workspace_file_catalog",
      () => loadWorkspaceFileCatalog(signal),
      failures,
    ),
  ]);
  throwIfAborted(signal);

  threadFiles.failedThreadIds.forEach((threadId) =>
    failures.push(errorRecord("thread_files", threadId)),
  );
  threadFiles.truncatedThreadIds.forEach((threadId) =>
    failures.push({
      resource: "thread_files",
      resource_id: threadId,
      reason: "size_limit",
    }),
  );
  const projectFileRows = projectFiles?.rows ?? [];
  projectFiles?.failedProjectIds.forEach((projectId) =>
    failures.push(errorRecord("project_files", projectId)),
  );
  if (projectFiles?.truncated) {
    failures.push(errorRecord("project_files_truncated"));
  }
  if (workspaceFiles?.failedCount) {
    failures.push(errorRecord("workspace_file_catalog"));
  }
  if (workspaceFiles?.truncated) {
    failures.push({
      resource: "workspace_file_catalog_truncated",
      reason: "size_limit",
    });
  }
  const uniqueFiles = [
    ...mergeFileCenterRows(threadFiles.rows, projectFileRows),
    ...(workspaceFiles?.rows ?? []),
  ];
  let downloadedBytes = 0;
  const files: ExportedFile[] = [];
  onProgress?.({ stage: "files", completed: 0, total: uniqueFiles.length });
  const fileResults = await mapInBatches(
    uniqueFiles,
    FILE_CONCURRENCY,
    async (row) => {
      if (downloadedBytes + row.size > MAX_FILE_BYTES) {
        throw new RangeError("Export file size limit reached");
      }
      const file = await exportFile(row, signal);
      if (downloadedBytes + file.size_bytes > MAX_FILE_BYTES) {
        throw new RangeError("Export file size limit reached");
      }
      downloadedBytes += file.size_bytes;
      return file;
    },
    (completed, total) => onProgress?.({ stage: "files", completed, total }),
    signal,
  );
  fileResults.forEach((result, index) => {
    if (result.status === "fulfilled") files.push(result.value);
    else {
      const row = uniqueFiles[index];
      failures.push({
        resource: "file_content",
        ...(row ? { resource_id: row.id } : {}),
        reason:
          result.reason instanceof RangeError ? "size_limit" : "unavailable",
      });
    }
  });

  onProgress?.({ stage: "package" });
  throwIfAborted(signal);
  return {
    format: "flow-desk-user-data-v1",
    generated_at: generatedAt,
    owner_user_id: userId,
    // 所有可读取接口成功也不能证明覆盖了宿主全部数据；缺少的 checkpoint、密钥和
    // 当前 Gateway 未提供的文件没有办法从前端发现，因此此包始终标记为 partial。
    completeness: "partial" as const,
    coverage_notes: [
      "Even with no item-level failures, this package covers only sources exposed by the current account APIs; it is not a complete account export.",
      "Resources are read over multiple requests and do not represent one transactional point-in-time snapshot.",
      "Messages are readable Gateway history, not executable LangGraph checkpoint state.",
      "The export does not read deployment credential stores; user file contents are not scanned for secrets.",
      "File content export is limited to 100 MiB per package; omitted files appear in failures.",
      "Eligible workspace files are read from the owner-scoped catalog; sensitive-looking names and non-portable paths are excluded.",
      ...(workspaceFiles?.sensitivePathsSkipped
        ? ["Sensitive-looking workspace paths were omitted from the export."]
        : []),
      ...(workspaceFiles?.unsafePathsSkipped
        ? [
            "Workspace paths that were not safe portable relative paths were omitted.",
          ]
        : []),
      ...(workspaceFiles?.coverageNotes ?? []),
      "Agent output files not exposed by the current owner-scoped listing APIs are not included.",
    ],
    failures,
    resources: {
      conversations,
      agents: agents ?? [],
      projects: projectsResult ?? [],
      scheduled_tasks: scheduledTasks ?? [],
      memory,
      product_settings: settings?.settings ?? [],
      files,
    },
  };
}
