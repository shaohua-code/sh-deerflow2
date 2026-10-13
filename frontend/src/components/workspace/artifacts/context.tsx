import { usePathname } from "next/navigation";
import {
  createContext,
  type Dispatch,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useSidebar } from "@/components/ui/sidebar";
import type { ArtifactDraftState } from "@/core/artifacts/editing";
import { useAuth } from "@/core/auth/AuthProvider";
import { env } from "@/env";

export interface ArtifactsContextType {
  artifacts: string[];
  setArtifacts: (artifacts: string[]) => void;

  selectedArtifact: string | null;
  autoSelect: boolean;
  select: (artifact: string, autoSelect?: boolean) => void;
  deselect: () => void;

  open: boolean;
  autoOpen: boolean;
  setOpen: (open: boolean) => void;

  drafts: Record<string, ArtifactDraftState>;
  setDrafts: Dispatch<SetStateAction<Record<string, ArtifactDraftState>>>;
  editingPath: string | null;
  setEditingPath: Dispatch<SetStateAction<string | null>>;
}

const ArtifactsContext = createContext<ArtifactsContextType | undefined>(
  undefined,
);

const ARTIFACTS_STORAGE_PREFIX = "deerflow:artifacts:v2";

type PersistedArtifactsState = {
  artifacts: string[];
  selectedArtifact: string | null;
  open: boolean;
};

function storageKey(userId: string, pathname: string) {
  return `${ARTIFACTS_STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(pathname)}`;
}

function readPersistedState(key: string): PersistedArtifactsState | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedArtifactsState>;
    if (
      !Array.isArray(parsed.artifacts) ||
      !parsed.artifacts.every((artifact) => typeof artifact === "string") ||
      !(
        parsed.selectedArtifact === null ||
        typeof parsed.selectedArtifact === "string"
      ) ||
      typeof parsed.open !== "boolean"
    ) {
      return null;
    }
    return {
      artifacts: parsed.artifacts,
      selectedArtifact: parsed.selectedArtifact,
      open: parsed.open,
    };
  } catch {
    return null;
  }
}

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const { user } = useAuth();
  const ownerId = user?.id ?? "anonymous";
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [autoSelect, setAutoSelect] = useState(true);
  const [open, setOpen] = useState(
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true",
  );
  const [autoOpen, setAutoOpen] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, ArtifactDraftState>>({});
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const { setOpen: setSidebarOpen } = useSidebar();
  const pathname = usePathname();
  const currentStorageKey = pathname ? storageKey(ownerId, pathname) : null;
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!currentStorageKey) {
      return;
    }

    // v1 只按 URL 存储，没有账号归属；私有产物路径不能安全迁移给当前用户。
    // 旧键原样保留，新状态只从带 owner 的 v2 键读取。
    const persisted = readPersistedState(currentStorageKey);
    setArtifacts(persisted?.artifacts ?? []);
    setSelectedArtifact(persisted?.selectedArtifact ?? null);
    setOpen(persisted?.open ?? env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true");
    setAutoOpen(true);
    setAutoSelect(!persisted?.selectedArtifact);
    setDrafts({});
    setEditingPath(null);
    setHydratedStorageKey(currentStorageKey);
  }, [currentStorageKey]);

  useEffect(() => {
    const hasUnsavedDrafts = Object.values(drafts).some(
      (draft) => draft.draftContent !== draft.baselineContent,
    );
    if (!hasUnsavedDrafts) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [drafts]);

  useEffect(() => {
    if (!currentStorageKey || hydratedStorageKey !== currentStorageKey) {
      return;
    }
    try {
      window.sessionStorage.setItem(
        currentStorageKey,
        JSON.stringify({ artifacts, selectedArtifact, open }),
      );
    } catch {
      // Browser storage can be disabled or full; panel state must keep working.
    }
  }, [
    artifacts,
    currentStorageKey,
    hydratedStorageKey,
    open,
    selectedArtifact,
  ]);

  const select = useCallback(
    (artifact: string, autoSelect = false) => {
      setSelectedArtifact(artifact);
      if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true") {
        setSidebarOpen(false);
      }
      if (!autoSelect) {
        setAutoSelect(false);
      }
    },
    [setSidebarOpen, setSelectedArtifact, setAutoSelect],
  );

  const deselect = useCallback(() => {
    setSelectedArtifact(null);
    setAutoSelect(true);
    setOpen(false);
  }, []);

  const value: ArtifactsContextType = {
    artifacts,
    setArtifacts,

    open,
    autoOpen,
    autoSelect,
    setOpen: (isOpen: boolean) => {
      if (!isOpen && autoOpen) {
        setAutoOpen(false);
        setAutoSelect(false);
      }
      setOpen(isOpen);
    },

    selectedArtifact,
    select,
    deselect,

    drafts,
    setDrafts,
    editingPath,
    setEditingPath,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}

export function useArtifacts() {
  const context = useContext(ArtifactsContext);
  if (context === undefined) {
    throw new Error("useArtifacts must be used within an ArtifactsProvider");
  }
  return context;
}
