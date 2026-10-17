import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";

import {
  createMCPServers,
  deleteMCPServer,
  loadMCPConfig,
  MCPConfigRequestError,
  updateMCPServer,
  updateMCPServerState,
} from "./api";
import type { MCPServerConfig } from "./types";

export function mcpConfigQueryKey(userId: string | null | undefined) {
  // owner 位于 mcpConfig 之后；["mcpConfig"] 仍能失效全部账号。
  return ["mcpConfig", userId ?? null] as const;
}

export function isOwnerMcpConfigQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 2 段才是 owner。写入前缀 ["mcpConfig"] 不会被当成某个账号的精确缓存。
  return queryKey[0] === "mcpConfig" && queryKey[1] === userId;
}

export function useMCPConfig(enabled?: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/mcp/config 要求 mcp:admin；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.MCP_ADMIN) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !accessDenied;
  const queryKey = mcpConfigQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的 MCP 配置。调用方停用不能清空该账号缓存。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerMcpConfigQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadMCPConfig(signal),
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled,
    retry: (count, error) =>
      !(error instanceof MCPConfigRequestError) && count < 3,
  });
  const visible = callerEnabled && !accessDenied;
  return {
    config: visible ? data : undefined,
    isLoading: visible && isLoading,
    error: visible ? error : null,
  };
}

interface EnableMCPServerVariables {
  serverName: string;
  enabled: boolean;
}

type MCPMutationMessages = {
  adminRequired: string;
  enableFailed: string;
  addFailed: string;
  updateFailed: string;
  deleteFailed: string;
};

export function getEnableMCPServerMutationOptions(
  queryClient: QueryClient,
  messages: MCPMutationMessages,
) {
  return {
    mutationFn: ({ serverName, enabled }: EnableMCPServerVariables) =>
      updateMCPServerState(serverName, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcpConfig"] }),
    onError: (error: Error) => {
      console.error("Failed to update MCP server state:", error);
      toast.error(
        error instanceof MCPConfigRequestError && error.isAdminRequired
          ? messages.adminRequired
          : messages.enableFailed,
      );
    },
  };
}

export function useEnableMCPServer() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation(
    getEnableMCPServerMutationOptions(queryClient, t.settings.tools),
  );
}

export type MCPServerMutationVariables =
  | {
      operation: "create";
      servers: Record<string, MCPServerConfig>;
    }
  | {
      operation: "update";
      serverName: string;
      server: MCPServerConfig;
    }
  | {
      operation: "delete";
      serverName: string;
    };

export function getMCPServerMutationOptions(
  queryClient: QueryClient,
  messages: MCPMutationMessages,
) {
  return {
    mutationFn: (variables: MCPServerMutationVariables) => {
      switch (variables.operation) {
        case "create":
          return createMCPServers(variables.servers);
        case "update":
          return updateMCPServer(variables.serverName, variables.server);
        case "delete":
          return deleteMCPServer(variables.serverName);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcpConfig"] }),
    onError: (error: Error, variables: MCPServerMutationVariables) => {
      console.error("Failed to mutate MCP server configuration:", error);
      const fallback =
        variables.operation === "create"
          ? messages.addFailed
          : variables.operation === "update"
            ? messages.updateFailed
            : messages.deleteFailed;
      toast.error(
        error instanceof MCPConfigRequestError && error.isAdminRequired
          ? messages.adminRequired
          : fallback,
      );
    },
  };
}

export function useMCPServerMutation() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  return useMutation(
    getMCPServerMutationOptions(queryClient, t.settings.tools),
  );
}
