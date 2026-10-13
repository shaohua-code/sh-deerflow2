import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

import type {
  MemoryFactInput,
  MemoryFactPatchInput,
  UserMemory,
} from "./types";

function ownerHeaders(expectedUserId: string): Record<string, string> {
  return { "X-Expected-User-Id": expectedUserId };
}

async function readMemoryResponse(
  response: Response,
  fallbackMessage: string,
): Promise<UserMemory> {
  function formatErrorDetail(detail: unknown): string | null {
    if (typeof detail === "string") {
      return detail;
    }

    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            if (typeof record.msg === "string") {
              return record.msg;
            }

            try {
              return JSON.stringify(record);
            } catch {
              return null;
            }
          }

          return String(item);
        })
        .filter(Boolean);

      return parts.length > 0 ? parts.join("; ") : null;
    }

    if (detail && typeof detail === "object") {
      try {
        return JSON.stringify(detail);
      } catch {
        return null;
      }
    }

    if (
      typeof detail === "string" ||
      typeof detail === "number" ||
      typeof detail === "boolean" ||
      typeof detail === "bigint"
    ) {
      return String(detail);
    }

    if (typeof detail === "symbol") {
      return detail.description ?? null;
    }

    return null;
  }

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    const detailMessage = formatErrorDetail(errorData.detail);
    throw new Error(
      detailMessage ?? `${fallbackMessage}: ${response.statusText}`,
    );
  }

  return response.json() as Promise<UserMemory>;
}

export async function loadMemory(
  expectedUserId: string,
  signal?: AbortSignal,
): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory`, {
    headers: ownerHeaders(expectedUserId),
    signal,
  });
  return readMemoryResponse(response, "Failed to fetch memory");
}

export async function clearMemory(expectedUserId: string): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory`, {
    method: "DELETE",
    headers: ownerHeaders(expectedUserId),
  });
  return readMemoryResponse(response, "Failed to clear memory");
}

export async function deleteMemoryFact(
  factId: string,
  expectedUserId: string,
): Promise<UserMemory> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/memory/facts/${encodeURIComponent(factId)}`,
    {
      method: "DELETE",
      headers: ownerHeaders(expectedUserId),
    },
  );
  return readMemoryResponse(response, "Failed to delete memory fact");
}

export async function exportMemory(
  expectedUserId: string,
  signal?: AbortSignal,
): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory/export`, {
    headers: ownerHeaders(expectedUserId),
    signal,
  });
  return readMemoryResponse(response, "Failed to export memory");
}

export async function importMemory(
  memory: UserMemory,
  expectedUserId: string,
): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...ownerHeaders(expectedUserId),
    },
    body: JSON.stringify(memory),
  });
  return readMemoryResponse(response, "Failed to import memory");
}

export async function createMemoryFact(
  input: MemoryFactInput,
  expectedUserId: string,
): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory/facts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...ownerHeaders(expectedUserId),
    },
    body: JSON.stringify(input),
  });
  return readMemoryResponse(response, "Failed to create memory fact");
}

export async function updateMemoryFact(
  factId: string,
  input: MemoryFactPatchInput,
  expectedUserId: string,
): Promise<UserMemory> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/memory/facts/${encodeURIComponent(factId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...ownerHeaders(expectedUserId),
      },
      body: JSON.stringify(input),
    },
  );
  return readMemoryResponse(response, "Failed to update memory fact");
}
