import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

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

export function useMCPConfig() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mcpConfig"],
    queryFn: () => loadMCPConfig(),
    retry: (count, error) =>
      !(error instanceof MCPConfigRequestError) && count < 3,
  });
  return { config: data, isLoading, error };
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
