"use client";

import { Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

function WelcomeDescription({ children }: { children: string }) {
  return (
    <p className="text-muted-foreground max-w-2xl text-sm leading-6 text-pretty sm:text-base sm:leading-7">
      {children}
    </p>
  );
}

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isSkillMode = searchParams.get("mode") === "skill";

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 py-5 text-center sm:px-8 sm:py-7",
        className,
      )}
    >
      <div className="border-primary/15 bg-primary/[0.06] text-primary inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold">
        <Sparkles className="size-3.5" />
        {isSkillMode
          ? t.welcome.createYourOwnSkill
          : mode === "ultra"
            ? "Ultra"
            : t.welcome.workspaceLabel}
      </div>
      <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-[-0.045em] text-balance sm:text-4xl lg:text-[2.75rem]">
        {isSkillMode ? t.welcome.createYourOwnSkill : t.welcome.greeting}
      </h1>
      <WelcomeDescription>
        {isSkillMode
          ? t.welcome.createYourOwnSkillDescription
          : t.welcome.description}
      </WelcomeDescription>
    </div>
  );
}
