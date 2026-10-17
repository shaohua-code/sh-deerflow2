import { afterEach, expect, test } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";

import {
  stageProjectAttachment,
  useStagedProjectAttachments,
} from "@/core/projects/composer-attach";
import type { AttachProjectDocumentResult } from "@/core/projects/types";

const ATTACHMENT: AttachProjectDocumentResult = {
  filename: "roadmap.md",
  size_bytes: 2048,
  virtual_path: "/mnt/user-data/uploads/roadmap.md",
  artifact_url:
    "/api/threads/thread-1/artifacts/mnt/user-data/uploads/roadmap.md",
};

const OTHER: AttachProjectDocumentResult = {
  filename: "notes.txt",
  size_bytes: 128,
  virtual_path: "/mnt/user-data/uploads/notes.txt",
  artifact_url:
    "/api/threads/thread-1/artifacts/mnt/user-data/uploads/notes.txt",
};

// Latest hook state, exposed to assertions without a DOM surface. The probe
// keeps the setter reachable so tests can drive removal/clear like the
// composer's chip button and onSent callback do.
const observed: {
  current: AttachProjectDocumentResult[];
  set: (value: AttachProjectDocumentResult[]) => void;
} = {
  current: [],
  set: () => {
    throw new Error("composer probe not mounted");
  },
};

function ComposerProbe({
  threadId,
  userId = "user-1",
}: {
  threadId: string;
  userId?: string;
}) {
  const [attachments, setAttachments] = useStagedProjectAttachments(
    userId,
    threadId,
  );
  // commit 后同步探针（渲染期写模块级变量被编译器禁止）；testing-library
  // 的 render/act 已 flush effects，断言时机不变。
  useEffect(() => {
    observed.current = attachments;
    observed.set = setAttachments;
  });
  return null;
}

afterEach(() => {
  cleanup();
  observed.current = [];
  observed.set = () => {
    throw new Error("composer probe not mounted");
  };
  window.sessionStorage.clear();
});

// StrictMode double-invokes mount effects (mount -> cleanup -> re-run). The
// pending list is loaded without any consume step, so the replay re-applies
// the same state instead of resetting it.
test("a Strict-Mode effect replay keeps the pending attachment", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);

  render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );

  expect(observed.current).toEqual([ATTACHMENT]);
});

test("a remount (navigation or reload) re-reads every pending attachment", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);

  const first = render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );
  expect(observed.current).toEqual([ATTACHMENT]);

  // Navigating away unmounts the composer; staging a second document from
  // the project page appends to the same pending list.
  first.unmount();
  stageProjectAttachment("user-1", "thread-1", OTHER);

  render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );
  expect(observed.current).toEqual([ATTACHMENT, OTHER]);
});

test("switching threads shows that thread's own pending list", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);

  const { rerender } = render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );
  expect(observed.current).toEqual([ATTACHMENT]);

  // No pending entry for the new thread: the old chip must not leak across.
  rerender(
    <StrictMode>
      <ComposerProbe threadId="thread-2" />
    </StrictMode>,
  );
  expect(observed.current).toEqual([]);

  // A pending entry for the new thread is picked up on the switch.
  stageProjectAttachment("user-1", "thread-3", OTHER);
  rerender(
    <StrictMode>
      <ComposerProbe threadId="thread-3" />
    </StrictMode>,
  );
  expect(observed.current).toEqual([OTHER]);
});

test("removing one chip persists the remaining pending attachments", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);
  stageProjectAttachment("user-1", "thread-1", OTHER);

  const { unmount } = render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );
  observed.set([ATTACHMENT]);
  unmount();

  expect(
    window.sessionStorage.getItem(
      "deerflow.project-attachment.v2.user-1.thread-1",
    ),
  ).toBe(JSON.stringify([ATTACHMENT]));

  render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );
  expect(observed.current).toEqual([ATTACHMENT]);
});

test("clearing after a successful send drops the pending list for good", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);

  const { unmount } = render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );
  observed.set([]);
  unmount();

  expect(
    window.sessionStorage.getItem(
      "deerflow.project-attachment.v2.user-1.thread-1",
    ),
  ).toBeNull();

  render(
    <StrictMode>
      <ComposerProbe threadId="thread-1" />
    </StrictMode>,
  );
  expect(observed.current).toEqual([]);
});

test("switching accounts on the same thread never displays or writes the previous owner's chips", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);
  const { rerender } = render(
    <ComposerProbe threadId="thread-1" userId="user-1" />,
  );
  expect(observed.current).toEqual([ATTACHMENT]);

  rerender(<ComposerProbe threadId="thread-1" userId="user-2" />);
  expect(observed.current).toEqual([]);
  observed.set([OTHER]);

  expect(
    window.sessionStorage.getItem(
      "deerflow.project-attachment.v2.user-1.thread-1",
    ),
  ).toBe(JSON.stringify([ATTACHMENT]));
  expect(
    window.sessionStorage.getItem(
      "deerflow.project-attachment.v2.user-2.thread-1",
    ),
  ).toBe(JSON.stringify([OTHER]));

  rerender(<ComposerProbe threadId="thread-1" userId="user-1" />);
  expect(observed.current).toEqual([ATTACHMENT]);
});
