import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";

import {
  SidecarProvider,
  useSidecar,
} from "@/components/workspace/sidecar/context";
import { AuthProvider, useAuth } from "@/core/auth/AuthProvider";
import type { User } from "@/core/auth/types";
import { DEFAULT_LOCALE } from "@/core/i18n";
import { I18nProvider } from "@/core/i18n/context";

const mocks = rs.hoisted(() => ({
  findLatestSidecarThread: rs.fn(),
}));

rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn(), replace: rs.fn(), refresh: rs.fn() }),
  usePathname: () => "/workspace",
  useSearchParams: () => new URLSearchParams(),
}));

rs.mock("@/core/sidecar/api", () => ({
  findLatestSidecarThread: mocks.findLatestSidecarThread,
  createSidecarThread: rs.fn(),
}));

function makeUser(permissions: string[] | null | undefined): User {
  return {
    id: "user-1",
    email: "user@example.test",
    system_role: "user",
    needs_setup: false,
    oauth_provider: null,
    ...(permissions === undefined ? {} : { permissions }),
  } as User;
}

/** Invokes the provider's restore probe once mounted so assertions observe
 * the exact call the mount effect and the trigger both rely on. */
function RestoreProbe() {
  const sidecar = useSidecar();
  useEffect(() => {
    void sidecar.restoreSidecarThread({ force: true });
  }, [sidecar]);
  return null;
}

/** Replaces the authenticated user in place via the auth context. */
function FlipUserProbe({ to }: { to: User }) {
  const { applyUser } = useAuth();
  useEffect(() => {
    applyUser(to);
  }, [applyUser, to]);
  return null;
}

function buildTree(
  initialUser: User,
  { withFlip = false, flipTo = makeUser(["threads:read"]) } = {},
): ReactNode {
  return (
    <I18nProvider initialLocale={DEFAULT_LOCALE}>
      <AuthProvider initialUser={initialUser}>
        {withFlip && <FlipUserProbe to={flipTo} />}
        <SidecarProvider
          parentThreadId="parent-1"
          isMock
          context={{ thread_id: "parent-1" } as never}
        >
          <RestoreProbe />
        </SidecarProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

afterEach(() => {
  rs.restoreAllMocks();
  mocks.findLatestSidecarThread.mockReset();
  cleanup();
});

describe("sidecar restore permission gating", () => {
  it("does not probe threads.search when threads:read is explicitly denied", async () => {
    render(buildTree(makeUser(["threads:write"])));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.findLatestSidecarThread).not.toHaveBeenCalled();
  });

  it("still probes for unresolved legacy permission snapshots", async () => {
    mocks.findLatestSidecarThread.mockResolvedValue(null);
    render(buildTree(makeUser(undefined)));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.findLatestSidecarThread).toHaveBeenCalledTimes(1);
    expect(mocks.findLatestSidecarThread).toHaveBeenCalledWith(
      expect.objectContaining({ parentThreadId: "parent-1", isMock: true }),
    );
  });

  it("probes again once the read grant is restored after a denial", async () => {
    mocks.findLatestSidecarThread.mockResolvedValue(null);
    const { rerender } = render(buildTree(makeUser([])));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.findLatestSidecarThread).not.toHaveBeenCalled();

    rerender(
      buildTree(makeUser([]), {
        withFlip: true,
        flipTo: makeUser(["threads:read", "threads:write"]),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.findLatestSidecarThread).toHaveBeenCalledTimes(1);
  });
});
