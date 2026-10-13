import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  artifactContent: {
    content: undefined as string | undefined,
    url: undefined as string | undefined,
    sha256: undefined as string | undefined,
    truncated: false,
    previewBytes: undefined as number | undefined,
    totalBytes: undefined as number | undefined,
    fullContentRequested: false,
    loadFullContent: rs.fn(),
    isLoading: false,
    error: undefined as unknown,
  },
  artifacts: {
    artifacts: [] as string[],
    setArtifacts: rs.fn(),
    selectedArtifact: null as string | null,
    autoSelect: false,
    select: rs.fn(),
    deselect: rs.fn(),
    open: true,
    autoOpen: false,
    setOpen: rs.fn(),
    drafts: {} as Record<
      string,
      {
        filepath: string;
        baselineContent: string;
        baselineSha256: string | null;
        draftContent: string;
        conflict: boolean;
      }
    >,
    setDrafts: rs.fn(),
    editingPath: null as string | null,
    setEditingPath: rs.fn(),
  },
  fetch: rs.fn(),
  installSkill: rs.fn(),
  user: null as { system_role: string } | null,
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
}));

rs.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));

rs.mock("@/core/artifacts/hooks", () => ({
  useArtifactContent: () => mocks.artifactContent,
}));

rs.mock("@/components/workspace/messages/context", () => ({
  useThread: () => ({ thread: { isLoading: false }, isMock: false }),
}));

rs.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: () => mocks.artifacts,
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
rs.mock("@/core/skills/api", () => ({
  installSkill: mocks.installSkill,
  SkillRequestError: class SkillRequestError extends Error {
    readonly isAdminRequired = false;
  },
}));

// The real editor pulls CodeMirror into the worker bundle; these tests only
// exercise the browser-preview iframe branch, which never mounts it.
rs.mock("@/components/workspace/code-editor", () => ({
  CodeEditor: () => null,
}));

rs.mock("@/core/config", () => ({
  getBackendBaseURL: () => "/backend",
}));

rs.mock("@/env", () => ({
  env: { NEXT_PUBLIC_STATIC_WEBSITE_ONLY: "false" },
}));

import { ArtifactFileDetail } from "@/components/workspace/artifacts/artifact-file-detail";
import { I18nProvider } from "@/core/i18n/context";

const THREAD_ID = "7cfa5f8f-a2f8-47ad-acbd-da7137baf990";
const REPORT_PATH = "/mnt/user-data/outputs/report.md";
const SUMMARY_PATH = "/mnt/user-data/outputs/summary.md";
const CONTENT_SHA256 = "a".repeat(64);

function Wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en-US">{children}</I18nProvider>
    </QueryClientProvider>
  );
}

function renderDetail(filepath: string) {
  return render(
    <Wrapper>
      <ArtifactFileDetail filepath={filepath} threadId={THREAD_ID} />
    </Wrapper>,
  );
}

function seedDirtyDraft(filepath = REPORT_PATH) {
  mocks.artifacts.editingPath = filepath;
  mocks.artifacts.drafts[filepath] = {
    filepath,
    baselineContent: "saved version",
    baselineSha256: CONTENT_SHA256,
    draftContent: "unsaved version",
    conflict: false,
  };
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.installSkill.mockReset();
  mocks.user = null;
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.artifactContent.content = undefined;
  mocks.artifactContent.sha256 = "a".repeat(64);
  mocks.artifacts.artifacts = [];
  mocks.artifacts.drafts = {};
  mocks.artifacts.editingPath = null;
});

afterEach(() => {
  cleanup();
  rs.clearAllMocks();
});

