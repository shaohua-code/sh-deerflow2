import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const artifactState = rs.hoisted(() => ({
  select: rs.fn(),
  setOpen: rs.fn(),
  user: null as {
    id: string;
    system_role: string;
    permissions: string[] | null;
  } | null,
}));
const archiveState = rs.hoisted(() => {
  class RequestError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return {
    download: rs.fn(),
    manifest: rs.fn(),
    install: rs.fn(),
    RequestError,
    toastError: rs.fn(),
    toastSuccess: rs.fn(),
  };
});

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: artifactState.user }),
}));
rs.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: () => artifactState,
}));
rs.mock("@/core/artifacts/api", () => ({
  ArtifactRequestError: archiveState.RequestError,
  downloadArtifactArchive: archiveState.download,
  getArtifactArchiveManifest: archiveState.manifest,
  MAX_ARTIFACT_ARCHIVE_FILES: 50,
}));
rs.mock("@/core/skills/api", () => ({
  installSkill: archiveState.install,
  SkillRequestError: class SkillRequestError extends Error {
    readonly isAdminRequired = false;
  },
}));
rs.mock("sonner", () => ({
  toast: {
    error: archiveState.toastError,
    success: archiveState.toastSuccess,
  },
}));

import { ArtifactFileList } from "@/components/workspace/artifacts/artifact-file-list";
import { ArtifactRequestError } from "@/core/artifacts/api";
import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";

const files = [
  "/mnt/user-data/outputs/report.md",
  "/mnt/user-data/outputs/data.csv",
];

function renderList(
  props: Partial<React.ComponentProps<typeof ArtifactFileList>> = {},
) {
  artifactState.user ??= {
    id: "owner-a",
    system_role: "user",
    permissions: ["runs:read"],
  };
  const componentProps = { files, threadId: "thread-1", ...props };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const component = (
    nextProps: React.ComponentProps<typeof ArtifactFileList>,
  ) => (
    <QueryClientProvider client={queryClient}>
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: () => undefined, t: enUS }}
      >
        <ArtifactFileList {...nextProps} />
      </I18nContext.Provider>
    </QueryClientProvider>
  );
  const result = render(component(componentProps));
  return {
    ...result,
    queryClient,
    rerenderList: (
      nextProps: Partial<React.ComponentProps<typeof ArtifactFileList>>,
    ) => result.rerender(component({ ...componentProps, ...nextProps })),
  };
}

afterEach(cleanup);
afterEach(() => {
  artifactState.user = null;
  archiveState.install.mockReset();
  archiveState.toastError.mockReset();
  archiveState.toastSuccess.mockReset();
  rs.restoreAllMocks();
});

