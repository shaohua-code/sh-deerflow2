import { describe, expect, it } from "@rstest/core";

import {
  canManageChannelRuntime,
  canReadChannels,
  canWriteChannels,
} from "@/core/channels/permissions";

describe("channel permission mapping", () => {
  it("preserves unresolved permission compatibility for reads and writes", () => {
    expect(canReadChannels({})).toBe(true);
    expect(canWriteChannels(null)).toBe(true);
  });

  it("blocks channel reads and writes only after explicit denial", () => {
    const user = { permissions: ["channels:read"] };

    expect(canReadChannels(user)).toBe(true);
    expect(canWriteChannels(user)).toBe(false);
  });

  it("requires both channels:admin and the system administrator role", () => {
    expect(
      canManageChannelRuntime({
        system_role: "admin",
        permissions: ["channels:read", "channels:admin"],
      }),
    ).toBe(true);
    expect(
      canManageChannelRuntime({
        system_role: "user",
        permissions: ["channels:admin"],
      }),
    ).toBe(false);
    expect(
      canManageChannelRuntime({
        system_role: "admin",
        permissions: ["channels:read"],
      }),
    ).toBe(false);
  });
});
