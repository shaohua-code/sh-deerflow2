import { createGatewayApiError } from "@/core/api/errors";
import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";
export { fetchAgentsApiEnabled } from "@/core/features/api";

import type { Agent, CreateAgentRequest, UpdateAgentRequest } from "./types";

const BACKEND_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

export class AgentNameCheckError extends Error {
  constructor(
    message: string,
    public readonly reason: "backend_unreachable" | "request_failed",
    /**
     * Raw backend `detail` string when the failure came from a backend
     * response carrying one. `null` when no detail was provided (e.g.
     * network-layer failure, empty response body, unparseable body) — in
     * which case `message` is a generated fallback like "Failed to check
     * agent name: Bad Gateway" and the UI should prefer its own localized
     * fallback instead of surfacing the generated string.
     */
    public readonly detail: string | null = null,
  ) {
    super(message);
    this.name = "AgentNameCheckError";
  }
}

export class AgentsApiDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentsApiDisabledError";
  }
}

function isAgentsApiDisabledDetail(detail: string | undefined): boolean {
  return typeof detail === "string" && detail.includes("agents_api.enabled");
}

export async function listAgents(
  options: { signal?: AbortSignal } = {},
): Promise<Agent[]> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents`, {
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`Failed to load agents: ${res.statusText}`);
  const data = (await res.json()) as { agents: Agent[] };
  return data.agents;
}

export async function getAgent(
  name: string,
  options: { signal?: AbortSignal } = {},
): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    signal: options.signal,
  });
  if (!res.ok) {
    // 保留 HTTP 状态供页面区分 404 与暂时性故障；响应正文只用于诊断。
    throw await createGatewayApiError(res, `Failed to load agent '${name}'`);
  }
  return res.json() as Promise<Agent>;
}

export async function createAgent(request: CreateAgentRequest): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    if (isAgentsApiDisabledDetail(err.detail)) {
      throw new AgentsApiDisabledError(err.detail!);
    }
    throw new Error(err.detail ?? `Failed to create agent: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function updateAgent(
  name: string,
  request: UpdateAgentRequest,
): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update agent: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function deleteAgent(name: string): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.statusText}`);
}

export async function checkAgentName(
  name: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ available: boolean; name: string }> {
  let res: Response;
  try {
    res = await fetch(
      `${getBackendBaseURL()}/api/agents/check?name=${encodeURIComponent(name)}`,
      { signal: options.signal },
    );
  } catch (error) {
    // 账号权限变更会主动取消查名；不要把主动取消误报成 Gateway 离线。
    if (options.signal?.aborted) throw error;
    throw new AgentNameCheckError(
      "Could not reach the application server.",
      "backend_unreachable",
    );
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    if (isAgentsApiDisabledDetail(err.detail)) {
      throw new AgentsApiDisabledError(err.detail!);
    }
    if (BACKEND_UNAVAILABLE_STATUSES.has(res.status)) {
      throw new AgentNameCheckError(
        "Could not reach the application server.",
        "backend_unreachable",
      );
    }
    const backendDetail = typeof err.detail === "string" ? err.detail : null;
    throw new AgentNameCheckError(
      backendDetail ?? `Failed to check agent name: ${res.statusText}`,
      "request_failed",
      backendDetail,
    );
  }
  return res.json() as Promise<{ available: boolean; name: string }>;
}
