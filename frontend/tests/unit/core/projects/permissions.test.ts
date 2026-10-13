import { describe, expect, it } from "@rstest/core";

import { getProjectPermissionAccess } from "@/core/projects/permissions";

describe("project route permission mapping", () => {
  it("maps create, chat, document, and lifecycle permissions independently", () => {
    const access = getProjectPermissionAccess({
      permissions: ["projects:read", "projects:write", "threads:read"],
    });

    expect(access.canCreateProject).toBe(true);
    expect(access.canReadProjectThreads).toBe(true);
    expect(access.canUploadProjectDocument).toBe(true);
    expect(access.canPromoteThreadFile).toBe(true);
    expect(access.canDeleteProjectDocument).toBe(false);
    expect(access.canAttachProjectDocument).toBe(false);
    expect(access.canCreateProjectChat).toBe(false);
  });

  it("preserves compatibility while the permission list is unresolved", () => {
    const access = getProjectPermissionAccess({ permissions: null });

    expect(access.canCreateProject).toBe(true);
    expect(access.canDeleteProjectDocument).toBe(true);
    expect(access.canAttachProjectDocument).toBe(true);
    expect(access.canCreateProjectChat).toBe(true);
  });
});
