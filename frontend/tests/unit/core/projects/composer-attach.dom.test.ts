import { afterEach, expect, test } from "@rstest/core";

import {
  readProjectAttachments,
  stageProjectAttachment,
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

afterEach(() => {
  window.sessionStorage.clear();
});

test("staged attachments append to the thread's pending list and never consume on read", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);
  stageProjectAttachment("user-1", "thread-1", OTHER);

  // A different thread sees nothing.
  expect(readProjectAttachments("user-1", "thread-2")).toEqual([]);

  // Read-only: repeated reads keep returning the pending entries — nothing
  // is consumed until submission or explicit removal.
  expect(readProjectAttachments("user-1", "thread-1")).toEqual([
    ATTACHMENT,
    OTHER,
  ]);
  expect(readProjectAttachments("user-1", "thread-1")).toEqual([
    ATTACHMENT,
    OTHER,
  ]);
});

test("re-staging the same document refreshes its entry instead of duplicating it", () => {
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);
  stageProjectAttachment("user-1", "thread-1", OTHER);
  const refreshed = { ...ATTACHMENT, size_bytes: 4096 };
  stageProjectAttachment("user-1", "thread-1", refreshed);

  expect(readProjectAttachments("user-1", "thread-1")).toEqual([
    OTHER,
    refreshed,
  ]);
});

test("a corrupt staged payload is dropped, not thrown", () => {
  window.sessionStorage.setItem(
    "deerflow.project-attachment.v2.user-1.thread-1",
    "{not json",
  );
  expect(readProjectAttachments("user-1", "thread-1")).toEqual([]);
  // The corrupt entry was cleared along the way.
  expect(
    window.sessionStorage.getItem(
      "deerflow.project-attachment.v2.user-1.thread-1",
    ),
  ).toBeNull();
});

test("a v2 single-object payload reads as a one-element list", () => {
  window.sessionStorage.setItem(
    "deerflow.project-attachment.v2.user-1.thread-1",
    JSON.stringify(ATTACHMENT),
  );

  expect(readProjectAttachments("user-1", "thread-1")).toEqual([ATTACHMENT]);
});

test("staged documents stay with their owner and ownerless legacy entries are ignored", () => {
  const legacyKey = "deerflow.project-attachment.thread-1";
  window.sessionStorage.setItem(legacyKey, JSON.stringify(OTHER));
  stageProjectAttachment("user-1", "thread-1", ATTACHMENT);

  expect(readProjectAttachments("user-2", "thread-1")).toEqual([]);
  expect(readProjectAttachments("user-1", "thread-1")).toEqual([ATTACHMENT]);
  expect(window.sessionStorage.getItem(legacyKey)).toBe(JSON.stringify(OTHER));
});
