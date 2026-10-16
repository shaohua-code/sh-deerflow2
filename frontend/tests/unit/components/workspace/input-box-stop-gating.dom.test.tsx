import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, type ReactNode } from "react";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
import { AuthProvider, useAuth } from "@/core/auth/AuthProvider";
import { DEFAULT_LOCALE } from "@/core/i18n";
import { I18nProvider } from "@/core/i18n/context";

const toastMocks = rs.hoisted(() => ({
  error: rs.fn(),
  info: rs.fn(),
}));
const polishMocks = rs.hoisted(() => ({ polishInputDraft: rs.fn() }));

rs.mock("sonner", () => ({
  toast: toastMocks,
}));

// The real Streamdown renderer and its optional code-highlighting package are
// irrelevant to composer permission tests and may be unavailable in unit CI.
rs.mock("@/core/input-polish/api", () => ({
  polishInputDraft: polishMocks.polishInputDraft,
}));

rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn(), replace: rs.fn(), refresh: rs.fn() }),
  usePathname: () => "/workspace",
  useSearchParams: () => new URLSearchParams(),
}));

// The composer's model selector is irrelevant to stop gating; keep the
// react-query + network machinery out of the way entirely.
rs.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: [],
    tokenUsageEnabled: false,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: rs.fn(),
  }),
}));

rs.mock("@/core/skills/hooks", () => ({
  useSkills: () => ({ skills: [], isLoading: false }),
}));

rs.mock("@/core/suggestions/hooks", () => ({
  useSuggestionsConfig: () => ({
    data: { enabled: true, max_suggestions: 3 },
  }),
}));

function UpdateTestPermissions({
  permissions,
}: {
  permissions?: string[] | null;
}) {
  const { applyUser } = useAuth();
  useEffect(() => {
    if (permissions === undefined) return;
    applyUser({
      id: "user-1",
      email: "user@example.test",
      system_role: "user",
      needs_setup: false,
      oauth_provider: null,
      permissions,
    });
  }, [applyUser, permissions]);
  return null;
}

function getSubmitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("submit button not rendered");
  }
  return button;
}

