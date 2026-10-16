import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { GatewayOfflineBanner } from "@/components/workspace/gateway-offline-banner";
import { AuthProvider, useAuth } from "@/core/auth/AuthProvider";
import { PERMISSIONS, getPermissionState } from "@/core/auth/permissions";
import type { User } from "@/core/auth/types";

const mocks = rs.hoisted(() => ({ push: rs.fn() }));

// AuthProvider pulls useRouter/usePathname from next/navigation. Hand it a
// no-op router so logout()'s `router.push("/")` stays inert under happy-dom
// instead of trying to drive a real Next.js router.
rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: rs.fn(), refresh: rs.fn() }),
  usePathname: () => "/workspace",
}));

// Force the SPA (non-static) branch of AuthProvider.logout — that is the
// branch that actually performs the POST that issue #3001 is about. The
// static branch would short-circuit into a `router.push("/")` and never
// touch the network, masking the very regression we need to lock down.
rs.mock("@/core/static-mode", () => ({
  isStaticWebsiteOnly: () => false,
}));

// Keep the banner's i18n lookup hermetic — real translations are not
// relevant here, we just need a stable accessible name for the button.
rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "en-US",
    t: {
      workspace: {
        logout: "Log out",
        gatewayUnavailable: "Gateway unavailable.",
        gatewayUnavailableRetrying: "Retrying…",
        gatewayRetry: "Retry now",
        gatewayRetrying: "Retrying now…",
      },
    },
    changeLocale: rs.fn(),
  }),
}));

afterEach(() => {
  rs.restoreAllMocks();
  mocks.push.mockClear();
  cleanup();
});

const signedInUser: User = {
  id: "user-1",
  email: "user@example.com",
  system_role: "user",
  needs_setup: false,
  permissions: [PERMISSIONS.AGENTS_READ],
};

function AuthRefreshProbe() {
  const { user, authRefreshUnavailable, refreshUser } = useAuth();
  const agentPermission = getPermissionState(user, PERMISSIONS.AGENTS_READ);
  return (
    <>
      <div data-testid="auth-refresh-state">
        {`${user?.email ?? "signed-out"}|${agentPermission}|${authRefreshUnavailable}`}
      </div>
      <button type="button" onClick={() => void refreshUser()}>
        Refresh account
      </button>
    </>
  );
}

function renderAuthRefreshProbe({ withBanner = false } = {}) {
  return render(
    <AuthProvider initialUser={signedInUser}>
      {withBanner && <GatewayOfflineBanner gatewayUnavailable={false} />}
      <AuthRefreshProbe />
    </AuthProvider>,
  );
}

/**
 * Install a fetch double that keeps the gateway "unavailable" for the
 * banner's `/auth/me` probe (so the banner stays mounted and the recovery
 * button stays actionable) while recording every call so the logout
 * request can be inspected. Returns the captured calls for assertions.
 */
function installFetch(): Array<{ url: string; method: string }> {
  const calls: Array<{ url: string; method: string }> = [];
  rs.spyOn(globalThis, "fetch").mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      // `input` may be a Request object whose default stringification would
      // yield "[object Request]" — normalise to the URL string either way.
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (url.includes("/auth/logout")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "Successfully logged out" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      // `/auth/me` probe — return a transient failure so `classifyProbe`
      // yields "transient" and the banner keeps showing the logout button.
      return Promise.resolve(
        new Response("service unavailable", { status: 503 }),
      );
    },
  );
  return calls;
}

function renderBanner() {
  return render(
    <AuthProvider initialUser={null}>
      <GatewayOfflineBanner gatewayUnavailable />
    </AuthProvider>,
  );
}

