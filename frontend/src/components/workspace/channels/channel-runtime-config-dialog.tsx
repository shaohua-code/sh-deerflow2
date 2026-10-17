"use client";

import { LoaderCircleIcon } from "lucide-react";
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SettingsUnsavedChangesHandler } from "@/components/workspace/settings/settings-unsaved-changes";
import type {
  ChannelProvider,
  ChannelRuntimeConfigValues,
} from "@/core/channels/types";
import { useI18n } from "@/core/i18n/hooks";

type ChannelRuntimeConfigDialogProps = {
  provider: ChannelProvider | null;
  open: boolean;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    provider: ChannelProvider,
    values: ChannelRuntimeConfigValues,
  ) => void;
  onUnsavedChangesChange?: SettingsUnsavedChangesHandler;
};

type SecretInputStyle = CSSProperties & {
  WebkitTextSecurity?: "disc";
};

const SECRET_INPUT_STYLE: SecretInputStyle = {
  WebkitTextSecurity: "disc",
};

export function ChannelRuntimeConfigDialog({
  provider,
  open,
  submitting,
  onOpenChange,
  onSubmit,
  onUnsavedChangesChange,
}: ChannelRuntimeConfigDialogProps) {
  // 关闭时卸载编辑器；每次重新打开都从最新服务端快照创建独立凭据会话。
  if (!provider || !open) return null;

  return (
    <ChannelRuntimeConfigEditor
      key={provider.provider}
      provider={provider}
      submitting={submitting}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      onUnsavedChangesChange={onUnsavedChangesChange}
    />
  );
}

function ChannelRuntimeConfigEditor({
  provider,
  submitting,
  onOpenChange,
  onSubmit,
  onUnsavedChangesChange,
}: Omit<ChannelRuntimeConfigDialogProps, "provider" | "open"> & {
  provider: ChannelProvider;
}) {
  const { t } = useI18n();
  const fields = provider.credential_fields ?? [];
  const [initialValues] = useState<ChannelRuntimeConfigValues>(
    () =>
      Object.fromEntries(
        fields.map((field) => [
          field.name,
          provider.credential_values?.[field.name] ?? "",
        ]),
      ) as ChannelRuntimeConfigValues,
  );
  const [values, setValues] =
    useState<ChannelRuntimeConfigValues>(initialValues);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const hasUnsavedChanges = fields.some(
    (field) => (values[field.name] ?? "") !== (initialValues[field.name] ?? ""),
  );

  const isEditing = provider.configured;

  const requestClose = () => {
    if (submitting) return;
    if (hasUnsavedChanges) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  // 放弃动作只把草稿重置为服务端快照，不关闭弹窗；
  // 设置弹窗切栏时会先调用它再卸载本页。
  const discardDraft = () => {
    setValues(initialValues);
  };

  // 向设置弹窗登记当前草稿状态；pending 时由设置弹窗阻止切换与关闭。
  useEffect(() => {
    if (!onUnsavedChangesChange) return;
    onUnsavedChangesChange(
      hasUnsavedChanges
        ? { isPending: submitting, discard: discardDraft }
        : null,
    );
    return () => onUnsavedChangesChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges, onUnsavedChangesChange, submitting]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(provider, values);
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(nextOpen) => {
          if (!nextOpen) requestClose();
        }}
      >
        <DialogContent
          showCloseButton={!submitting}
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (submitting) event.preventDefault();
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {isEditing
                  ? t.channels.setupEditTitle(provider.display_name)
                  : t.channels.setupTitle(provider.display_name)}
              </DialogTitle>
              <DialogDescription>
                {t.channels.setupDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {fields.map((field) => {
                const inputId = `channel-${provider.provider}-${field.name}`;
                const isSecretField = field.type === "password";
                return (
                  <div key={field.name} className="space-y-1.5">
                    <label
                      htmlFor={inputId}
                      className="text-sm leading-none font-medium"
                    >
                      {field.label}
                    </label>
                    <Input
                      id={inputId}
                      type="text"
                      value={values[field.name] ?? ""}
                      disabled={submitting}
                      required={field.required}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-1p-ignore={isSecretField ? "true" : undefined}
                      data-bwignore={isSecretField ? "true" : undefined}
                      data-form-type={isSecretField ? "other" : undefined}
                      data-lpignore={isSecretField ? "true" : undefined}
                      style={isSecretField ? SECRET_INPUT_STYLE : undefined}
                      onChange={(event) => {
                        setValues((current) => ({
                          ...current,
                          [field.name]: event.target.value,
                        }));
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {hasUnsavedChanges && !submitting ? (
              <p role="status" className="text-muted-foreground text-sm">
                {t.channels.unsavedRuntimeConfig}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={requestClose}
              >
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={submitting || !hasUnsavedChanges}>
                {submitting ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : null}
                {isEditing ? t.channels.saveChanges : t.channels.saveAndConnect}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmingDiscard}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmingDiscard(false);
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingDiscard(false)}
            >
              {t.settings.keepEditing}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => onOpenChange(false)}
            >
              {t.settings.discardChanges}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
