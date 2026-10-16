/**
 * API functions for file uploads
 */

import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

export interface UploadedFileInfo {
  filename: string;
  original_filename?: string;
  size: number;
  path: string;
  virtual_path: string;
  artifact_url: string;
  extension?: string;
  modified?: number;
  markdown_file?: string;
  markdown_path?: string;
  markdown_virtual_path?: string;
  markdown_artifact_url?: string;
}

export interface UploadResponse {
  success: boolean;
  files: UploadedFileInfo[];
  message: string;
  skipped_files: string[];
}

export interface ListFilesResponse {
  files: UploadedFileInfo[];
  count: number;
}

/** Output files are read-only artifacts, separate from user-uploaded inputs. */
export interface ThreadOutputFileInfo {
  filename: string;
  size: number;
  modified: number;
  artifact_url: string;
}

export interface ThreadOutputFileListResponse {
  files: ThreadOutputFileInfo[];
  count: number;
  truncated: boolean;
}

export interface UploadLimits {
  max_files: number;
  max_file_size: number;
  max_total_size: number;
}

/** 保留 HTTP 状态码，让页面选择本地化且安全的提示文案。 */
export class UploadRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValidationIssue(issue: unknown): string | null {
  if (
    !isRecord(issue) ||
    typeof issue.msg !== "string" ||
    !Array.isArray(issue.loc)
  ) {
    return null;
  }

  if (issue.msg.trim().length === 0) {
    return null;
  }

  const location = issue.loc
    .filter(
      (part): part is string | number =>
        typeof part === "string" || typeof part === "number",
    )
    .map(String)
    .filter((part) => part.length > 0)
    .join(".");

  return location.length > 0 ? `${location}: ${issue.msg}` : issue.msg;
}

function serializeStructuredDetail(
  detail: Record<string, unknown> | unknown[],
): string | null {
  if (
    (Array.isArray(detail) && detail.length === 0) ||
    (!Array.isArray(detail) && Object.keys(detail).length === 0)
  ) {
    return null;
  }

  try {
    return JSON.stringify(detail);
  } catch {
    return null;
  }
}

function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string") {
    return detail.trim().length > 0 ? detail : null;
  }

  if (Array.isArray(detail)) {
    if (detail.length === 0) {
      return null;
    }

    const validationIssues = detail.map(formatValidationIssue);
    if (validationIssues.every((issue) => issue !== null)) {
      return validationIssues.join("; ");
    }

    return serializeStructuredDetail(detail);
  }

  if (isRecord(detail)) {
    return formatValidationIssue(detail) ?? serializeStructuredDetail(detail);
  }

  return null;
}

async function readErrorDetail(
  response: Response,
  fallback: string,
): Promise<string> {
  // Gateway 的 5xx 详情可能含宿主路径或存储信息，只留在服务端日志中，不能展示给用户。
  if (response.status >= 500) {
    return fallback;
  }

  const error = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(error)) {
    return fallback;
  }

  return formatErrorDetail(error.detail) ?? fallback;
}

/**
 * Upload files to a thread
 */
export async function uploadFiles(
  threadId: string,
  files: File[],
): Promise<UploadResponse> {
  const formData = new FormData();

  files.forEach((file) => {
    formData.append("files", file);
  });

  const response = await fetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/uploads`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    throw new UploadRequestError(
      response.status,
      await readErrorDetail(response, "Upload failed"),
    );
  }

  return response.json();
}

/**
 * Load the upload limits enforced by the gateway for a thread
 */
export async function getUploadLimits(
  threadId: string,
  signal?: AbortSignal,
): Promise<UploadLimits> {
  const url = `${getBackendBaseURL()}/api/threads/${threadId}/uploads/limits`;
  const response = signal ? await fetch(url, { signal }) : await fetch(url);

  if (!response.ok) {
    throw new Error(
      await readErrorDetail(response, "Failed to load upload limits"),
    );
  }

  return response.json();
}

/**
 * List all uploaded files for a thread
 */
export async function listUploadedFiles(
  threadId: string,
  signal?: AbortSignal,
): Promise<ListFilesResponse> {
  const url = `${getBackendBaseURL()}/api/threads/${threadId}/uploads/list`;
  const response = signal ? await fetch(url, { signal }) : await fetch(url);

  if (!response.ok) {
    throw new Error(
      await readErrorDetail(response, "Failed to list uploaded files"),
    );
  }

  return response.json();
}

/**
 * List generated files for an owned thread. Gateway verifies thread ownership;
 * output artifacts remain read-only until the host provides a delete contract.
 */
export async function listThreadOutputFiles(
  threadId: string,
  limit = 200,
  signal?: AbortSignal,
): Promise<ThreadOutputFileListResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  const url = `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/uploads/outputs?${query.toString()}`;
  const response = signal ? await fetch(url, { signal }) : await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list generated files (${response.status})`);
  }
  return (await response.json()) as ThreadOutputFileListResponse;
}

/**
 * Delete an uploaded file
 */
export async function deleteUploadedFile(
  threadId: string,
  filename: string,
): Promise<{ success: boolean; message: string }> {
  const encodedFilename = encodeURIComponent(filename);
  const response = await fetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/uploads/${encodedFilename}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new UploadRequestError(
      response.status,
      await readErrorDetail(response, "Failed to delete file"),
    );
  }

  return response.json();
}
