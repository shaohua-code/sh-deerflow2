import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({ userId: "alice" }));

rs.mock("next/navigation", () => ({
  usePathname: () => "/workspace/chats/new",
}));
rs.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ setOpen: () => undefined }),
}));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: mocks.userId } }),
}));

import {
  ArtifactsProvider,
  useArtifacts,
} from "@/components/workspace/artifacts/context";

function ArtifactPanelProbe() {
  const { artifacts, setArtifacts } = useArtifacts();
  return (
    <>
      <p>{artifacts.join(",") || "没有产物"}</p>
      <button onClick={() => setArtifacts(["/mnt/user-data/outputs/alice.md"])}>
        添加 Alice 产物
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  mocks.userId = "alice";
});

describe("ArtifactsProvider account isolation", () => {
  it("does not migrate an ownerless old key or restore another account's paths", async () => {
    sessionStorage.setItem(
      "deerflow:artifacts:v1:%2Fworkspace%2Fchats%2Fnew",
      JSON.stringify({
        artifacts: ["/mnt/user-data/outputs/previous-account.md"],
        selectedArtifact: null,
        open: true,
      }),
    );

    const view = render(
      <ArtifactsProvider>
        <ArtifactPanelProbe />
      </ArtifactsProvider>,
    );
    expect(await screen.findByText("没有产物")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "添加 Alice 产物" }));
    expect(
      await screen.findByText("/mnt/user-data/outputs/alice.md"),
    ).toBeDefined();

    mocks.userId = "bob";
    view.rerender(
      <ArtifactsProvider>
        <ArtifactPanelProbe />
      </ArtifactsProvider>,
    );
    await waitFor(() => expect(screen.getByText("没有产物")).toBeDefined());
    expect(screen.queryByText("/mnt/user-data/outputs/alice.md")).toBeNull();
    const bobState = JSON.parse(
      sessionStorage.getItem(
        "deerflow:artifacts:v2:bob:%2Fworkspace%2Fchats%2Fnew",
      ) ?? "{}",
    ) as { artifacts?: string[] };
    expect(bobState.artifacts).toEqual([]);
    expect(
      sessionStorage.getItem(
        "deerflow:artifacts:v1:%2Fworkspace%2Fchats%2Fnew",
      ),
    ).toContain("previous-account.md");

    mocks.userId = "alice";
    view.rerender(
      <ArtifactsProvider>
        <ArtifactPanelProbe />
      </ArtifactsProvider>,
    );
    expect(
      await screen.findByText("/mnt/user-data/outputs/alice.md"),
    ).toBeDefined();
  });
});
