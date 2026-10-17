import { createGatewayApiError, throwGatewayApiError } from "@/core/api/errors";
import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";
import { isStaticWebsiteOnly } from "@/core/static-mode";

import { isValidMessageSeq } from "./message-order";
import { loadStaticDemoThread, loadStaticDemoThreads } from "./static-demo";
import type {
  AgentThread,
  RunMessage,
  ThreadTokenUsageResponse,
} from "./types";

export type ThreadHistoryPage = {
  data: RunMessage[];
  has_more: boolean;
  next_before_seq: number | null;
};

export type ThreadCompactResponse = {
  thread_id: string;
  compacted: boolean;
  reason?: string | null;
  removed_message_count: number;
  preserved_message_count: number;
  summary_updated: boolean;
  checkpoint_id?: string | null;
  total_tokens: number;
};

export type CompactThreadContextOptions = {
  signal?: AbortSignal;
  agentName?: string | null;
  modelName?: string | null;
};

export type ThreadBranchResponse = {
  thread_id: string;
  parent_thread_id: string;
  parent_checkpoint_id: string;
  branched_from_message_id: string;
  workspace_clone_mode: string;
};

export type BranchThreadFromTurnInput = {
  messageId: string;
  messageIds?: string[];
  title?: string;
};

export type ThreadMetadataPatch = Record<string, unknown>;

/**
 * The subset of thread fields the Gateway ``PATCH /api/threads/{id}`` handler
 * returns with meaningful values. The endpoint's ``ThreadResponse`` model also
 * serializes default ``values`` and ``interrupts``, but PATCH leaves those empty;
 * callers that need state should read it via a full thread fetch instead.
 */
export type ThreadMetadataPatchResponse = Pick<
  AgentThread,
  "thread_id" | "status" | "created_at" | "updated_at" | "metadata"
>;

async function readThreadAPIError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail) {
      return body.detail;
    }
  } catch {
    // Fall through to the caller-provided message.
  }
  return fallback;
}

/**
 * 读取会话页头摘要。有仓储行时 Gateway 不物化 checkpoint；
 * 静态演示继续使用本地样例会话。
 */
export async function fetchThreadSummary(
  threadId: string,
  signal?: AbortSignal,
): Promise<AgentThread> {
  if (isStaticWebsiteOnly()) {
    return loadStaticDemoThread(threadId);
  }
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/summary`,
    {
      method: "GET",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw await createGatewayApiError(
      response,
      "Failed to load the conversation.",
    );
  }
  return (await response.json()) as AgentThread;
}

export async function fetchThreadTokenUsage(
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadTokenUsageResponse | null> {
  const requestInit: RequestInit = { method: "GET" };
  if (signal) {
    requestInit.signal = signal;
  }
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/token-usage`,
    requestInit,
  );

  if (!response.ok) {
    if (response.status === 403 || response.status === 404) {
      return null;
    }
    throw new Error("Failed to load thread token usage.");
  }

  return (await response.json()) as ThreadTokenUsageResponse;
}

export async function branchThreadFromTurn(
  threadId: string,
  input: BranchThreadFromTurnInput,
): Promise<ThreadBranchResponse> {
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/branches`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message_id: input.messageId,
        message_ids: input.messageIds ?? [input.messageId],
        ...(input.title ? { title: input.title } : {}),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await readThreadAPIError(response, "Failed to branch conversation."),
    );
  }

  return (await response.json()) as ThreadBranchResponse;
}

export async function patchThreadMetadata(
  threadId: string,
  metadata: ThreadMetadataPatch,
): Promise<ThreadMetadataPatchResponse> {
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await readThreadAPIError(response, "Failed to update conversation."),
    );
  }

  return (await response.json()) as ThreadMetadataPatchResponse;
}

export async function createThread(
  threadId: string,
  projectId?: string,
): Promise<AgentThread> {
  const response = await fetchWithAuth(`${getBackendBaseURL()}/api/threads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      thread_id: threadId,
      ...(projectId ? { project_id: projectId } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readThreadAPIError(response, "Failed to create conversation."),
    );
  }

  return (await response.json()) as AgentThread;
}

