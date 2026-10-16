import {
  listProjectDocuments,
  listProjectThreadFiles,
  urlOfProjectDocumentContent,
} from "@/core/projects/api";
import type {
  Project,
  ProjectDocument,
  ProjectThreadFile,
} from "@/core/projects/types";
import type { AgentThread } from "@/core/threads";
import type {
  ListFilesResponse,
  ThreadOutputFileListResponse,
  UploadedFileInfo,
} from "@/core/uploads/api";

export type FileCenterRow = {
  id: string;
  name: string;
  size: number;
  artifactUrl: string;
  kind: "upload" | "output" | "workspace" | "project-document";
  thread?: AgentThread;
  threadId?: string;
  deleteName?: string;
  projectName?: string;
  projectId?: string;
  documentId?: string;
  threadName?: string;
  modifiedAt?: string;
};

export type FileCenterEmptyState = "filtered" | "partial" | "empty";

/** 有文件来源读取失败时，不能把当前读到的空结果说成“没有文件”。 */
export function getFileCenterEmptyState(
  query: string,
  hasUnavailableSources: boolean,
): FileCenterEmptyState {
  if (query.trim()) return "filtered";
  return hasUnavailableSources ? "partial" : "empty";
}

/**
 * 同一上传文件既可能出现在全局线程接口，也出现在项目的聚合接口。
 * 优先保留直接线程记录，因为它含原始删除文件名和更准确的会话标题。
 */
export function mergeFileCenterRows(
  threadRows: FileCenterRow[],
  projectRows: FileCenterRow[],
) {
  const directUploads = new Set(
    threadRows
      .filter((row) => row.kind === "upload")
      .map((row) => `${row.threadId}:${row.deleteName}`),
  );
  const directOutputs = new Set(
    threadRows
      .filter((row) => row.kind === "output")
      .map((row) => `${row.threadId}:${row.name}`),
  );
  return [
    ...threadRows,
    ...projectRows.filter((row) =>
      row.kind === "upload"
        ? !directUploads.has(`${row.threadId}:${row.deleteName}`)
        : row.kind !== "output" ||
          !directOutputs.has(`${row.threadId}:${row.name}`),
    ),
  ];
}

/**
 * 按小批次并发读取线程上传清单，避免历史线程很多时一次打满 Gateway。
 * 一个线程失败只记录该线程 ID，不会丢掉其他线程已经成功返回的文件。
 */
export async function loadThreadFilePage(
  threads: AgentThread[],
  loadFiles: (
    threadId: string,
    signal?: AbortSignal,
  ) => Promise<ListFilesResponse>,
  concurrency = 4,
  loadOutputs?: (
    threadId: string,
    signal?: AbortSignal,
  ) => Promise<ThreadOutputFileListResponse>,
  signal?: AbortSignal,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("File listing concurrency must be a positive integer");
  }

  const rows: FileCenterRow[] = [];
  const failedThreadIds: string[] = [];
  const truncatedThreadIds: string[] = [];
  for (let start = 0; start < threads.length; start += concurrency) {
    throwIfAborted(signal);
    const batch = threads.slice(start, start + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (thread) => {
        const [uploadsResult, outputsResult] = await Promise.allSettled([
          loadFiles(thread.thread_id, signal),
          loadOutputs?.(thread.thread_id, signal) ?? Promise.resolve(null),
        ]);
        throwIfAborted(signal);
        return { thread, uploadsResult, outputsResult };
      }),
    );
    throwIfAborted(signal);
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        const { thread, uploadsResult, outputsResult } = result.value;
        if (uploadsResult.status === "fulfilled") {
          uploadsResult.value.files.forEach((file: UploadedFileInfo) =>
            rows.push({
              id: `thread:${thread.thread_id}:${file.filename}`,
              thread,
              name: file.original_filename ?? file.filename,
              size: file.size,
              artifactUrl: file.artifact_url,
              kind: "upload",
              threadId: thread.thread_id,
              deleteName: file.filename,
              modifiedAt: file.modified
                ? new Date(file.modified * 1000).toISOString()
                : undefined,
            }),
          );
        } else {
          failedThreadIds.push(thread.thread_id);
        }
        if (outputsResult.status === "fulfilled" && outputsResult.value) {
          outputsResult.value.files.forEach((file) =>
            rows.push({
              id: `thread-output:${thread.thread_id}:${file.filename}`,
              thread,
              name: file.filename,
              size: file.size,
              artifactUrl: file.artifact_url,
              kind: "output",
              threadId: thread.thread_id,
              modifiedAt: new Date(file.modified * 1000).toISOString(),
            }),
          );
          if (outputsResult.value.truncated) {
            truncatedThreadIds.push(thread.thread_id);
          }
        } else if (loadOutputs) {
          failedThreadIds.push(thread.thread_id);
        }
      } else {
        const failedThread = batch[index];
        if (failedThread) failedThreadIds.push(failedThread.thread_id);
      }
    });
  }
  return { rows, failedThreadIds, truncatedThreadIds };
}

