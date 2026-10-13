import { describe, expect, it } from "@rstest/core";

import { buildThreadShareUrl } from "@/product/thread-share-url";

describe("buildThreadShareUrl", () => {
  it("keeps localhost shares inside the local Flow Desk instance", () => {
    expect(
      buildThreadShareUrl(
        "http://localhost:3000",
        "/workspace/chats/thread-123",
      ),
    ).toBe("http://localhost:3000/workspace/chats/thread-123");
  });

  it("uses the deployed Flow Desk origin", () => {
    expect(
      buildThreadShareUrl(
        "https://desk.example.com",
        "/workspace/chats/thread-123",
      ),
    ).toBe("https://desk.example.com/workspace/chats/thread-123");
  });

  it("rejects a link that escapes the current instance", () => {
    expect(() =>
      buildThreadShareUrl(
        "https://desk.example.com",
        "https://deer-flow-v2.vercel.app/workspace/chats/thread-123",
      ),
    ).toThrow("Thread share paths must stay on the current instance");
  });
});