describe("ArtifactFileDetail browser-preview iframe", () => {
  it("names the artifact file selector", () => {
    renderDetail("/mnt/user-data/outputs/report.pdf");

    expect(
      screen.getByRole("combobox", { name: "Select an artifact file" }),
    ).toBeTruthy();
  });

  it("renders a PDF in an iframe WITHOUT the sandbox attribute", () => {
    // Chromium blocks its built-in PDF viewer inside sandbox=""; the bytes
    // are safe inline because the endpoint declares application/pdf with
    // X-Content-Type-Options: nosniff.
    const { container } = renderDetail("/mnt/user-data/outputs/report.pdf");
    const frame = container.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement)) {
      throw new Error("preview iframe not rendered");
    }
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(frame.getAttribute("src")).toBe(
      `/backend/api/threads/${THREAD_ID}/artifacts/mnt/user-data/outputs/report.pdf`,
    );
    // Untitled frames have no accessible name (the sibling preview iframe
    // keeps "Artifact preview"); dropping this regressed WCAG frame titles.
    expect(frame.getAttribute("title")).toBe("report.pdf");
  });

  it("keeps the empty sandbox for images and other passive binaries", () => {
    const { container } = renderDetail("/mnt/user-data/outputs/chart.png");
    const frame = container.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement)) {
      throw new Error("preview iframe not rendered");
    }
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("src")).toBe(
      `/backend/api/threads/${THREAD_ID}/artifacts/mnt/user-data/outputs/chart.png`,
    );
  });

  it("renders HTML with srcDoc inside the existing restricted sandbox", () => {
    mocks.artifactContent.content =
      "<!doctype html><html><head><title>Report</title></head><body><img src='chart.png'></body></html>";
    mocks.artifactContent.url = `/backend/api/threads/${THREAD_ID}/artifacts/mnt/user-data/outputs/report.html`;

    const { container } = renderDetail("/mnt/user-data/outputs/report.html");
    const frame = container.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement)) {
      throw new Error("preview iframe not rendered");
    }

    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(frame.getAttribute("src")).toBeNull();
    expect(frame.getAttribute("srcdoc")).toContain(
      '<base href="http://localhost:3000/backend/api/threads/',
    );
    expect(frame.getAttribute("srcdoc")).toContain(
      "<script data-deerflow-artifact-scroll-restoration>",
    );
    expect(frame.getAttribute("srcdoc")).toContain("<title>Report</title>");
  });
});

describe("ArtifactFileDetail skill installation", () => {
  it("shows safe localized feedback when installing a skill archive fails", async () => {
    mocks.user = { system_role: "admin" };
    mocks.installSkill.mockResolvedValue({
      success: false,
      message: "private gateway path",
    });
    renderDetail("/mnt/user-data/outputs/demo.skill");

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to install the skill archive.",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith("private gateway path");
  });
});

describe("ArtifactFileDetail unsaved changes", () => {
  it("asks before discarding and keeps the draft when cancelled", () => {
    seedDirtyDraft();
    renderDetail(REPORT_PATH);

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByRole("dialog").textContent).toContain(
      "Discard the unsaved changes to this artifact?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.artifacts.setDrafts).not.toHaveBeenCalled();
    expect(mocks.artifacts.setEditingPath).not.toHaveBeenCalled();
  });

  it("discards the draft only after explicit confirmation", () => {
    seedDirtyDraft();
    renderDetail(REPORT_PATH);

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(mocks.artifacts.setDrafts).toHaveBeenCalledTimes(1);
    expect(mocks.artifacts.setEditingPath).toHaveBeenCalledWith(null);
  });

  it("closes the panel and clears drafts only after confirmation", () => {
    seedDirtyDraft();
    renderDetail(REPORT_PATH);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(mocks.artifacts.setDrafts).toHaveBeenCalledWith({});
    expect(mocks.artifacts.setEditingPath).toHaveBeenCalledWith(null);
    expect(mocks.artifacts.setOpen).toHaveBeenCalledWith(false);
  });

  it("discards before switching to another artifact", async () => {
    mocks.artifacts.artifacts = [REPORT_PATH, SUMMARY_PATH];
    seedDirtyDraft();
    renderDetail(REPORT_PATH);

    fireEvent.click(
      screen.getByRole("combobox", { name: "Select an artifact file" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "summary.md" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.artifacts.select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(mocks.artifacts.select).toHaveBeenCalledWith(SUMMARY_PATH);
  });

  it("keeps raw Gateway detail out of artifact-save failure toasts", async () => {
    mocks.artifactContent.content = "saved version";
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ detail: "private storage path and credentials" }),
    });
    seedDirtyDraft();
    renderDetail(REPORT_PATH);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Failed to save artifact"),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private storage path and credentials",
    );
  });
});
