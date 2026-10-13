"use client";

import {
  DownloadIcon,
  LoaderIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  getPermissionState,
  hasPermission,
  PERMISSIONS,
} from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";
import {
  formatSkillSecurityFindings,
  MAX_SKILL_ARCHIVE_UPLOAD_BYTES,
  SkillRequestError,
} from "@/core/skills/api";
import {
  useEnableSkill,
  useSkills,
  useUploadSkillArchive,
} from "@/core/skills/hooks";
import type { Skill } from "@/core/skills/type";
import { env } from "@/env";

import { CapabilityCard, CapabilityIcon } from "./capability-card";
import { presentSkill } from "./skill-presentation";

const SkillExportDialog = dynamic(() => import("./skill-export-dialog"), {
  ssr: false,
});

export function SkillGallery({ query = "" }: { query?: string } = {}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const canReadSkills =
    getPermissionState(user, PERMISSIONS.SKILLS_READ) !== "denied";
  const { skills, hasData, isLoading, isFetching, error, refetch } =
    useSkills(canReadSkills);
  const adminRequired =
    error instanceof SkillRequestError && error.isAdminRequired;

  if (!canReadSkills) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t.agents.permissionRequired(PERMISSIONS.SKILLS_READ)}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {isLoading && !hasData ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : adminRequired ? (
        <div className="text-muted-foreground text-sm">
          {t.settings.skills.adminRequired}
        </div>
      ) : (
        <>
          {error && (
            <div
              role={hasData ? "status" : "alert"}
              className="bg-destructive/5 border-destructive/20 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm">
                {hasData
                  ? t.settings.skills.refreshFailed
                  : t.settings.skills.loadFailed}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                {isFetching && <LoaderIcon className="size-4 animate-spin" />}
                {isFetching
                  ? t.settings.skills.retrying
                  : t.settings.skills.retry}
              </Button>
            </div>
          )}
          {(hasData || !error) && <SkillList skills={skills} query={query} />}
        </>
      )}
    </div>
  );
}