/**
 * 读取项目文档架和项目会话里的上传/输出文件。分页一直读到服务端游标
 * 结束；ThreadFilesResponse.truncated 会显式保留，供页面提醒用户。
 */
export async function loadProjectFilePage(
  projects: Project[],
  concurrency = 3,
  { signal }: { signal?: AbortSignal } = {},
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Project listing concurrency must be a positive integer");
  }

  const rows: FileCenterRow[] = [];
  const failedProjectIds: string[] = [];
  let truncated = false;
  for (let start = 0; start < projects.length; start += concurrency) {
    throwIfAborted(signal);
    const batch = projects.slice(start, start + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (project) => {
        // 两类 Gateway 来源相互独立：一侧暂时失败，不应丢弃另一侧已读到的文件。
        const [documents, threadFiles] = await Promise.allSettled([
          loadProjectDocuments(project, signal),
          loadProjectThreadFiles(project, signal),
        ]);
        throwIfAborted(signal);
        const projectRows = [
          ...(documents.status === "fulfilled" ? documents.value : []),
          ...(threadFiles.status === "fulfilled" ? threadFiles.value.rows : []),
        ];
        return {
          rows: projectRows,
          failed:
            documents.status === "rejected" ||
            threadFiles.status === "rejected",
          truncated:
            threadFiles.status === "fulfilled" && threadFiles.value.truncated,
        };
      }),
    );
    throwIfAborted(signal);
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        rows.push(...result.value.rows);
        truncated ||= result.value.truncated;
        if (result.value.failed) {
          const failedProject = batch[index];
          if (failedProject) failedProjectIds.push(failedProject.id);
        }
      } else {
        const failedProject = batch[index];
        if (failedProject) failedProjectIds.push(failedProject.id);
      }
    });
  }
  return { rows, failedProjectIds, truncated };
}

async function loadProjectDocuments(
  project: Project,
  signal?: AbortSignal,
): Promise<FileCenterRow[]> {
  const rows: FileCenterRow[] = [];
  let offset = 0;
  let total = 0;
  do {
    throwIfAborted(signal);
    const page = await listProjectDocuments(project.id, {
      limit: 100,
      offset,
      signal,
    });
    throwIfAborted(signal);
    total = page.total;
    page.documents.forEach((document: ProjectDocument) => {
      rows.push({
        id: `project-document:${project.id}:${document.id}`,
        name: document.name,
        size: document.size_bytes,
        artifactUrl: urlOfProjectDocumentContent(project.id, document.id, {
          download: true,
        }),
        kind: "project-document",
        projectName: project.name,
        projectId: project.id,
        documentId: document.id,
        modifiedAt: document.updated_at,
      });
    });
    if (page.documents.length === 0 && offset < total) {
      throw new Error(`Project document pagination stalled: ${project.id}`);
    }
    offset += page.documents.length;
  } while (offset < total);
  return rows;
}

async function loadProjectThreadFiles(project: Project, signal?: AbortSignal) {
  const rows: FileCenterRow[] = [];
  let offset = 0;
  let truncated = false;
  while (offset >= 0) {
    throwIfAborted(signal);
    const page = await listProjectThreadFiles(project.id, {
      offset,
      thread_limit: 50,
      file_limit: 200,
      signal,
    });
    throwIfAborted(signal);
    truncated ||= page.truncated;
    page.groups.forEach((group) => {
      group.files.forEach((file: ProjectThreadFile) => {
        rows.push({
          id: `project-thread:${project.id}:${group.thread_id}:${file.kind}:${file.name}`,
          threadId: group.thread_id,
          name: file.name,
          size: file.size_bytes,
          artifactUrl: file.artifact_url,
          kind: file.kind,
          deleteName: file.kind === "upload" ? file.name : undefined,
          projectName: project.name,
          projectId: project.id,
          modifiedAt: file.modified_at,
        });
      });
    });
    if (page.next_offset === null) break;
    if (page.next_offset <= offset) {
      throw new Error(`Project thread file pagination stalled: ${project.id}`);
    }
    offset = page.next_offset;
  }
  return { rows, truncated };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Project file export cancelled", "AbortError");
  }
}