function renderComposer({
  canSubmit,
  canStopStreaming,
  onStop,
  locale = DEFAULT_LOCALE,
  status = "streaming",
  canUploadFiles = true,
  onSubmit,
  permissions,
  isMockThread = true,
  threadMessages = [],
}: {
  canSubmit?: boolean;
  canStopStreaming?: boolean;
  onStop: () => void;
  onSubmit?: () => void;
  canUploadFiles?: boolean;
  locale?: "en-US" | "zh-CN";
  status?: "ready" | "submitted" | "streaming" | "error";
  permissions?: string[] | null;
  isMockThread?: boolean;
  threadMessages?: unknown[];
}) {
  // useI18n hydrates from the locale cookie after the provider's initial render.
  document.cookie = `locale=${locale}; path=/`;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (
    onStopProp: () => void,
    canUploadFilesProp = canUploadFiles,
    statusProp = status,
    permissionsProp = permissions,
  ): ReactNode => (
    <I18nProvider initialLocale={locale}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider
          initialUser={{
            id: "user-1",
            email: "user@example.test",
            system_role: "user",
            needs_setup: false,
            oauth_provider: null,
            ...(permissionsProp === undefined
              ? {}
              : { permissions: permissionsProp }),
          }}
        >
          <UpdateTestPermissions permissions={permissionsProp} />
          <ThreadContext.Provider
            value={{
              thread: { messages: threadMessages } as never,
              isMock: isMockThread,
            }}
          >
            <PromptInputProvider>
              <InputBox
                threadId="thread-1"
                status={statusProp}
                context={{ mode: "flash" } as never}
                onStop={onStopProp}
                onSubmit={onSubmit}
                canUploadFiles={canUploadFilesProp}
                canSubmit={canSubmit}
                canStopStreaming={canStopStreaming}
              />
            </PromptInputProvider>
          </ThreadContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
  const view = render(tree(onStop));
  return {
    ...view,
    rerenderCanUploadFiles: (allowed: boolean) =>
      view.rerender(tree(onStop, allowed)),
    rerenderComposer: (next: {
      status?: "ready" | "submitted" | "streaming" | "error";
      permissions?: string[] | null;
    }) =>
      view.rerender(
        tree(
          onStop,
          canUploadFiles,
          next.status ?? status,
          next.permissions === undefined ? permissions : next.permissions,
        ),
      ),
  };
}

afterEach(() => {
  toastMocks.error.mockClear();
  toastMocks.info.mockClear();
  polishMocks.polishInputDraft.mockReset();
  rs.restoreAllMocks();
  cleanup();
  document.cookie = "locale=; Max-Age=0; path=/";
});

describe("InputBox stop gating (runs:cancel)", () => {
  it("disables the stop affordance for a denied role and never fires onStop", () => {
    const onStop = rs.fn();
    const { container } = renderComposer({ canStopStreaming: false, onStop });

    const submit = getSubmitButton(container);
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("explains the permission boundary on the disabled affordance", () => {
    const { container } = renderComposer({
      canStopStreaming: false,
      onStop: rs.fn(),
    });

    const submit = getSubmitButton(container);
    expect(submit.getAttribute("aria-label")).toContain("not permitted");
    expect(submit.title).toContain("not permitted");
  });

  it("keeps the localized stop action enabled for an unresolved permission list", () => {
    const onStop = rs.fn();
    const { container } = renderComposer({ onStop });

    const submit = getSubmitButton(container);
    expect(submit.getAttribute("aria-label")).toBe("Stop generating");
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("keeps an authorized stop action available when run creation is denied", () => {
    const onStop = rs.fn();
    const { container } = renderComposer({
      canSubmit: false,
      canStopStreaming: true,
      onStop,
    });

    const submit = getSubmitButton(container);
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("uses the selected locale for the idle send control name", () => {
    renderComposer({ onStop: rs.fn(), locale: "zh-CN", status: "ready" });

    const submit = screen.getByRole("button", { name: "发送消息" });
    expect(submit.tagName).toBe("BUTTON");
  });

  it("announces the submitted state in the selected locale", () => {
    renderComposer({ onStop: rs.fn(), locale: "zh-CN", status: "submitted" });

    const submit = screen.getByRole("button", { name: "正在发送消息" });
    expect(submit.tagName).toBe("BUTTON");
  });

  it("blocks file selection when threads:write is explicitly denied", () => {
    renderComposer({
      canUploadFiles: false,
      onStop: rs.fn(),
      status: "ready",
    });

    const addAttachment = screen.getByTestId("add-attachments-button");
    const fileInput = screen.getByLabelText("Upload files");
    expect((addAttachment as HTMLButtonElement).disabled).toBe(true);
    expect((fileInput as HTMLInputElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "You do not have permission to upload files to this conversation. Ask your administrator for threads:write.",
      ),
    ).toBeDefined();

    const file = new File(["private"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.drop(document, {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  it("keeps text submission available when only upload permission is denied", async () => {
    const onSubmit = rs.fn();
    const { container } = renderComposer({
      canUploadFiles: false,
      onStop: rs.fn(),
      onSubmit,
      status: "ready",
    });
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();

    fireEvent.change(textarea!, { target: { value: "plain text" } });
    fireEvent.click(getSubmitButton(container));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("disables model-backed input polishing without runs:create", () => {
    const { container } = renderComposer({
      canSubmit: false,
      isMockThread: false,
      onStop: rs.fn(),
      permissions: ["threads:read"],
      status: "ready",
    });
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, {
      target: { value: "Please improve this draft before I send it." },
    });

    const polishButton = screen.getByTestId("polish-input-button");
    expect((polishButton as HTMLButtonElement).disabled).toBe(true);
    expect((polishButton as HTMLButtonElement).title).toContain("runs:create");
    fireEvent.click(polishButton);
    expect(polishMocks.polishInputDraft).not.toHaveBeenCalled();
  });

  it("keeps the local polish undo available after runs:create is revoked", async () => {
    polishMocks.polishInputDraft.mockResolvedValue({
      rewritten_text: "A clearer research request.",
      changed: true,
    });
    const view = renderComposer({
      isMockThread: false,
      onStop: rs.fn(),
      permissions: ["runs:create"],
      status: "ready",
    });
    const textarea = view.container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, {
      target: { value: "Make this research request clearer" },
    });
    fireEvent.click(screen.getByTestId("polish-input-button"));

    await waitFor(() =>
      expect(textarea!.value).toBe("A clearer research request."),
    );
    view.rerenderComposer({ permissions: ["threads:read"] });

    const undoButton = screen.getByTestId("polish-input-button");
    expect((undoButton as HTMLButtonElement).disabled).toBe(false);
    expect((undoButton as HTMLButtonElement).getAttribute("aria-label")).toBe(
      "Undo polish",
    );
    fireEvent.click(undoButton);
    expect(textarea!.value).toBe("Make this research request clearer");
    expect(polishMocks.polishInputDraft).toHaveBeenCalledTimes(1);
  });

  it("does not request thread suggestions when threads:read is denied", () => {
    const fetchSpy = rs
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.includes("/suggestions")
              ? { suggestions: ["Try this follow-up?"] }
              : {},
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
    const view = renderComposer({
      isMockThread: false,
      onStop: rs.fn(),
      permissions: ["runs:create"],
      status: "streaming",
      threadMessages: [
        { id: "ai-1", type: "ai", content: "The answer is ready." },
      ],
    });

    view.rerenderComposer({ status: "ready" });

    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input).includes("/api/threads/thread-1/suggestions"),
      ),
    ).toBe(false);
  });

  it("clears already displayed suggestions when threads:read is revoked", async () => {
    const fetchSpy = rs
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.includes("/suggestions")
              ? { suggestions: ["Try this follow-up?"] }
              : {},
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });
    const view = renderComposer({
      isMockThread: false,
      onStop: rs.fn(),
      permissions: ["runs:create", "threads:read"],
      status: "streaming",
      threadMessages: [
        { id: "ai-1", type: "ai", content: "The answer is ready." },
      ],
    });

    view.rerenderComposer({ status: "ready" });
    expect(await screen.findByText("Try this follow-up?")).toBeDefined();
    view.rerenderComposer({ permissions: ["runs:create"] });

    await waitFor(() =>
      expect(screen.queryByText("Try this follow-up?")).toBeNull(),
    );
    expect(
      fetchSpy.mock.calls.filter(([input]) =>
        String(input).includes("/api/threads/thread-1/suggestions"),
      ),
    ).toHaveLength(1);
  });

  it("preserves a selected attachment and blocks submission if threads:write is revoked", async () => {
    const onSubmit = rs.fn();
    const view = renderComposer({
      canUploadFiles: true,
      onStop: rs.fn(),
      onSubmit,
      status: "ready",
    });
    const file = new File(["private"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload files"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("notes.txt")).toBeDefined();

    view.rerenderCanUploadFiles(false);
    const submit = getSubmitButton(view.container);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "You do not have permission to upload files to this conversation. Ask your administrator for threads:write.",
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("notes.txt")).toBeDefined();
  });
});

describe("InputBox built-in command permission gating", () => {
  it("does not read the goal when threads:read is denied", async () => {
    const fetchSpy = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const { container } = renderComposer({
      onStop: rs.fn(),
      permissions: ["runs:create", "threads:write"],
      status: "ready",
    });
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/goal" } });
    fireEvent.click(getSubmitButton(container));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "You do not have permission to view this conversation's goal. Ask your administrator for threads:read.",
      ),
    );
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes("/goal")),
    ).toBe(false);
    expect(input.value).toBe("/goal");
  });

  it("does not clear the goal when threads:write is denied", async () => {
    const fetchSpy = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const { container } = renderComposer({
      onStop: rs.fn(),
      permissions: ["runs:create", "threads:read"],
      status: "ready",
    });
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/goal clear" } });
    fireEvent.click(getSubmitButton(container));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "You do not have permission to change this conversation's goal. Ask your administrator for threads:write.",
      ),
    );
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes("/goal")),
    ).toBe(false);
    expect(input.value).toBe("/goal clear");
  });

  it("requires threads:write before saving a goal, even when runs:create is granted", async () => {
    const fetchSpy = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const { container } = renderComposer({
      onStop: rs.fn(),
      permissions: ["runs:create", "threads:read"],
      status: "ready",
    });
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, {
      target: { value: "/goal finish the product review" },
    });
    fireEvent.click(getSubmitButton(container));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "You do not have permission to change this conversation's goal. Ask your administrator for threads:write.",
      ),
    );
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes("/goal")),
    ).toBe(false);
    expect(input.value).toBe("/goal finish the product review");
  });

  it("does not compact the conversation when threads:write is denied", async () => {
    const fetchSpy = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const { container } = renderComposer({
      onStop: rs.fn(),
      permissions: ["runs:create", "threads:read"],
      status: "ready",
    });
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/compact" } });
    fireEvent.click(getSubmitButton(container));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "You do not have permission to compact this conversation. Ask your administrator for threads:write.",
      ),
    );
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).includes("/compact")),
    ).toBe(false);
    expect(input.value).toBe("/compact");
  });
});
