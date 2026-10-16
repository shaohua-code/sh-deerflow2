import { useRef } from "react";
import { toast } from "sonner";

import { useAuth } from "@/core/auth/AuthProvider";
import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";
import { useI18n } from "@/core/i18n/hooks";
import { useArchiveThread } from "@/core/threads/archive";

export function useThreadArchiveAction() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canWriteThreads = hasPermission(user, PERMISSIONS.THREADS_WRITE);
  // Toast 的“撤销归档”可能在显示后才点击，使用最新授权快照避免旧闭包绕过撤权。
  const canWriteThreadsRef = useRef(canWriteThreads);
  canWriteThreadsRef.current = canWriteThreads;
  const mutation = useArchiveThread({
    onSuccess(_data, { threadId, archived }) {
      if (archived) {
        toast.success(t.chats.archiveSuccess, {
          description: t.chats.archiveDescription,
          action: {
            label: t.chats.undoArchive,
            onClick: () => setArchived(threadId, false),
          },
        });
      } else {
        toast.success(t.chats.restoreSuccess);
      }
    },
    onError() {
      toast.error(t.chats.archiveFailed);
    },
  });

  function setArchived(threadId: string, archived: boolean) {
    // 归档和恢复都会 PATCH 会话元数据，需与 Gateway threads:write 路由守卫一致。
    if (!canWriteThreadsRef.current) {
      toast.error(t.chats.writePermissionRequired);
      return;
    }
    mutation.mutate({ threadId, archived });
  }

  return { setArchived, isPending: mutation.isPending, canWriteThreads };
}
