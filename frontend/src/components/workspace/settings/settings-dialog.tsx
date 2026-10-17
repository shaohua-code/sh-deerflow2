"use client";

import {
  BellIcon,
  CableIcon,
  InfoIcon,
  BrainIcon,
  PaletteIcon,
  UsersRoundIcon,
  UserIcon,
  SlidersHorizontalIcon,
  ShieldCheckIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { useProductFeature } from "@/product/hooks";

import type {
  SettingsUnsavedChanges,
  SettingsUnsavedChangesHandler,
} from "./settings-unsaved-changes";

function SettingsPageLoading() {
  const { t } = useI18n();
  return (
    <p role="status" className="text-muted-foreground py-8 text-center text-sm">
      {t.settings.loading}
    </p>
  );
}

const AccountSettingsPage = dynamic(
  () =>
    import("./account-settings-page").then(
      (module) => module.AccountSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const AppearanceSettingsPage = dynamic(
  () =>
    import("./appearance-settings-page").then(
      (module) => module.AppearanceSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const ChannelsSettingsPage = dynamic(
  () =>
    import("./channels-settings-page").then(
      (module) => module.ChannelsSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const MemorySettingsPage = dynamic(
  () =>
    import("./memory-settings-page").then(
      (module) => module.MemorySettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const NotificationSettingsPage = dynamic(
  () =>
    import("./notification-settings-page").then(
      (module) => module.NotificationSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const SubagentSettingsPage = dynamic(
  () =>
    import("./subagent-settings-page").then(
      (module) => module.SubagentSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const AboutSettingsPage = dynamic(
  () =>
    import("./about-settings-page").then((module) => module.AboutSettingsPage),
  { loading: SettingsPageLoading },
);
const ProductPreferencesPage = dynamic(
  () =>
    import("./product-preferences-page").then(
      (module) => module.ProductPreferencesPage,
    ),
  { loading: SettingsPageLoading },
);
const ProductAdminPage = dynamic(
  () =>
    import("./product-admin-page").then((module) => module.ProductAdminPage),
  { loading: SettingsPageLoading },
);

export type SettingsSection =
  | "account"
  | "appearance"
  | "channels"
  | "memory"
  | "subagents"
  | "notification"
  | "product"
  | "administration"
  | "about";

type SettingsDialogProps = React.ComponentProps<typeof Dialog> & {
  defaultSection?: SettingsSection;
  onSectionRequestRejected?: (section: SettingsSection) => void;
};

export function SettingsDialog(props: SettingsDialogProps) {
  const {
    defaultSection = "appearance",
    onSectionRequestRejected,
    ...dialogProps
  } = props;
  // Radix 的 onOpenChange 是方法简写签名；解构会触发 unbound-method，
  // 用本地箭头函数固定调用形态（props 未传时为 no-op，行为不变）。
  const onOpenChange = (open: boolean) => props.onOpenChange?.(open);
  const { t } = useI18n();
  const { user } = useAuth();
  const unsavedChangesRef = useRef<SettingsUnsavedChanges | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const administrationEnabled = useProductFeature("administration");
  const canSeeProductAdmin =
    administrationEnabled && user?.system_role === "admin";
  const handleUnsavedChanges = useCallback<SettingsUnsavedChangesHandler>(
    (changes) => {
      unsavedChangesRef.current = changes;
    },
    [],
  );
  const getUnsavedChanges = useCallback(() => unsavedChangesRef.current, []);

  function requestDialogClose() {
    const changes = getUnsavedChanges();
    if (changes?.isPending) return;
    if (changes) {
      setConfirmingClose(true);
      return;
    }
    onOpenChange(false);
  }

  function discardAndClose() {
    const changes = getUnsavedChanges();
    if (changes?.isPending) return;
    changes?.discard();
    handleUnsavedChanges(null);
    setConfirmingClose(false);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog
        {...dialogProps}
        onOpenChange={(open) => {
          if (open) onOpenChange(true);
          else requestDialogClose();
        }}
      >
        <DialogContent
          className="flex h-[75vh] max-h-[calc(100vh-2rem)] flex-col sm:max-w-5xl md:max-w-6xl"
          aria-describedby={undefined}
        >
          <DialogHeader className="gap-1">
            <DialogTitle>{t.settings.title}</DialogTitle>
            <p className="text-muted-foreground text-sm">
              {t.settings.description}
            </p>
          </DialogHeader>
          <SettingsDialogBody
            defaultSection={defaultSection}
            canSeeProductAdmin={canSeeProductAdmin}
            getUnsavedChanges={getUnsavedChanges}
            onUnsavedChangesChange={handleUnsavedChanges}
            onSectionRequestRejected={onSectionRequestRejected}
          />
        </DialogContent>
      </Dialog>
      <SettingsDiscardChangesDialog
        open={confirmingClose}
        onKeepEditing={() => setConfirmingClose(false)}
        onDiscard={discardAndClose}
      />
    </>
  );
}

function SettingsDialogBody({
  defaultSection,
  canSeeProductAdmin,
  getUnsavedChanges,
  onUnsavedChangesChange,
  onSectionRequestRejected,
}: {
  defaultSection: SettingsSection;
  canSeeProductAdmin: boolean;
  getUnsavedChanges: () => SettingsUnsavedChanges | null;
  onUnsavedChangesChange: SettingsUnsavedChangesHandler;
  onSectionRequestRejected?: (section: SettingsSection) => void;
}) {
  const { t } = useI18n();
  const safeDefaultSection =
    defaultSection === "administration" && !canSeeProductAdmin
      ? "account"
      : defaultSection;
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(safeDefaultSection);
  const previousDefaultSection = useRef(safeDefaultSection);
  const [pendingSection, setPendingSection] = useState<SettingsSection | null>(
    null,
  );
  const sections = useMemo(() => {
    const items = [
      {
        id: "account",
        label: t.settings.sections.account,
        icon: UserIcon,
      },
      {
        id: "appearance",
        label: t.settings.sections.appearance,
        icon: PaletteIcon,
      },
      {
        id: "product",
        label: t.settings.sections.product,
        icon: SlidersHorizontalIcon,
      },
      {
        id: "notification",
        label: t.settings.sections.notification,
        icon: BellIcon,
      },
      {
        id: "channels",
        label: t.settings.sections.channels,
        icon: CableIcon,
      },
      {
        id: "memory",
        label: t.settings.sections.memory,
        icon: BrainIcon,
      },
      {
        id: "subagents",
        label: t.settings.sections.subagents,
        icon: UsersRoundIcon,
      },
      { id: "about", label: t.settings.sections.about, icon: InfoIcon },
    ];
    if (canSeeProductAdmin) {
      items.splice(items.length - 1, 0, {
        id: "administration",
        label: t.settings.sections.administration,
        icon: ShieldCheckIcon,
      });
    }
    return items;
  }, [
    t.settings.sections.account,
    t.settings.sections.appearance,
    t.settings.sections.product,
    t.settings.sections.channels,
    t.settings.sections.memory,
    t.settings.sections.subagents,
    t.settings.sections.notification,
    t.settings.sections.about,
    t.settings.sections.administration,
    canSeeProductAdmin,
  ]);

  const requestSectionChange = useCallback(
    (nextSection: SettingsSection) => {
      const targetSection =
        nextSection === "administration" && !canSeeProductAdmin
          ? "account"
          : nextSection;
      if (targetSection === activeSection) return;
      const changes = getUnsavedChanges();
      if (changes?.isPending) {
        // A save cannot be cancelled; put external entry state back so a later
        // click remains a fresh navigation request after the mutation settles.
        onSectionRequestRejected?.(activeSection);
        return;
      }
      if (changes) {
        setPendingSection(targetSection);
        return;
      }
      setActiveSection(targetSection);
    },
    [
      activeSection,
      canSeeProductAdmin,
      getUnsavedChanges,
      onSectionRequestRejected,
    ],
  );

  // 外部菜单/深链更新 defaultSection 时也经过草稿保护，不能通过重挂载绕过确认。
  useEffect(() => {
    if (previousDefaultSection.current === safeDefaultSection) return;
    previousDefaultSection.current = safeDefaultSection;
    requestSectionChange(safeDefaultSection);
  }, [requestSectionChange, safeDefaultSection]);

  // 管理员权限被撤销后，立刻卸载管理员内容并返回可访问的设置页。
  useEffect(() => {
    if (canSeeProductAdmin || activeSection !== "administration") return;
    onUnsavedChangesChange(null);
    setPendingSection(null);
    setActiveSection(
      safeDefaultSection === "administration" ? "account" : safeDefaultSection,
    );
  }, [
    activeSection,
    canSeeProductAdmin,
    onUnsavedChangesChange,
    safeDefaultSection,
  ]);

  function discardAndChangeSection() {
    const changes = getUnsavedChanges();
    if (changes?.isPending) return;
    changes?.discard();
    onUnsavedChangesChange(null);
    const nextSection = pendingSection;
    setPendingSection(null);
    if (nextSection) setActiveSection(nextSection);
  }

  function keepCurrentSection() {
    setPendingSection(null);
    onSectionRequestRejected?.(activeSection);
  }

  return (
    <>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:gap-4">
        {/* 手机端用单行下拉导航，把有限高度留给正在编辑的设置内容。 */}
        <select
          aria-label={t.settings.title}
          className="border-input bg-background focus-visible:ring-ring h-10 w-full min-w-0 rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:hidden"
          onChange={(event) =>
            requestSectionChange(event.currentTarget.value as SettingsSection)
          }
          value={activeSection}
        >
          {sections.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <nav className="bg-sidebar hidden w-full min-w-0 rounded-lg border p-2 md:block md:min-h-0 md:overflow-y-auto">
          <ul className="space-y-1 md:pr-1">
            {sections.map(({ id, label, icon: Icon }) => {
              const active = activeSection === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    onClick={() => requestSectionChange(id as SettingsSection)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors md:gap-3 md:px-3",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <ScrollArea className="h-full min-h-0 min-w-0 rounded-lg border">
          <div className="space-y-8 p-4 sm:p-6">
            {activeSection === "account" && (
              <AccountSettingsPage
                onUnsavedChangesChange={onUnsavedChangesChange}
              />
            )}
            {activeSection === "appearance" && <AppearanceSettingsPage />}
            {activeSection === "product" && (
              <ProductPreferencesPage
                onUnsavedChangesChange={onUnsavedChangesChange}
              />
            )}
            {activeSection === "administration" && canSeeProductAdmin && (
              <ProductAdminPage
                onUnsavedChangesChange={onUnsavedChangesChange}
              />
            )}
            {activeSection === "memory" && <MemorySettingsPage />}
            {activeSection === "subagents" && <SubagentSettingsPage />}
            {activeSection === "notification" && <NotificationSettingsPage />}
            {activeSection === "channels" && (
              <ChannelsSettingsPage
                onUnsavedChangesChange={onUnsavedChangesChange}
              />
            )}
            {activeSection === "about" && <AboutSettingsPage />}
          </div>
        </ScrollArea>
      </div>
      <SettingsDiscardChangesDialog
        open={pendingSection !== null}
        onKeepEditing={keepCurrentSection}
        onDiscard={discardAndChangeSection}
      />
    </>
  );
}

function SettingsDiscardChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
}: {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onKeepEditing();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.settings.unsavedChangesTitle}</DialogTitle>
          <DialogDescription>
            {t.settings.unsavedChangesDescription}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onKeepEditing}>
            {t.settings.keepEditing}
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            {t.settings.discardChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
