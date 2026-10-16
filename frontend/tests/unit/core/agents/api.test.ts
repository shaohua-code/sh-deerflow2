/**
 * Tests for the error-classification behaviour of `checkAgentName`.
 *
 * Issue #3041: the API keeps a real response detail distinct from a generated
 * status-text fallback, while preserving the `backend_unreachable` category
 * for transport failures and 502/503/504 responses.
 *
 * The typed error may retain the raw response detail for API-level callers,
 * but the product page maps request failures to localized safe copy and never
 * renders that detail directly.
 *
 * These tests pin API classification and fallback behavior; they do not make
 * backend detail part of the user-facing presentation contract.
 */
import { beforeEach, describe, expect, test, rs } from "@rstest/core";

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
}));

rs.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
}));

import {
  AgentsApiDisabledError,
  checkAgentName,
  getAgent,
  listAgents,
  updateAgent,
} from "@/core/agents/api";
import { GatewayApiError } from "@/core/api/errors";
import { fetch as fetcher } from "@/core/api/fetcher";

const mockedFetch = rs.mocked(fetcher);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockedFetch.mockReset();
});

describe("checkAgentName", () => {
  test("returns availability payload on 200", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse(200, { available: true, name: "dealagent" }),
    );
    const result = await checkAgentName("dealagent");
    expect(result).toEqual({ available: true, name: "dealagent" });
  });

  test("forwards the caller's signal so an access change can cancel name checks", async () => {
    const signal = new AbortController().signal;
    mockedFetch.mockResolvedValueOnce(
      jsonResponse(200, { available: true, name: "dealagent" }),
    );

    await checkAgentName("dealagent", { signal });

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/agents/check?name=dealagent",
      { signal },
    );
  });

  test("preserves abort errors instead of reporting a network outage", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Aborted", "AbortError");
    controller.abort();
    mockedFetch.mockRejectedValueOnce(abortError);

    await expect(
      checkAgentName("dealagent", { signal: controller.signal }),
    ).rejects.toBe(abortError);
  });

  test("treats network-layer fetch rejection as backend_unreachable", async () => {
    mockedFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(checkAgentName("dealagent")).rejects.toMatchObject({
      name: "AgentNameCheckError",
      reason: "backend_unreachable",
    });
  });

  test.each([502, 503, 504])(
    "treats HTTP %i as backend_unreachable",
    async (status) => {
      mockedFetch.mockResolvedValueOnce(
        jsonResponse(status, { detail: "Bad Gateway" }),
      );
      await expect(checkAgentName("dealagent")).rejects.toMatchObject({
        name: "AgentNameCheckError",
        reason: "backend_unreachable",
      });
    },
  );

  test("recognises agents_api disabled detail and throws AgentsApiDisabledError", async () => {
    const detail =
      "Custom-agent management API is disabled. Set agents_api.enabled=true to expose agent and user-profile routes over HTTP.";
    mockedFetch.mockResolvedValueOnce(jsonResponse(403, { detail }));
    await expect(checkAgentName("dealagent")).rejects.toBeInstanceOf(
      AgentsApiDisabledError,
    );
  });

  test("carries backend 422 detail through AgentNameCheckError.detail (issue #3041)", async () => {
    // This is the exact response shape produced by `_validate_agent_name`
    // when the user submits a name with disallowed characters — e.g. a
    // trailing space, a dot, a Chinese character, or invisible whitespace
    // pasted in from another window.
    const detail =
      "Invalid agent name 'deal agent'. Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).";
    mockedFetch.mockResolvedValueOnce(jsonResponse(422, { detail }));

    await expect(checkAgentName("deal agent")).rejects.toMatchObject({
      name: "AgentNameCheckError",
      reason: "request_failed",
      // The full detail is preserved on both `detail` (for the UI to
      // recognise "real backend detail vs generated fallback") and
      // `message` (for stack traces / logs).
      detail,
      message: detail,
    });
  });

  test("falls back to statusText in message but leaves detail null when backend returns no detail", async () => {
    // The fallback message must NOT mask the absence of a real backend
    // detail — the page-level catch relies on `detail === null` to choose
    // the localised generic fallback rather than rendering the bare
    // "Failed to check agent name: Internal Server Error" string.
    mockedFetch.mockResolvedValueOnce(
      new Response("", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(checkAgentName("dealagent")).rejects.toMatchObject({
      name: "AgentNameCheckError",
      reason: "request_failed",
      detail: null,
      message: expect.stringContaining("Internal Server Error"),
    });
  });

  test("treats non-string detail as null (defence against future schema drift)", async () => {
    // If the backend ever returns `{detail: {code, message}}` (the shape
    // used by auth errors today) on this endpoint, we must not surface a
    // `[object Object]` string. `detail` should fall back to null so the
    // page uses its localised fallback.
    mockedFetch.mockResolvedValueOnce(
      jsonResponse(500, { detail: { code: "x", message: "y" } }),
    );
    await expect(checkAgentName("dealagent")).rejects.toMatchObject({
      name: "AgentNameCheckError",
      reason: "request_failed",
      detail: null,
    });
  });

  test("does not misclassify a 422 with unrelated detail as agents_api disabled", async () => {
    // Defence-in-depth: the disabled detector matches on the substring
    // "agents_api.enabled", so a 422 whose detail accidentally contains
    // the same substring would be misclassified. The validation detail
    // produced by `_validate_agent_name` never contains it; this test
    // simply asserts that "Invalid agent name ..." stays in the
    // request_failed branch, which is where the page now surfaces it.
    const detail =
      "Invalid agent name 'deal.agent'. Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).";
    mockedFetch.mockResolvedValueOnce(jsonResponse(422, { detail }));
    await expect(checkAgentName("deal.agent")).rejects.not.toBeInstanceOf(
      AgentsApiDisabledError,
    );
  });
});

