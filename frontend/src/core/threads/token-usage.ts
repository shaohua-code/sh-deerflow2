import type { TokenUsage } from "@/core/messages/usage";

import type { ThreadTokenUsageResponse } from "./types";

export function threadTokenUsageQueryKey(
  threadId?: string | null,
  userId?: string | null,
) {
  const threadKey = ["thread-token-usage", threadId] as const;
  // Omitting userId deliberately returns a prefix for mutation invalidation.
  // Actual reads always include the authenticated owner in their cache key.
  return userId === undefined ? threadKey : ([...threadKey, userId] as const);
}

export function retainThreadTokenUsagePlaceholder(
  previous: ThreadTokenUsageResponse | null | undefined,
  threadId?: string | null,
  previousUserId?: string | null,
  userId?: string | null,
): ThreadTokenUsageResponse | undefined {
  if (previousUserId !== undefined && previousUserId !== userId) {
    return undefined;
  }
  return previous && previous.thread_id === threadId ? previous : undefined;
}

export function threadTokenUsageToTokenUsage(
  usage: ThreadTokenUsageResponse | null | undefined,
): TokenUsage | null {
  if (!usage) {
    return null;
  }
  return {
    inputTokens: usage.total_input_tokens ?? 0,
    outputTokens: usage.total_output_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

export interface ContextUsage {
  tokenCount: number;
  maxContextTokens: number | null;
  percentage: number | null;
}

export function selectContextUsage(
  usage: ThreadTokenUsageResponse | null | undefined,
): ContextUsage | null {
  if (!usage?.context_usage) {
    return null;
  }
  const { token_count, max_context_tokens, percentage } = usage.context_usage;
  return {
    tokenCount: token_count ?? 0,
    maxContextTokens: max_context_tokens ?? null,
    percentage: percentage ?? null,
  };
}