describe("GatewayOfflineBanner logout recovery (#3001)", () => {
  it("refreshes server permissions when the visible window regains focus", async () => {
    const revokedUser: User = { ...signedInUser, permissions: [] };
    const fetchSpy = rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(revokedUser), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderAuthRefreshProbe();

    expect(screen.getByTestId("auth-refresh-state").textContent).toBe(
      "user@example.com|granted|false",
    );
    fireEvent.focus(window);
    // Browsers can emit focus and visibilitychange together when returning
    // to a tab; the shared throttle must keep that to one /auth/me request.
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(screen.getByTestId("auth-refresh-state").textContent).toBe(
        "user@example.com|denied|false",
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/auth/me", {
      credentials: "include",
    });
  });

  it("lets a user retry the gateway probe immediately and clears the banner on recovery", async () => {
    let probeCalls = 0;
    let finishRecovery: ((response: Response) => void) | undefined;
    rs.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (!url.includes("/auth/me")) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }

      probeCalls += 1;
      if (probeCalls === 1) {
        return Promise.resolve(
          new Response("service unavailable", { status: 503 }),
        );
      }
      if (probeCalls === 2) {
        return new Promise((resolve) => {
          finishRecovery = resolve;
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify(signedInUser), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    renderBanner();

    const retry = await screen.findByRole("button", { name: "Retry now" });
    await waitFor(() => expect(probeCalls).toBe(1));
    await waitFor(() =>
      expect((retry as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(retry);

    await waitFor(() => expect(probeCalls).toBe(2));
    await waitFor(() =>
      expect((retry as HTMLButtonElement).disabled).toBe(true),
    );
    expect(retry.textContent).toBe("Retrying now…");
    if (!finishRecovery) {
      throw new Error("expected the manual recovery request to be pending");
    }
    finishRecovery(
      new Response(JSON.stringify(signedInUser), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("renders a <button> (not a GET-style link) as the logout affordance", async () => {
    installFetch();
    renderBanner();

    // The recovery control must be a <button>, not an <a>/<Link> whose
    // browser navigation would turn into a GET against the POST-only
    // /auth/logout endpoint — the exact 405 reported in #3001.
    const logout = await screen.findByRole("button", { name: /log out/i });
    expect(logout.tagName).toBe("BUTTON");
    expect(logout.hasAttribute("href")).toBe(false);
  });

  it("issues a POST (never a GET) to /api/v1/auth/logout when clicked", async () => {
    const calls = installFetch();
    renderBanner();

    fireEvent.click(await screen.findByRole("button", { name: /log out/i }));

    const logoutCall = await waitFor(() => {
      const logoutCalls = calls.filter((c) => c.url.includes("/auth/logout"));
      expect(logoutCalls).toHaveLength(1);
      const call = logoutCalls[0];
      if (!call) {
        throw new Error("expected exactly one /auth/logout call");
      }
      return call;
    });

    expect(logoutCall.url).toBe("/api/v1/auth/logout");
    expect(logoutCall.method).toBe("POST");
    // Lock down the regression documented in #3001: a GET against this
    // POST-only endpoint returns 405 and fails to clear the session.
    expect(logoutCall.method).not.toBe("GET");
  });

  it("keeps the signed-in identity but fails closed and shows recovery feedback on 503", async () => {
    rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("service unavailable", { status: 503 }),
    );
    renderAuthRefreshProbe({ withBanner: true });

    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));

    await waitFor(() => {
      expect(screen.getByTestId("auth-refresh-state").textContent).toBe(
        "user@example.com|denied|true",
      );
    });
    expect(screen.getByRole("status").textContent).toContain(
      "Gateway unavailable.",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps identity and fails closed when the auth request cannot connect", async () => {
    rs.spyOn(console, "error").mockImplementation(() => {});
    rs.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderAuthRefreshProbe({ withBanner: true });

    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));

    await waitFor(() => {
      expect(screen.getByTestId("auth-refresh-state").textContent).toBe(
        "user@example.com|denied|true",
      );
    });
    expect(screen.getByRole("status").textContent).toContain(
      "Gateway unavailable.",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("restores server permissions after a later successful refresh", async () => {
    rs.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(signedInUser), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    renderAuthRefreshProbe();

    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));
    await waitFor(() => {
      expect(screen.getByTestId("auth-refresh-state").textContent).toBe(
        "user@example.com|denied|true",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));
    await waitFor(() => {
      expect(screen.getByTestId("auth-refresh-state").textContent).toBe(
        "user@example.com|granted|false",
      );
    });
  });

  it("still clears identity and redirects for an actual 401", async () => {
    rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    renderAuthRefreshProbe();

    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));

    await waitFor(() => {
      expect(screen.getByTestId("auth-refresh-state").textContent).toBe(
        "signed-out|unresolved|false",
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/login?next=%2Fworkspace");
  });
});