function SkillList({ skills, query }: { skills: Skill[]; query: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  function sourceLabel(skill: Skill) {
    if (skill.category === "public") return t.capabilities.builtin;
    if (skill.category === "custom") return t.capabilities.custom;
    if (skill.category === "integrations")
      return t.capabilities.integrationSkills;
    return t.capabilities.sharedSkills;
  }

  const { user } = useAuth();
  const isAdmin = user?.system_role === "admin";
  // 页面先隐藏明确无权的操作；Gateway 的 skills:admin / skills:write 守卫仍是最终授权。
  const canCreateSkill = hasPermission(user, PERMISSIONS.RUNS_CREATE);
  const canManageSkillState =
    getPermissionState(user, PERMISSIONS.SKILLS_ADMIN) !== "denied";
  const canWriteSkills =
    getPermissionState(user, PERMISSIONS.SKILLS_WRITE) !== "denied";
  const canReadSkills =
    getPermissionState(user, PERMISSIONS.SKILLS_READ) !== "denied";
  const showSkillPermissionHint =
    !isAdmin || !canManageSkillState || !canWriteSkills;
  const [exportName, setExportName] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("public");
  const {
    mutate: enableSkill,
    isPending: isEnabling,
    variables: enablingSkill,
  } = useEnableSkill();
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: uploadSkillArchive, isPending: isUploading } =
    useUploadSkillArchive();
  const isArchiveUploadDisabled =
    isUploading ||
    !isAdmin ||
    !canWriteSkills ||
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true";
  const filteredSkills = useMemo(
    () =>
      skills.filter((skill) => {
        const presented = presentSkill(skill, locale);
        return (
          (filter === "all" || skill.category === filter) &&
          `${skill.name} ${skill.description} ${presented.title} ${presented.description}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        );
      }),
    [skills, filter, query, locale],
  );
  const handleCreateSkill = () => {
    if (!canCreateSkill) return;
    router.push("/workspace/chats/new?mode=skill");
  };
  const handleSkillArchive = async (event: ChangeEvent<HTMLInputElement>) => {
    if (isArchiveUploadDisabled) {
      event.target.value = "";
      return;
    }
    const archive = event.target.files?.[0];
    event.target.value = "";
    if (!archive) return;
    if (!archive.name.toLowerCase().endsWith(".skill")) {
      toast.error(t.settings.skills.invalidArchive);
      return;
    }
    if (archive.size > MAX_SKILL_ARCHIVE_UPLOAD_BYTES) {
      toast.error(t.settings.skills.archiveTooLarge);
      return;
    }

    try {
      const result = await uploadSkillArchive(archive);
      if (result.success) {
        toast.success(result.message);
        setFilter("custom");
      } else {
        toast.error(t.settings.skills.installFailed);
      }
    } catch (error) {
      if (error instanceof SkillRequestError && error.isAdminRequired) {
        toast.error(t.settings.skills.installAdminRequired);
      } else if (error instanceof SkillRequestError && error.status === 413) {
        toast.error(t.settings.skills.archiveTooLarge);
      } else if (
        error instanceof SkillRequestError &&
        error.findings.length > 0
      ) {
        toast.error(t.settings.skills.installBlocked, {
          description: (
            <span className="whitespace-pre-line">
              {formatSkillSecurityFindings(error.findings)}
            </span>
          ),
        });
      } else {
        toast.error(t.settings.skills.installFailed);
      }
    }
  };
  return (
    <div className="flex w-full flex-col gap-4">
      {showSkillPermissionHint && (
        <p role="status" className="text-muted-foreground text-sm">
          {t.settings.skills.adminRequired}
        </p>
      )}
      {!canCreateSkill && (
        <p role="status" className="text-muted-foreground text-sm">
          {t.agents.permissionRequired(PERMISSIONS.RUNS_CREATE)}
        </p>
      )}
      {exportName &&
        isAdmin &&
        env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true" && (
          <SkillExportDialog
            key={`${user.id}:${exportName}`}
            name={exportName}
            onClose={() => setExportName(null)}
          />
        )}
      <div>
        <h2 className="text-base font-semibold">
          {t.capabilities.availableSkills}
        </h2>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {t.capabilities.skillHint}
        </p>
      </div>
      <header className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="bg-muted/50 h-9 rounded-lg">
            <TabsTrigger value="public" className="rounded-md px-3 text-xs">
              {t.capabilities.builtin}
            </TabsTrigger>
            <TabsTrigger value="community" className="rounded-md px-3 text-xs">
              {t.capabilities.community}
            </TabsTrigger>
            <TabsTrigger value="custom" className="rounded-md px-3 text-xs">
              {t.capabilities.custom}
            </TabsTrigger>
            <TabsTrigger value="all" className="rounded-md px-3 text-xs">
              {t.capabilities.allSkills}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".skill"
            disabled={isArchiveUploadDisabled}
            className="sr-only"
            onChange={handleSkillArchive}
          />
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              disabled={isArchiveUploadDisabled}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : (
                <UploadIcon className="size-4" />
              )}
              {isUploading
                ? t.settings.skills.installingArchive
                : t.settings.skills.installFromFile}
            </Button>
          )}
          <Button
            size="sm"
            disabled={!canCreateSkill}
            onClick={handleCreateSkill}
          >
            <SparklesIcon className="size-4" />
            {t.settings.skills.createSkill}
          </Button>
        </div>
      </header>
      {query.trim() &&
      (filter === "community" || filteredSkills.length === 0) ? (
        <div className="text-muted-foreground py-20 text-center text-sm">
          {t.capabilities.noResults}
        </div>
      ) : filter === "community" ? (
        <Empty className="mt-5 rounded-2xl border border-dashed py-20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>{t.capabilities.communityTitle}</EmptyTitle>
            <EmptyDescription>
              {t.capabilities.communityDescription}
            </EmptyDescription>
          </EmptyHeader>
          {isAdmin && (
            <EmptyContent>
              <Button
                variant="outline"
                disabled={isArchiveUploadDisabled}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon />
                {t.settings.skills.installFromFile}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : filteredSkills.length === 0 ? (
        <EmptySkill
          onCreateSkill={handleCreateSkill}
          disabled={!canCreateSkill}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredSkills.map((skill) => {
            const presentation = presentSkill(skill, locale);
            // 技能状态共用一份服务端配置；全局互斥写入，但只在当前目标卡片上显示进度。
            const isCurrentSkillEnabling =
              isEnabling && enablingSkill?.skillName === skill.name;
            return (
              <CapabilityCard
                key={skill.name}
                name={presentation.title}
                description={presentation.description}
                label={sourceLabel(skill)}
                icon={
                  <CapabilityIcon
                    name={skill.name}
                    skill
                    icon={presentation.icon}
                  />
                }
                status={
                  isCurrentSkillEnabling ? (
                    <span role="status" className="flex items-center gap-1.5">
                      <LoaderIcon className="size-3.5 animate-spin" />
                      {t.common.loading}
                    </span>
                  ) : (
                    <>
                      <span
                        className={
                          skill.enabled
                            ? "size-1.5 rounded-full bg-emerald-500"
                            : "bg-muted-foreground/40 size-1.5 rounded-full"
                        }
                      />
                      {skill.enabled
                        ? t.capabilities.enabled
                        : t.capabilities.disabled}
                    </>
                  )
                }
                onDetails={() => setSelectedSkill(skill)}
                detailsLabel={`${t.capabilities.details} ${presentation.title}`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setSelectedSkill(skill)}
                >
                  {t.capabilities.details}
                </Button>
                <Switch
                  aria-label={presentation.title}
                  aria-busy={isCurrentSkillEnabling}
                  checked={skill.enabled}
                  disabled={
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ||
                    !isAdmin ||
                    !canManageSkillState ||
                    isEnabling
                  }
                  onCheckedChange={(enabled) => {
                    if (!isAdmin || !canManageSkillState) return;
                    enableSkill(
                      { skillName: skill.name, enabled },
                      {
                        // 服务端异常只用于诊断；界面统一显示产品文案。
                        onError: (error) =>
                          toast.error(
                            error instanceof SkillRequestError &&
                              error.isAdminRequired
                              ? t.settings.skills.adminRequired
                              : t.settings.skills.enableFailed,
                          ),
                      },
                    );
                  }}
                />
              </CapabilityCard>
            );
          })}
        </div>
      )}
      <Dialog
        open={selectedSkill !== null}
        onOpenChange={(open) => !open && setSelectedSkill(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {selectedSkill && (
            <>
              <DialogHeader>
                <CapabilityIcon
                  name={selectedSkill.name}
                  skill
                  icon={presentSkill(selectedSkill, locale).icon}
                />
                <DialogTitle className="mt-3">
                  {presentSkill(selectedSkill, locale).title}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {selectedSkill.name}
                </DialogDescription>
              </DialogHeader>
              <div className="text-muted-foreground text-sm leading-7 whitespace-pre-wrap">
                {selectedSkill.description}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <span className="text-muted-foreground text-xs">
                  {selectedSkill.license || sourceLabel(selectedSkill)}
                </span>
                <div className="flex gap-2">
                  {isAdmin &&
                    canReadSkills &&
                    selectedSkill.category === "custom" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"
                        }
                        onClick={() => {
                          setExportName(selectedSkill.name);
                          setSelectedSkill(null);
                        }}
                      >
                        <DownloadIcon className="size-4" />
                        {t.settings.skills.exportSkill}
                      </Button>
                    )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptySkill({
  onCreateSkill,
  disabled,
}: {
  onCreateSkill: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>{t.settings.skills.emptyTitle}</EmptyTitle>
        <EmptyDescription>
          {t.settings.skills.emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={disabled} onClick={onCreateSkill}>
          {t.settings.skills.emptyButton}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