describe("getAgent", () => {
  test("retains a 404 status so the chat route can show a not-found state", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse(404, { detail: "Agent not found" }),
    );

    const request = getAgent("missing-agent");
    await expect(request).rejects.toBeInstanceOf(GatewayApiError);
    await expect(request).rejects.toMatchObject({
      status: 404,
      message: "Agent not found",
    });
  });

  test("forwards query cancellation signals for list and detail reads", async () => {
    const signal = new AbortController().signal;
    mockedFetch
      .mockResolvedValueOnce(jsonResponse(200, { agents: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { name: "researcher" }));

    await listAgents({ signal });
    await getAgent("researcher", { signal });

    expect(mockedFetch).toHaveBeenNthCalledWith(1, "/api/agents", { signal });
    expect(mockedFetch).toHaveBeenNthCalledWith(2, "/api/agents/researcher", {
      signal,
    });
  });
});

describe("updateAgent", () => {
  test("serializes per-agent model settings into the request body (issue #4336)", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        name: "researcher",
        description: "",
        model: "agent-model",
        tool_groups: null,
        skills: null,
        model_settings: { temperature: 0.2, max_tokens: 12000 },
        thinking_enabled: true,
        reasoning_effort: "high",
      }),
    );

    await updateAgent("researcher", {
      model: "agent-model",
      model_settings: { temperature: 0.2, max_tokens: 12000 },
      thinking_enabled: true,
      reasoning_effort: "high",
    });

    const [, init] = mockedFetch.mock.calls[0]!;
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "agent-model",
      model_settings: { temperature: 0.2, max_tokens: 12000 },
      thinking_enabled: true,
      reasoning_effort: "high",
    });
  });

  test("serializes an explicit null subagent allowlist as unrestricted", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        name: "delegator",
        description: "",
        model: null,
        tool_groups: null,
        skills: null,
        allowed_subagents: null,
      }),
    );

    await updateAgent("delegator", { allowed_subagents: null });

    const [, init] = mockedFetch.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({
      allowed_subagents: null,
    });
  });
});
