"use client";

import { BlocksIcon, SearchIcon, SparklesIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/core/i18n/hooks";
import { WorkspaceSidebarTrigger } from "@/product/workspace-sidebar-trigger";

const PluginGallery = dynamic(
  () => import("./plugin-gallery").then((module) => module.PluginGallery),
  { loading: CapabilityGalleryLoading },
);
const SkillGallery = dynamic(
  () => import("./skill-gallery").then((module) => module.SkillGallery),
  { loading: CapabilityGalleryLoading },
);

function CapabilityGallerySkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-9 w-56 rounded-lg" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-52 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function CapabilityGalleryLoading() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-label={t.common.loading}
      aria-busy="true"
      aria-live="polite"
    >
      <CapabilityGallerySkeleton />
    </div>
  );
}

export function CapabilityCenterLoading() {
  const { t } = useI18n();
  return (
    <div
      className="bg-background flex h-full min-h-0 flex-col"
      role="status"
      aria-label={t.common.loading}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="text-muted-foreground flex h-14 shrink-0 items-center gap-3 border-b px-4 text-xs md:px-8">
        <WorkspaceSidebarTrigger className="md:hidden" />
        <span>{t.breadcrumb.workspace}</span>
        <span className="opacity-40">/</span>
        <span className="text-foreground">{t.capabilities.title}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <div className="space-y-3">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <Skeleton className="h-10 w-full rounded-xl md:w-72" />
          </div>
          <Skeleton className="mb-7 h-12 w-52" />
          <CapabilityGallerySkeleton />
        </div>
      </div>
    </div>
  );
}

export function CapabilityCenter() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") === "skills" ? "skills" : "plugins";
  const [query, setQuery] = useState("");
  function changeTab(value: string) {
    setQuery("");
    router.replace(`${pathname}?tab=${value}`, { scroll: false });
  }
  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="text-muted-foreground flex h-14 shrink-0 items-center gap-3 border-b px-4 text-xs md:px-8">
        <WorkspaceSidebarTrigger className="md:hidden" />
        <span>{t.breadcrumb.workspace}</span>
        <span className="opacity-40">/</span>
        <span className="text-foreground">{t.capabilities.title}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-10">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-[28px] font-semibold tracking-tight">
                {t.capabilities.title}
              </h1>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {t.capabilities.description}
              </p>
            </div>
            <div className="relative w-full md:w-72">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-3 left-3 size-4" />
              <Input
                className="bg-muted/30 h-10 rounded-xl pl-9 shadow-none"
                aria-label={
                  tab === "plugins"
                    ? t.capabilities.searchPlugins
                    : t.capabilities.searchSkills
                }
                placeholder={
                  tab === "plugins"
                    ? t.capabilities.searchPlugins
                    : t.capabilities.searchSkills
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </header>
          <Tabs value={tab} onValueChange={changeTab} className="mb-7 border-b">
            <TabsList variant="line" className="h-12 gap-7">
              <TabsTrigger value="plugins" className="gap-2 px-1 pb-4 text-sm">
                <BlocksIcon className="size-4" />
                {t.capabilities.plugins}
              </TabsTrigger>
              <TabsTrigger value="skills" className="gap-2 px-1 pb-4 text-sm">
                <SparklesIcon className="size-4" />
                {t.capabilities.skills}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === "plugins" ? (
            <PluginGallery query={query} />
          ) : (
            <SkillGallery query={query} />
          )}
        </div>
      </div>
    </div>
  );
}
