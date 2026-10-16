import type { Message } from "@langchain/langgraph-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MessageListItem } from "@/components/workspace/messages/message-list-item";
import { I18nContext } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { threadHistoryQueryKey } from "@/core/threads/hooks";
import * as messageUtils from "@/core/messages/utils";

const mocks = rs.hoisted(() => ({
  user: { current: { permissions: ["threads:write", "threads:delete"] } },
  deleteFeedback: rs.fn(async () => undefined),
  upsertFeedback: rs.fn(
    async (_threadId: string, _runId: string, rating: number) => ({
      feedback_id: "feedback-1",
      rating,
      comment: null,
    }),
  ),
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user.current }),
}));

rs.mock("@/core/api/feedback", () => ({
  deleteFeedback: mocks.deleteFeedback,
  upsertFeedback: mocks.upsertFeedback,
}));

// The unit under test is the row's copy-data memo, not message rendering.
// Stubbing the markdown pipeline also removes its first-render suspension:
// when a settled body suspends, React restarts the render attempt and
// legitimately re-runs useMemo factories, which would make call counts
// depend on microtask timing instead of the memo's own deps.
rs.mock("@/components/workspace/messages/markdown-content", () => ({
  MarkdownContent: () => null,
}));

// Count calls to the copy-data derivation itself. The render path reads the
// message content for the body (markdown, reasoning, tasks), so content
// getters cannot distinguish rendering reads from copy derivation — the spy
// on the derived entry point can.
const copyDataCalls = rs.spyOn(messageUtils, "getMessageCopyData");

function makeMessage(type: "human" | "ai"): Message {
  return {
    id: `${type}-1`,
    type,
    content: "copy me",
  } as unknown as Message;
}

function withI18n(ui: React.ReactElement, queryClient = new QueryClient()) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nContext.Provider
        value={{ locale: "en-US", setLocale: () => undefined, t: enUS }}
      >
        {ui}
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

function renderRow(
  message: Message,
  {
    showCopyButton,
    isLoading = false,
    canEdit = false,
    onEditAndRegenerate,
  }: {
    showCopyButton: boolean;
    isLoading?: boolean;
    canEdit?: boolean;
    onEditAndRegenerate?: (replacementText: string) => void;
  },
) {
  return render(
    withI18n(
      <MessageListItem
        message={message}
        threadId="thread-1"
        showCopyButton={showCopyButton}
        isLoading={isLoading}
        canEdit={canEdit}
        onEditAndRegenerate={onEditAndRegenerate}
      />,
    ),
  );
}

afterEach(cleanup);
afterEach(() => {
  copyDataCalls.mockClear();
  mocks.user.current = {
    permissions: ["threads:write", "threads:delete"],
  };
  mocks.deleteFeedback.mockClear();
  mocks.upsertFeedback.mockClear();
});

function renderFeedbackRow(
  permissions: string[],
  feedback: {
    feedback_id: string;
    rating: number;
    comment: string | null;
  } | null,
) {
  mocks.user.current = { permissions };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    withI18n(
      <MessageListItem
        message={makeMessage("human")}
        threadId="thread-1"
        runId="run-1"
        feedback={feedback}
        showCopyButton={true}
        isLoading={false}
      />,
      queryClient,
    ),
  );
  return { ...view, queryClient };
}

