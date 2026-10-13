import { describe, expect, it } from "@rstest/core";

import {
  getChatSubmissionBlock,
  getMissingPermissions,
  getPermissionState,
  hasPermission,
  PERMISSIONS,
} from "@/core/auth/permissions";
import { userSchema } from "@/core/auth/types";

describe("hasPermission", () => {
  it("grants a permission present in the resolved list", () => {
    expect(
      hasPermission(
        { permissions: ["threads:read", "threads:delete"] },
        PERMISSIONS.THREADS_DELETE,
      ),
    ).toBe(true);
  });

  it("denies a permission absent from the resolved list", () => {
    expect(
      hasPermission(
        { permissions: ["threads:read"] },
        PERMISSIONS.THREADS_DELETE,
      ),
    ).toBe(false);
  });

  it("treats an absent permissions field as permissive (pre-Phase-4 backend)", () => {
    // A mixed old-backend/new-frontend deploy must not hide actions the
    // caller can still perform — the Gateway route guards stay the
    // enforcement point, the UI field is advisory only.
    expect(hasPermission({}, PERMISSIONS.RUNS_CANCEL)).toBe(true);
  });

  it("treats a null permissions field as permissive", () => {
    // Credential-creation responses (register/initialize) serialize null;
    // they never advertise an empty grant set.
    expect(hasPermission({ permissions: null }, PERMISSIONS.RUNS_CANCEL)).toBe(
      true,
    );
  });

  it("treats a not-yet-loaded user as permissive", () => {
    expect(hasPermission(null, PERMISSIONS.THREADS_DELETE)).toBe(true);
    expect(hasPermission(undefined, PERMISSIONS.THREADS_DELETE)).toBe(true);
  });
});

describe("getPermissionState", () => {
  it("distinguishes a granted permission from an explicit deny", () => {
    expect(
      getPermissionState(
        { permissions: ["threads:read", "threads:delete"] },
        PERMISSIONS.THREADS_DELETE,
      ),
    ).toBe("granted");
    expect(
      getPermissionState(
        { permissions: ["threads:read"] },
        PERMISSIONS.THREADS_DELETE,
      ),
    ).toBe("denied");
  });

  it("keeps absent, unresolved, or not-yet-loaded permissions distinct", () => {
    expect(getPermissionState({}, PERMISSIONS.RUNS_CANCEL)).toBe("unresolved");
    expect(
      getPermissionState({ permissions: null }, PERMISSIONS.RUNS_CANCEL),
    ).toBe("unresolved");
    expect(getPermissionState(null, PERMISSIONS.RUNS_CANCEL)).toBe(
      "unresolved",
    );
  });
});

describe("getMissingPermissions", () => {
  it("lists only explicitly denied permissions", () => {
    expect(
      getMissingPermissions({ permissions: ["agents:read", "runs:create"] }, [
        PERMISSIONS.AGENTS_READ,
        PERMISSIONS.AGENTS_WRITE,
        PERMISSIONS.RUNS_CREATE,
      ]),
    ).toEqual([PERMISSIONS.AGENTS_WRITE]);
  });

  it("keeps unresolved permissions compatible with an older Gateway", () => {
    expect(getMissingPermissions({}, [PERMISSIONS.AGENTS_WRITE])).toEqual([]);
  });
});

describe("getChatSubmissionBlock", () => {
  it("blocks sends when runs:create is explicitly denied", () => {
    expect(getChatSubmissionBlock({ permissions: ["threads:read"] })).toBe(
      "run",
    );
  });

  it("requires threads:write only before a project-scoped first send", () => {
    const user = { permissions: ["runs:create", "threads:read"] };

    expect(getChatSubmissionBlock(user)).toBeNull();
    expect(getChatSubmissionBlock(user, { requiresThreadWrite: true })).toBe(
      "thread",
    );
  });

  it("keeps unresolved permissions compatible with older Gateway responses", () => {
    expect(getChatSubmissionBlock({})).toBeNull();
    expect(getChatSubmissionBlock(null, { requiresThreadWrite: true })).toBe(
      null,
    );
  });
});

describe("frontend permission catalog", () => {
  it("tracks the Gateway route-permission vocabulary", () => {
    expect(Object.values(PERMISSIONS)).toEqual([
      "threads:read",
      "threads:write",
      "threads:delete",
      "runs:create",
      "runs:read",
      "runs:cancel",
      "projects:read",
      "projects:write",
      "projects:delete",
      "memory:read",
      "memory:write",
      "memory:delete",
      "memory:admin",
      "preferences:read",
      "preferences:write",
      "agents:read",
      "agents:write",
      "agents:delete",
      "agents:admin",
      "channels:read",
      "channels:write",
      "channels:admin",
      "integrations:read",
      "integrations:write",
      "integrations:admin",
      "skills:read",
      "skills:write",
      "skills:delete",
      "skills:admin",
      "subagents:read",
      "subagents:admin",
      "mcp:admin",
    ]);
  });
});

describe("userSchema permissions field", () => {
  const baseUser = {
    id: "user-1",
    email: "user@example.test",
    system_role: "user" as const,
  };

  it("parses a /me payload that carries effective permissions", () => {
    const parsed = userSchema.parse({
      ...baseUser,
      permissions: ["threads:read", "runs:cancel"],
    });
    expect(parsed.permissions).toEqual(["threads:read", "runs:cancel"]);
  });

  it("parses a /me payload from a pre-Phase-4 backend (field absent)", () => {
    const parsed = userSchema.parse(baseUser);
    expect(parsed.permissions).toBeUndefined();
  });

  it("parses a credential-creation payload that carries null", () => {
    const parsed = userSchema.parse({ ...baseUser, permissions: null });
    expect(parsed.permissions).toBeNull();
  });
});