describe("ArtifactFileList archive download", () => {
  it("offers a branch-local run accepted by the manifest ownership check", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    renderList({ runId: "branch-run", threadId: "branch-thread" });

    expect(
      await screen.findByRole("button", {
        name: "Download current versions (2 files)",
      }),
    ).toBeTruthy();
    expect(archiveState.manifest).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "branch-run",
        threadId: "branch-thread",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      screen.getByText(
        "The file list comes from this response. Contents are the current versions and may have changed.",
      ),
    ).toBeTruthy();
  });

  it("uses the verified receipt count instead of attempted tool arguments", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 3 });
    renderList({ runId: "run-1" });

    expect(
      await screen.findByRole("button", {
        name: "Download current versions (3 files)",
      }),
    ).toBeTruthy();
  });

  it("does not offer an archive when only one attempted file was delivered", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 1 });
    renderList({ runId: "run-1" });

    await waitFor(() => {
      expect(archiveState.manifest).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          threadId: "thread-1",
          signal: expect.any(AbortSignal),
        }),
      );
    });
    expect(
      screen.queryByRole("button", {
        name: /Download current versions/,
      }),
    ).toBeNull();
  });

  it("does not offer an archive outside a run-scoped delivery", () => {
    renderList();

    expect(
      screen.queryByRole("button", {
        name: /Download current versions/,
      }),
    ).toBeNull();
  });

  it("does not offer an archive for a single verified file", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 1 });
    renderList({ files: files.slice(0, 1), runId: "run-1" });

    await waitFor(() => {
      expect(archiveState.manifest).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("button", {
        name: /Download current versions/,
      }),
    ).toBeNull();
  });

  it("does not offer an archive above the server file-count limit", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 51 });
    renderList({ runId: "run-1" });

    await waitFor(() => {
      expect(archiveState.manifest).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("button", {
        name: /Download current versions/,
      }),
    ).toBeNull();
  });

  it("does not offer an archive when the current thread cannot download it", () => {
    renderList({ archiveDownloadsEnabled: false, runId: "run-1" });

    expect(
      screen.queryByRole("button", {
        name: /Download current versions/,
      }),
    ).toBeNull();
  });

  it("does not read or show a manifest without runs:read", () => {
    artifactState.user = {
      id: "owner-a",
      system_role: "user",
      permissions: [],
    };
    renderList({ runId: "run-1" });

    expect(archiveState.manifest).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Download current versions/ }),
    ).toBeNull();
  });

  it("does not reuse a manifest cache after switching owners", async () => {
    archiveState.manifest
      .mockResolvedValueOnce({ fileCount: 2 })
      .mockImplementation(() => new Promise(() => undefined));
    const { rerenderList } = renderList({ runId: "run-1" });
    await screen.findByRole("button", {
      name: "Download current versions (2 files)",
    });

    artifactState.user = {
      id: "owner-b",
      system_role: "user",
      permissions: ["runs:read"],
    };
    rerenderList({});

    await waitFor(() => expect(archiveState.manifest).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: /Download current versions/ }),
    ).toBeNull();
  });

  it("hides a cached archive while downloads are disabled", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    const { rerenderList } = renderList({ runId: "run-1" });
    await screen.findByRole("button", {
      name: "Download current versions (2 files)",
    });

    rerenderList({ archiveDownloadsEnabled: false });

    expect(
      screen.queryByRole("button", {
        name: /Download current versions/,
      }),
    ).toBeNull();
  });

  it("hides an inherited run when the thread ownership check rejects it", async () => {
    archiveState.manifest.mockRejectedValue(
      new ArtifactRequestError(404, "Run parent-run not found"),
    );
    renderList({ runId: "parent-run" });

    await waitFor(() => {
      expect(archiveState.manifest).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "parent-run",
          threadId: "thread-1",
          signal: expect.any(AbortSignal),
        }),
      );
    });
    expect(
      screen.queryByRole("button", {
        name: /Download current versions/,
      }),
    ).toBeNull();
  });

  it("downloads the archive and releases its object URL", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    const blob = new Blob(["zip"]);
    archiveState.download.mockResolvedValue({
      blob,
      filename: "artifacts-run-1.zip",
    });
    const createObjectURL = rs
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:archive");
    const revokeObjectURL = rs.spyOn(URL, "revokeObjectURL");
    let downloadedFilename: string | undefined;
    rs.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download;
    });
    renderList({ runId: "run-1" });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download current versions (2 files)",
      }),
    );

    await waitFor(() => {
      expect(archiveState.download).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-1",
          threadId: "thread-1",
          signal: expect.any(AbortSignal),
        }),
      );
      expect(downloadedFilename).toBe("artifacts-run-1.zip");
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:archive");
    });
  });

  it("reports archive download failures", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    archiveState.download.mockRejectedValue(new Error("network down"));
    renderList({ runId: "run-1" });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download current versions (2 files)",
      }),
    );

    await waitFor(() => {
      expect(archiveState.toastError).toHaveBeenCalledWith(
        "Failed to download artifact archive.",
      );
    });
  });

  it("aborts an archive download and ignores its result after runs:read revoke", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    let requestSignal: AbortSignal | undefined;
    archiveState.download.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const { rerenderList } = renderList({ runId: "run-1" });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download current versions (2 files)",
      }),
    );
    await waitFor(() => expect(requestSignal).toBeDefined());

    artifactState.user = {
      id: "owner-a",
      system_role: "user",
      permissions: [],
    };
    rerenderList({});

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(archiveState.toastError).not.toHaveBeenCalled();
  });

  it("maps archive-limit errors to safe localized feedback", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    const privateDetail = "Archive path /mnt/user-data/private/report.pdf";
    archiveState.download.mockRejectedValue(
      new ArtifactRequestError(413, privateDetail),
    );
    renderList({ runId: "run-1" });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download current versions (2 files)",
      }),
    );

    await waitFor(() => {
      expect(archiveState.toastError).toHaveBeenCalledWith(
        enUS.artifactArchive.archiveTooLarge,
      );
      expect(archiveState.toastError).not.toHaveBeenCalledWith(privateDetail);
    });
  });

  it("maps busy archive requests to localized retry guidance", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    archiveState.download.mockRejectedValue(
      new ArtifactRequestError(429, "internal worker queue details"),
    );
    renderList({ runId: "run-1" });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download current versions (2 files)",
      }),
    );

    await waitFor(() => {
      expect(archiveState.toastError).toHaveBeenCalledWith(
        enUS.artifactArchive.archiveBusy,
      );
      expect(archiveState.toastError).not.toHaveBeenCalledWith(
        "internal worker queue details",
      );
    });
  });

  it("hides unexpected Gateway archive details behind the generic message", async () => {
    archiveState.manifest.mockResolvedValue({ fileCount: 2 });
    archiveState.download.mockRejectedValue(
      new ArtifactRequestError(500, "database password and private path"),
    );
    renderList({ runId: "run-1" });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download current versions (2 files)",
      }),
    );

    await waitFor(() => {
      expect(archiveState.toastError).toHaveBeenCalledWith(
        enUS.artifactArchive.downloadFailed,
      );
      expect(archiveState.toastError).not.toHaveBeenCalledWith(
        "database password and private path",
      );
    });
  });

  it("shows safe localized feedback when installing a skill from the file list fails", async () => {
    artifactState.user = {
      id: "owner-a",
      system_role: "admin",
      permissions: ["runs:read"],
    };
    archiveState.install.mockResolvedValue({
      success: false,
      skill_name: "demo",
      message: "private gateway path",
    });
    renderList({ files: ["/mnt/user-data/outputs/demo.skill"] });

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(archiveState.toastError).toHaveBeenCalledWith(
        enUS.settings.skills.installFailed,
      );
    });
    expect(archiveState.toastError).not.toHaveBeenCalledWith(
      "private gateway path",
    );
  });
});