export async function moveThreadToProject(
  threadId: string,
  projectId: string | null,
): Promise<ThreadMetadataPatchResponse> {
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/move`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ project_id: projectId }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await readThreadAPIError(response, "Failed to move conversation."),
    );
  }

  return (await response.json()) as ThreadMetadataPatchResponse;
}

export async function compactThreadContext(
  threadId: string,
  options: CompactThreadContextOptions = {},
): Promise<ThreadCompactResponse> {
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/compact`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        force: true,
        ...(options.agentName ? { agent_name: options.agentName } : {}),
        ...(options.modelName ? { model_name: options.modelName } : {}),
      }),
      signal: options.signal,
    },
  );

  if (!response.ok) {
    await throwGatewayApiError(response, "Failed to compact context.");
  }

  return (await response.json()) as ThreadCompactResponse;
}

/** Gateway extension not forwarded by the LangGraph SDK's search method. */
export async function searchThreadsByArchive({
  archived,
  metadata,
  status,
  limit,
  offset,
  signal,
}: {
  archived: boolean;
  metadata?: Record<string, unknown>;
  status?: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<AgentThread[]> {
  return searchThreads({ archived, metadata, status, limit, offset, signal });
}

/**
 * Search the signed-in user's threads through Gateway pagination. Omitting
 * `archived` includes archived and active threads, which is useful for product
 * pages that need an inventory across the user's existing work. 可选 signal
 * 供账号导出在取消或离开页面时中止长列表分页。
 */
export async function searchThreads({
  archived,
  metadata,
  status,
  limit,
  offset,
  signal,
}: {
  archived?: boolean;
  metadata?: Record<string, unknown>;
  status?: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}): Promise<AgentThread[]> {
  // 静态演示站没有个人 Gateway；复用公开演示线程，避免把禁用 API 的错误暴露给用户。
  if (isStaticWebsiteOnly()) {
    const demoThreads = await loadStaticDemoThreads();
    const filteredThreads = demoThreads.filter((thread) => {
      const threadMetadata = thread.metadata ?? {};
      const threadIsArchived = threadMetadata.deerflow_archived === true;
      if (archived !== undefined && archived !== threadIsArchived) {
        return false;
      }
      if (status && thread.status !== status) return false;
      return Object.entries(metadata ?? {}).every(
        ([key, value]) => threadMetadata[key] === value,
      );
    });
    return filteredThreads.slice(offset, offset + limit);
  }

  const body = {
    ...(archived === undefined ? {} : { archived }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(status === undefined ? {} : { status }),
    limit,
    offset,
  };
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    throw new Error(
      await readThreadAPIError(response, "Failed to load conversations."),
    );
  }
  return (await response.json()) as AgentThread[];
}

/**
 * 读取 Gateway 的持久化线程消息游标页。产品导出器复用这个公共 API，
 * 不直接读 checkpoint/event 数据库，避免绕过线程 owner-check。
 */
export async function fetchThreadHistoryPage(
  threadId: string,
  {
    beforeSeq,
    limit = 200,
    signal,
  }: { beforeSeq?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<ThreadHistoryPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeSeq !== undefined) query.set("before_seq", String(beforeSeq));
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/messages/page?${query.toString()}`,
    { method: "GET", signal },
  );
  if (!response.ok) {
    throw new Error(
      await readThreadAPIError(response, "Failed to load thread history."),
    );
  }

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Thread history returned an invalid response.");
  }
  const data = Reflect.get(payload, "data");
  const hasMore = Reflect.get(payload, "has_more");
  const nextBeforeSeq = Reflect.get(payload, "next_before_seq");
  if (
    !Array.isArray(data) ||
    typeof hasMore !== "boolean" ||
    (hasMore && !isValidMessageSeq(nextBeforeSeq)) ||
    (!hasMore && nextBeforeSeq !== null)
  ) {
    throw new Error("Thread history returned an invalid pagination cursor.");
  }
  return payload as ThreadHistoryPage;
}
