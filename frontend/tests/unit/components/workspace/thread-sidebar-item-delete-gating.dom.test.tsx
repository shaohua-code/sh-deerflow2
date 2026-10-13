import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { ThreadSidebarItem } from "@/components/workspace/recent-chat-list";
import { ThreadDeleteDialogProvider } from "@/components/workspace/thread-delete-dialog";
import { AuthProvider } from "@/core/auth/AuthProvider";
import type { User } from "@/core/auth/types";
import { DEFAULT_LOCALE } from "@/core/i18n";
import { I18nProvider } from "@/core/i18n/context";

rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn(), replace: rs.fn(), refresh: rs.fn() }),
  usePathname: () => "/workspace",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
const mocks = rs.hoisted(() => ({
  pinThread: rs.fn(),
  renameThread: rs.fn(),
  toastError: rs.fn(),
}));
rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
rs.mock("@/core/threads/archive", () => ({
  useArchiveThread: () => ({ mutate: rs.fn(), isPending: false }),
}));
rs.mock("@/core/threads/hooks", () => ({
  useDeleteThread: () => ({
    mutateAsync: rs.fn(async () => undefined),
    isPending: false,
    isError: false,
  }),
  useMoveThreadToProject: () => ({ mutate: rs.fn() }),
  usePinThread: () => ({ mutate: mocks.pinThread }),
  useRenameThread: () => ({ mutate: mocks.renameThread }),
}));

function makeUser(permissions: string[] | undefined): User {
  return {
    id: "user-1",
    email: "user@example.test",
    system_role: "user",
    ...(permissions === undefined ? {} : { permissions }),
  } as User;
}

function makeThread() {
  return {
    thread_id: "thread-1",
    title: "A thread",
    updated_at: "2026-01-01T00:00:00Z",
  } as never;
}

function renderItem(user: User): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree: ReactNode = (
    <I18nProvider initialLocale={DEFAULT_LOCALE}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider initialUser={user}>
          <SidebarProvider>
            <ThreadDeleteDialogProvider>
              <ThreadSidebarItem thread={makeThread()} isActive={false} />
            </ThreadDeleteDialogProvider>
          </SidebarProvider>
        </AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
  return render(tree);
}

/** Opens the row's "more" dropdown — the Delete item lives inside it.
 * Radix triggers open on pointerdown, not click (verified in happy-dom). */
async function openRowMenu(): Promise<void> {
  const trigger = await screen.findByRole("button", { name: /more/i });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
}

afterEach(() => {
  rs.restoreAllMocks();
  cleanup();
});

beforeEach(() => {
  mocks.pinThread.mockReset();
  mocks.renameThread.mockReset();
  mocks.toastError.mockReset();
});

describe("ThreadSidebarItem delete-menu gating (threads:delete)", () => {
  it("exposes the rename field by its localized accessible name", async () => {
    renderItem(makeUser(["threads:read", "threads:write"]));
    await openRowMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    expect(screen.getByRole("textbox", { name: "Rename" })).toBeTruthy();
  });

  it("uses localized copy for rename failures without exposing server details", async () => {
    renderItem(makeUser(["threads:read", "threads:write"]));
    await openRowMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename" }), {
      target: { value: "Updated title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const [, options] = mocks.renameThread.mock.calls[0] as [
      unknown,
      { onError: (error: Error) => void },
    ];
    options.onError(new Error("private update detail"));

    expect(mocks.toastError).toHaveBeenCalledWith("Failed to rename thread.");
    expect(mocks.toastError).not.toHaveBeenCalledWith("private update detail");
  });

  it("uses localized copy for pin failures without exposing server details", async () => {
    renderItem(makeUser(["threads:read", "threads:write"]));
    await openRowMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin chat" }));

    const [, options] = mocks.pinThread.mock.calls[0] as [
      unknown,
      { onError: (error: Error) => void },
    ];
    options.onError(new Error("private metadata backend detail"));

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to update pinned chat",
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private metadata backend detail",
    );
  });

  it("offers Delete for a role holding threads:delete", async () => {
    renderItem(makeUser(["threads:read", "threads:delete"]));
    await openRowMenu();
    expect(await screen.findByText("Delete")).not.toBeNull();
  });

  it("omits Delete for a role denied threads:delete, keeping the other menu actions", async () => {
    renderItem(makeUser(["threads:read"]));
    await openRowMenu();
    // Other actions survive the gating…
    expect(await screen.findByText("Rename")).not.toBeNull();
    // …and Delete is gone. Anchor via waitFor on Rename first so the menu is
    // provably open before asserting absence.
    await waitFor(() => {
      expect(screen.queryByText("Delete")).toBeNull();
    });
  });

  it("offers Delete for an unresolved permission list (pre-Phase-4 backend)", async () => {
    renderItem(makeUser(undefined));
    await openRowMenu();
    expect(await screen.findByText("Delete")).not.toBeNull();
  });
});
