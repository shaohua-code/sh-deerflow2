import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({
  authUser: {
    id: "user-1",
    system_role: "admin" as "admin" | "user",
    permissions: null as string[] | null,
  },
  query: {
    skills: [] as unknown[],
    hasData: false,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    refetch: rs.fn(),
  },
  useSkills: rs.fn(),
  enable: rs.fn(),
  enablePending: false,
  enableVariables: undefined as
    | { skillName: string; enabled: boolean }
    | undefined,
  upload: rs.fn(),
  push: rs.fn(),
  toastError: rs.fn(),
  toastSuccess: rs.fn(),
}));

rs.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
rs.mock("next/dynamic", () => ({ default: () => () => null }));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.authUser }),
}));
rs.mock("@/core/skills/hooks", () => ({
  useSkills: mocks.useSkills,
  useEnableSkill: () => ({
    isPending: mocks.enablePending,
    variables: mocks.enableVariables,
    mutate: mocks.enable,
  }),
  useUploadSkillArchive: () => ({
    isPending: false,
    mutateAsync: mocks.upload,
  }),
}));
rs.mock("@/env", () => ({ env: { NEXT_PUBLIC_STATIC_WEBSITE_ONLY: "false" } }));
rs.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { SkillGallery } from "@/components/workspace/capabilities/skill-gallery";
import { I18nProvider } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { SkillRequestError } from "@/core/skills/api";

const skill = {
  name: "research",
  description: "Research a topic.",
  category: "public",
  license: "MIT",
  enabled: true,
  editable: false,
};

function renderGallery(locale: "en-US" | "zh-CN") {
  // I18nProvider hydrates the locale from the same cookie used by the app.
  document.cookie = `locale=${locale}; path=/`;
  mocks.useSkills.mockReturnValue(mocks.query);
  return render(
    <I18nProvider initialLocale={locale}>
      <SkillGallery />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.authUser.system_role = "admin";
  mocks.authUser.permissions = null;
  mocks.query.skills = [];
  mocks.query.hasData = false;
  mocks.query.isLoading = false;
  mocks.query.isFetching = false;
  mocks.query.error = null;
  mocks.query.refetch.mockReset();
  mocks.useSkills.mockReset();
  mocks.enable.mockReset();
  mocks.enablePending = false;
  mocks.enableVariables = undefined;
  mocks.upload.mockReset();
  mocks.push.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  document.cookie = "locale=; Max-Age=0; path=/";
});

describe("SkillGallery error states", () => {
  it("hides cached skills and disables the query after skills:read is denied", () => {
    mocks.query.skills = [skill];
    mocks.query.hasData = true;
    mocks.authUser.permissions = ["skills:write", "skills:admin"];

    renderGallery("en-US");

    expect(screen.getByRole("status").textContent).toContain("skills:read");
    expect(screen.queryByText(skill.name)).toBeNull();
    expect(mocks.useSkills).toHaveBeenCalledWith(false);
  });

  it("disables skill creation when runs:create is denied", () => {
    mocks.query.skills = [skill];
    mocks.query.hasData = true;
    mocks.authUser.permissions = ["skills:read"];

    renderGallery("en-US");

    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent?.includes("runs:create")),
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: enUS.settings.skills.createSkill,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: enUS.settings.skills.createSkill }),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("explains the existing administrator requirement to regular users", () => {
    mocks.query.skills = [skill];
    mocks.query.hasData = true;
    mocks.authUser.system_role = "user";
    renderGallery("en-US");

    expect(screen.getByRole("status").textContent).toContain(
      enUS.settings.skills.adminRequired,
    );
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("disables shared skill toggles after an explicit skills:admin denial", () => {
    mocks.query.skills = [skill];
    mocks.query.hasData = true;
    mocks.authUser.permissions = ["skills:read", "skills:write"];
    renderGallery("en-US");

    expect(screen.getByRole("status").textContent).toContain(
      enUS.settings.skills.adminRequired,
    );
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("disables archive upload after an explicit skills:write denial", () => {
    mocks.query.hasData = true;
    mocks.authUser.permissions = ["skills:read", "skills:admin"];
    renderGallery("en-US");

    expect(screen.getByRole("status").textContent).toContain(
      enUS.settings.skills.adminRequired,
    );
    expect(
      (
        screen.getByRole("button", {
          name: enUS.settings.skills.installFromFile,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("localizes an initial read failure and retries without exposing server detail", () => {
    mocks.query.error = new Error("private gateway/database detail");
    renderGallery("zh-CN");

    expect(screen.getByRole("alert").textContent).toContain(
      zhCN.settings.skills.loadFailed,
    );
    expect(screen.queryByText(/private gateway/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: zhCN.settings.skills.retry }),
    );
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps cached skills visible after a refresh error", () => {
    mocks.query.skills = [skill];
    mocks.query.hasData = true;
    mocks.query.error = new Error("private refresh detail");
    renderGallery("en-US");

    expect(screen.getByRole("status").textContent).toContain(
      enUS.settings.skills.refreshFailed,
    );
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText(/private refresh detail/)).toBeNull();
  });

  it("uses localized copy when enabling a skill fails", () => {
    mocks.query.skills = [skill];
    mocks.query.hasData = true;
    mocks.enable.mockImplementation(
      (_variables: unknown, options: { onError: (error: Error) => void }) =>
        options.onError(new Error("private skill service detail")),
    );
    renderGallery("en-US");

    fireEvent.click(screen.getByRole("switch"));

    expect(mocks.toastError).toHaveBeenCalledWith(
      enUS.settings.skills.enableFailed,
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "private skill service detail",
    );
  });

  it("identifies the skill whose state update is pending", () => {
    mocks.query.skills = [skill];
    mocks.query.hasData = true;
    mocks.enablePending = true;
    mocks.enableVariables = { skillName: skill.name, enabled: false };
    renderGallery("en-US");

    expect(screen.getByRole("status").textContent).toContain(
      enUS.common.loading,
    );
    expect(screen.getByRole("switch").getAttribute("aria-busy")).toBe("true");
  });

  it("uses localized copy for installation failures", async () => {
    mocks.query.hasData = true;
    mocks.upload.mockRejectedValue(new Error("private proxy response"));
    const { container } = renderGallery("en-US");
    const fileInput = container.querySelector('input[type="file"]');
    if (!fileInput) throw new Error("Expected the skill archive input");

    fireEvent.change(fileInput, {
      target: { files: [new File(["skill"], "demo.skill")] },
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        enUS.settings.skills.installFailed,
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith("private proxy response");
  });

  it("retains structured security findings with a localized blocked title", async () => {
    mocks.query.hasData = true;
    mocks.upload.mockRejectedValue(
      new SkillRequestError(422, "private scanner response", {
        findings: [
          {
            rule_id: "unsafe_command",
            severity: "error",
            file: "SKILL.md",
            line: 3,
            message: "Remove the unsafe command",
            remediation: "Use an approved tool instead.",
          },
        ],
      }),
    );
    const { container } = renderGallery("en-US");
    const fileInput = container.querySelector('input[type="file"]');
    if (!fileInput) throw new Error("Expected the skill archive input");

    fireEvent.change(fileInput, {
      target: { files: [new File(["skill"], "demo.skill")] },
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        enUS.settings.skills.installBlocked,
        expect.objectContaining({
          description: expect.anything(),
        }),
      ),
    );
    const details = mocks.toastError.mock.calls[0]?.[1]?.description;
    expect(details.props.children).toContain("unsafe_command");
    expect(details.props.children).toContain("SKILL.md:3");
  });
});
