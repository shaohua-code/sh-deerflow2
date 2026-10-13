import { toast } from "sonner";

type SidecarFailureAction = "send" | "delete";

const diagnosticLabels: Record<SidecarFailureAction, string> = {
  send: "Failed to send sidecar message:",
  delete: "Failed to delete sidecar thread:",
};

/**
 * Sidecar API failures can contain Gateway diagnostics. Keep the original
 * exception in the developer console while presenting only localized product
 * copy to the user.
 */
export function reportSidecarFailure(
  action: SidecarFailureAction,
  error: unknown,
  localizedMessage: string,
) {
  console.error(diagnosticLabels[action], error);
  toast.error(localizedMessage);
}
