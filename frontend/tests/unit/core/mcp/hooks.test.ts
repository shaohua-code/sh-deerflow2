import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
}));

rs.mock("sonner", () => ({
  toast: {
    error: rs.fn(),
  },
}));

import { fetch } from "@/core/api/fetcher";
import { MCPConfigRequestError, loadMCPConfig } from "@/core/mcp/api";
import {
  getEnableMCPServerMutationOptions,
  getMCPServerMutationOptions,
} from "@/core/mcp/hooks";

const mockedFetch = rs.mocked(fetch);
const mockedToastError = rs.mocked(toast.error);
const mutationMessages = {
  adminRequired: "Admin privileges are required to manage MCP tools.",
  enableFailed: "Could not update the MCP server. Please try again.",
  addFailed: "Could not add the MCP server. Please try again.",
  updateFailed: "Could not save the MCP server. Please try again.",
  deleteFailed: "Could not remove the MCP server. Please try again.",
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retryDelay: 0,
      },
    },
  });
}

describe("useMCPConfig retry policy", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedToastError.mockReset();
  });

  it("does not retry when loadMCPConfig throws MCPConfigRequestError (403)", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Forbidden" }),
    } as Response);

    const client = makeClient();
    await expect(
      client.fetchQuery({
        queryKey: ["mcpConfig"],
        queryFn: () => loadMCPConfig(),
        retry: (count, error) =>
          !(error instanceof MCPConfigRequestError) && count < 3,
      }),
    ).rejects.toBeInstanceOf(MCPConfigRequestError);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("retries up to 3 times on generic errors", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));

    const client = makeClient();
    await expect(
      client.fetchQuery({
        queryKey: ["mcpConfig"],
        queryFn: () => loadMCPConfig(),
        retry: (count, error) =>
          !(error instanceof MCPConfigRequestError) && count < 3,
      }),
    ).rejects.toThrow("network down");

    // initial + 3 retries = 4 calls
    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  it("does not retry on MCPConfigRequestError 5xx either (deterministic typed error)", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Boom" }),
    } as Response);

    const client = makeClient();
    await expect(
      client.fetchQuery({
        queryKey: ["mcpConfig"],
        queryFn: () => loadMCPConfig(),
        retry: (count, error) =>
          !(error instanceof MCPConfigRequestError) && count < 3,
      }),
    ).rejects.toBeInstanceOf(MCPConfigRequestError);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("MCP server state mutation", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedToastError.mockReset();
  });

  it("invalidates MCP config after a successful targeted update", async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ mcp_servers: {} }), { status: 200 }),
    );
    const client = makeClient();
    const invalidateQueries = rs
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue();
    const mutation = client
      .getMutationCache()
      .build(
        client,
        getEnableMCPServerMutationOptions(client, mutationMessages),
      );

    await mutation.execute({ serverName: "github", enabled: false });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["mcpConfig"],
    });
    expect(mockedToastError).not.toHaveBeenCalled();
  });

  it("keeps backend detail out of targeted update failure toasts", async () => {
    const detail =
      "MCP server 'semantic-scholar' uses disallowed stdio command 's2-mcp-server'.";
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail }), { status: 400 }),
    );
    const client = makeClient();
    const invalidateQueries = rs.spyOn(client, "invalidateQueries");
    const mutation = client
      .getMutationCache()
      .build(
        client,
        getEnableMCPServerMutationOptions(client, mutationMessages),
      );

    await expect(
      mutation.execute({ serverName: "semantic-scholar", enabled: true }),
    ).rejects.toThrow(detail);

    expect(mockedToastError).toHaveBeenCalledWith(
      mutationMessages.enableFailed,
    );
    expect(mockedToastError).not.toHaveBeenCalledWith(detail);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("keeps the administrator-specific message for 403 updates", async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail: "private config path" }), {
        status: 403,
      }),
    );
    const client = makeClient();
    const mutation = client
      .getMutationCache()
      .build(
        client,
        getEnableMCPServerMutationOptions(client, mutationMessages),
      );

    await expect(
      mutation.execute({ serverName: "github", enabled: true }),
    ).rejects.toBeInstanceOf(MCPConfigRequestError);

    expect(mockedToastError).toHaveBeenCalledWith(
      mutationMessages.adminRequired,
    );
    expect(mockedToastError).not.toHaveBeenCalledWith("private config path");
  });
});