describe("MessageListItem copy-data derivation guard", () => {
  it("names the editable message draft", () => {
    renderRow(makeMessage("human"), {
      showCopyButton: true,
      canEdit: true,
      onEditAndRegenerate: rs.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit and rerun" }));

    expect(
      screen.getByRole("textbox", { name: "Message text to edit" }),
    ).toBeTruthy();
  });

  it("derives no copy data for an assistant row that never renders the toolbar", () => {
    const message = makeMessage("ai");

    const view = renderRow(message, { showCopyButton: false });
    expect(copyDataCalls).toHaveBeenCalledTimes(0);

    // The sole call site passes showCopyButton only for non-assistant rows;
    // the memo must stay gated so settled assistant rows skip the derivation
    // entirely (the pre-memo call sat behind the same toolbar guard).
    view.rerender(
      withI18n(
        <MessageListItem
          message={message}
          threadId="thread-1"
          showCopyButton={false}
          isLoading={false}
        />,
      ),
    );
    expect(copyDataCalls).toHaveBeenCalledTimes(0);
  });

  it("derives a human row's copy data once and reuses it across re-renders", () => {
    const message = makeMessage("human");

    const view = renderRow(message, { showCopyButton: true });
    // One memo serves both editing and the toolbar — not one derivation per
    // consumer.
    expect(copyDataCalls).toHaveBeenCalledTimes(1);

    view.rerender(
      withI18n(
        <MessageListItem
          message={message}
          threadId="thread-1"
          showCopyButton={true}
          isLoading={false}
        />,
      ),
    );
    expect(copyDataCalls).toHaveBeenCalledTimes(1);
  });

  it("still derives for a human row while loading (editing needs it)", () => {
    const message = makeMessage("human");

    renderRow(message, { showCopyButton: true, isLoading: true });

    expect(copyDataCalls.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("MessageListItem feedback permissions", () => {
  const savedPositiveFeedback = {
    feedback_id: "feedback-1",
    rating: 1,
    comment: null,
  };

  it("hides feedback controls when threads:write is denied", () => {
    renderFeedbackRow(["threads:read"], savedPositiveFeedback);

    expect(
      screen.queryByRole("button", { name: "Mark this response as helpful" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Mark this response as unhelpful",
      }),
    ).toBeNull();
    expect(mocks.deleteFeedback).not.toHaveBeenCalled();
    expect(mocks.upsertFeedback).not.toHaveBeenCalled();
  });

  it("requires threads:delete to remove feedback but allows changing the rating", async () => {
    renderFeedbackRow(["threads:write"], savedPositiveFeedback);

    const selected = screen.getByRole("button", {
      name: "Remove helpful feedback",
    });
    expect(selected.hasAttribute("disabled")).toBe(true);
    expect(selected.getAttribute("title")).toBe(
      "You need threads:delete permission to remove saved feedback.",
    );
    const feedbackGroup = screen.getByRole("group", {
      name: "Rate the assistant response",
    });
    const descriptionId = feedbackGroup.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      "You need threads:delete permission to remove saved feedback.",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark this response as unhelpful",
      }),
    );
    await screen.findByRole("button", { name: "Remove unhelpful feedback" });

    expect(mocks.deleteFeedback).not.toHaveBeenCalled();
    expect(mocks.upsertFeedback).toHaveBeenCalledWith("thread-1", "run-1", -1);
  });

  it("uses the delete route only when threads:delete is granted", async () => {
    renderFeedbackRow(
      ["threads:write", "threads:delete"],
      savedPositiveFeedback,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove helpful feedback" }),
    );
    await screen.findByRole("button", {
      name: "Mark this response as helpful",
    });

    expect(mocks.deleteFeedback).toHaveBeenCalledWith("thread-1", "run-1");
    expect(mocks.upsertFeedback).not.toHaveBeenCalled();
  });

  it("syncs a refreshed saved rating into the row state", () => {
    const view = renderFeedbackRow(["threads:write", "threads:delete"], null);

    view.rerender(
      withI18n(
        <MessageListItem
          message={makeMessage("ai")}
          threadId="thread-1"
          runId="run-1"
          feedback={savedPositiveFeedback}
          showCopyButton={true}
          isLoading={false}
        />,
        view.queryClient,
      ),
    );

    expect(
      screen.getByRole("button", { name: "Remove helpful feedback" }),
    ).toBeTruthy();
  });

  it("invalidates the thread history after saving feedback", async () => {
    const view = renderFeedbackRow(["threads:write", "threads:delete"], null);
    const historyKey = threadHistoryQueryKey("thread-1");
    view.queryClient.setQueryData(historyKey, {
      pages: [],
      pageParams: [],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Mark this response as helpful" }),
    );
    await screen.findByRole("button", { name: "Remove helpful feedback" });

    expect(view.queryClient.getQueryState(historyKey)?.isInvalidated).toBe(
      true,
    );
  });
});
