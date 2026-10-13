import { afterEach, describe, expect, it, rs } from "@rstest/core";

const mocks = rs.hoisted(() => ({
  fetch: rs.fn(),
}));

rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));
rs.mock("@/core/config", () => ({ getBackendBaseURL: () => "http://gateway" }));

import {
  clearMemory,
  createMemoryFact,
  deleteMemoryFact,
  exportMemory,
  importMemory,
  loadMemory,
  updateMemoryFact,
} from "@/core/memory/api";
import type { UserMemory } from "@/core/memory/types";

const memory = {
  version: "1",
  lastUpdated: "2026-10-13T00:00:00Z",
  user: {
    workContext: { summary: "", updatedAt: "" },
    personalContext: { summary: "", updatedAt: "" },
    topOfMind: { summary: "", updatedAt: "" },
  },
  history: {
    recentMonths: { summary: "", updatedAt: "" },
    earlierContext: { summary: "", updatedAt: "" },
    longTermBackground: { summary: "", updatedAt: "" },
  },
  facts: [],
} satisfies UserMemory;

afterEach(() => {
  mocks.fetch.mockReset();
});

describe("memory API account fencing", () => {
  it("sends the expected owner on every browser read and write", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      statusText: "OK",
      json: async () => memory,
    } as Response);

    await loadMemory("alice");
    await clearMemory("alice");
    await deleteMemoryFact("fact-1", "alice");
    await exportMemory("alice");
    await importMemory(memory, "alice");
    await createMemoryFact(
      { content: "private fact", category: "context", confidence: 0.8 },
      "alice",
    );
    await updateMemoryFact("fact-1", { content: "updated fact" }, "alice");

    expect(mocks.fetch).toHaveBeenCalledTimes(7);
    for (const [, init] of mocks.fetch.mock.calls) {
      expect(new Headers(init?.headers).get("X-Expected-User-Id")).toBe(
        "alice",
      );
    }
  });
});