describe("MCP server CRUD mutation", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedToastError.mockReset();
  });

  it.each([
    {
      variables: {
        operation: "create" as const,
        servers: { github: { enabled: true, description: "GitHub" } },
      },
      path: "/api/mcp/config/servers",
      method: "POST",
      body: {
        mcp_servers: { github: { enabled: true, description: "GitHub" } },
      },
    },
    {
      variables: {
        operation: "update" as const,
        serverName: "github",
        server: { enabled: false, description: "GitHub tools" },
      },
      path: "/api/mcp/config/server",
      method: "PUT",
      body: {
        server_name: "github",
        server: { enabled: false, description: "GitHub tools" },
      },
    },
    {
      variables: {
        operation: "delete" as const,
        serverName: "team/tools",
      },
      path: "/api/mcp/config/servers/team%2Ftools",
      method: "DELETE",
      body: undefined,
    },
  ])(
    "sends a targeted $method request and invalidates the config",
    async ({ variables, path, method, body }) => {
      mockedFetch.mockResolvedValue(
        new Response(JSON.stringify({ mcp_servers: {} }), { status: 200 }),
      );
      const client = makeClient();
      const invalidateQueries = rs
        .spyOn(client, "invalidateQueries")
        .mockResolvedValue();
      const mutation = client
        .getMutationCache()
        .build(client, getMCPServerMutationOptions(client, mutationMessages));

      await mutation.execute(variables);

      const [url, request] = mockedFetch.mock.calls[0] as [string, RequestInit];
      expect(url.endsWith(path)).toBe(true);
      expect(request.method).toBe(method);
      if (body === undefined) {
        expect(request.body).toBeUndefined();
      } else {
        expect(JSON.parse(request.body as string)).toEqual(body);
      }
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["mcpConfig"],
      });
      expect(mockedToastError).not.toHaveBeenCalled();
    },
  );

  it("keeps an empty server name addressable without a DELETE body", async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ mcp_servers: {} }), { status: 200 }),
    );
    const client = makeClient();
    rs.spyOn(client, "invalidateQueries").mockResolvedValue();
    const mutation = client
      .getMutationCache()
      .build(client, getMCPServerMutationOptions(client, mutationMessages));

    await mutation.execute({ operation: "delete", serverName: "" });

    const [url, request] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("/api/mcp/config/servers/")).toBe(true);
    expect(request.method).toBe("DELETE");
    expect(request.body).toBeUndefined();
  });

  it("keeps the Gateway rejection detail out of the create failure toast", async () => {
    const detail =
      "MCP server 'evil' uses disallowed stdio command 'bash'. Allowed commands: npx, uvx.";
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail }), { status: 400 }),
    );
    const client = makeClient();
    const invalidateQueries = rs.spyOn(client, "invalidateQueries");
    const mutation = client
      .getMutationCache()
      .build(client, getMCPServerMutationOptions(client, mutationMessages));

    await expect(
      mutation.execute({
        operation: "create",
        servers: { evil: { enabled: true, description: "" } },
      }),
    ).rejects.toThrow(detail);

    expect(mockedToastError).toHaveBeenCalledWith(mutationMessages.addFailed);
    expect(mockedToastError).not.toHaveBeenCalledWith(detail);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it.each([
    {
      operation: "update" as const,
      serverName: "github",
      server: { enabled: false, description: "" },
      expected: mutationMessages.updateFailed,
    },
    {
      operation: "delete" as const,
      serverName: "github",
      expected: mutationMessages.deleteFailed,
    },
  ])(
    "uses the operation-specific failure copy for $operation",
    async (item) => {
      mockedFetch.mockResolvedValue(
        new Response(JSON.stringify({ detail: "private gateway path" }), {
          status: 400,
        }),
      );
      const client = makeClient();
      const mutation = client
        .getMutationCache()
        .build(client, getMCPServerMutationOptions(client, mutationMessages));

      await expect(mutation.execute(item)).rejects.toBeInstanceOf(
        MCPConfigRequestError,
      );

      expect(mockedToastError).toHaveBeenCalledWith(item.expected);
      expect(mockedToastError).not.toHaveBeenCalledWith("private gateway path");
    },
  );
});
