"use client";

import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { AgentsFeatureDisabled } from "@/components/workspace/agents/agents-feature-disabled";
import { useAgentsApiEnabled } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

export default function AgentsLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { enabled, isLoading, isError, isFetching, refetch } =
    useAgentsApiEnabled();

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
        {t.common.loading}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <div className="bg-destructive/10 flex size-14 items-center justify-center rounded-full">
          <AlertCircleIcon className="text-destructive size-7" />
        </div>
        <div>
          <p className="font-medium">{t.agents.featureCheckFailed}</p>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            {t.agents.featureCheckFailedHint}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCwIcon
            className={`mr-1.5 size-4 ${isFetching ? "animate-spin" : ""}`}
          />
          {isFetching ? t.agents.retrying : t.agents.retry}
        </Button>
      </div>
    );
  }

  if (!enabled) {
    return <AgentsFeatureDisabled />;
  }

  return <>{children}</>;
}
