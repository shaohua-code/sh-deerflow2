import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({
  fetchSettings: rs.fn(),
  saveSetting: rs.fn(),
  deleteSetting: rs.fn(),
  fetchJobs: rs.fn(),
  createExport: rs.fn(),
  createDeletion: rs.fn(),
  cancelJob: rs.fn(),
  downloadArtifact: rs.fn(),
  fetchCapabilities: rs.fn(),
  staticMode: false,
}));
const auth = rs.hoisted(() => ({
  userId: "user-1",
  permissions: null as string[] | null,
}));

rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () =>
    auth.userId
      ? { user: { id: auth.userId, permissions: auth.permissions } }
      : { user: null },
}));

rs.mock("@/core/static-mode", () => ({
  isStaticWebsiteOnly: () => mocks.staticMode,
}));

rs.mock("@/product/api", () => {
  class ProductSettingsApiError extends Error {
    constructor(readonly status: number) {
      super("Unable to load personal settings (" + status + ")");
      this.name = "ProductSettingsApiError";
    }
  }
  class ProductDataJobsApiError extends Error {
    constructor(readonly status: number) {
      super("Unable to load preference jobs (" + status + ")");
      this.name = "ProductDataJobsApiError";
    }
  }
  return {
    fetchProductSettings: mocks.fetchSettings,
    saveProductSetting: mocks.saveSetting,
    deleteProductSetting: mocks.deleteSetting,
    fetchProductDataJobs: mocks.fetchJobs,
    createProductDataExport: mocks.createExport,
    createProductDataDeletion: mocks.createDeletion,
    cancelProductDataJob: mocks.cancelJob,
    downloadProductDataJobArtifact: mocks.downloadArtifact,
    fetchProductDataCapabilities: mocks.fetchCapabilities,
    ProductSettingsApiError,
    ProductDataJobsApiError,
  };
});

import { ProductPreferencesPage } from "@/components/workspace/settings/product-preferences-page";
import { I18nProvider } from "@/core/i18n/context";
import {
  ProductDataJobsApiError,
  ProductSettingsApiError,
  type ProductDataCapabilities,
} from "@/product/api";
import { PRODUCT_DATA_CAPABILITIES_QUERY_KEY } from "@/product/hooks";

const emptyJobs = { api_version: 1 as const, jobs: [], limit: 20, offset: 0 };
const allCapabilities: ProductDataCapabilities = {
  api_version: 1,
  deletion_scopes: {
    preferences: true,
    memory: true,
    files: true,
    threads: true,
    projects: true,
    agents: true,
    scheduled_tasks: true,
  },
};
const queuedExport = {
  job_id: "123e4567-e89b-12d3-a456-426614174000",
  kind: "export" as const,
  scope: ["preferences"] as ["preferences"],
  status: "queued" as const,
  progress: { stage: "queued", completed: 0, total: 0 },
  result: null,
  error_code: null,
  attempt: 0,
  max_attempts: 3,
  cancel_requested: false,
  request_id: null,
  created_at: "2026-09-28T09:00:00Z",
  updated_at: "2026-09-28T09:00:00Z",
};

function Wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en-US">{children}</I18nProvider>
    </QueryClientProvider>
  );
}

function renderWithClient(
  locale: "zh-CN" | "en-US" = "en-US",
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  }),
) {
  const view = render(<ProductPreferencesPage />, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </QueryClientProvider>
    ),
  });
  return { ...view, client };
}

beforeEach(() => {
  window.sessionStorage.clear();
  auth.userId = "user-1";
  auth.permissions = null;
  mocks.staticMode = false;
  mocks.fetchCapabilities.mockResolvedValue(allCapabilities);
  mocks.fetchSettings.mockResolvedValue({ api_version: 1, settings: [] });
  mocks.saveSetting.mockResolvedValue(undefined);
  mocks.deleteSetting.mockResolvedValue(undefined);
  mocks.fetchJobs.mockResolvedValue(emptyJobs);
  mocks.createExport.mockResolvedValue(queuedExport);
  mocks.createDeletion.mockResolvedValue({ ...queuedExport, kind: "deletion" });
  mocks.cancelJob.mockResolvedValue({ ...queuedExport, status: "cancelled" });
  mocks.downloadArtifact.mockResolvedValue(new Blob(["{}"]));
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  auth.userId = "user-1";
  auth.permissions = null;
  rs.clearAllMocks();
  rs.restoreAllMocks();
});

describe("ProductPreferencesPage data tasks", () => {
  it("stops preference reads and hides cached values without preferences:read", async () => {
    auth.permissions = ["preferences:write"];
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    client.setQueryData(["product", "settings", "user-1"], {
      api_version: 1,
      settings: [{ key: "workspace.display", value: "compact" }],
    });

    renderWithClient("en-US", client);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "preferences:read",
    );
    expect(mocks.fetchSettings).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("combobox", { name: "Content density" }),
    ).toBeNull();
    await waitFor(() =>
      expect(client.getQueryData(["product", "settings", "user-1"])).toBe(
        undefined,
      ),
    );
  });

  it("keeps personal settings read-only without preferences:write", async () => {
    auth.permissions = ["preferences:read"];
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const densitySelector = await screen.findByRole("combobox", {
      name: "Content density",
    });
    const saveButton = await screen.findByRole("button", {
      name: "Save preferences",
    });

    expect(densitySelector.hasAttribute("disabled")).toBe(true);
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/preferences:write/)).toBeDefined();
    fireEvent.click(saveButton);
    expect(mocks.saveSetting).not.toHaveBeenCalled();
  });

  it("only opens confirmations for the supported deletion scopes", async () => {
    mocks.fetchCapabilities.mockResolvedValue({
      ...allCapabilities,
      deletion_scopes: {
        preferences: true,
        memory: false,
        files: false,
        threads: false,
        projects: false,
        agents: false,
        scheduled_tasks: false,
      },
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });
    const preferences = screen.getByRole("button", {
      name: "Delete saved preferences",
    });
    await waitFor(() =>
      expect(preferences.hasAttribute("disabled")).toBe(false),
    );
    const region = screen.getByRole("region", { name: "Clear personal data" });
    const unsupported = within(region).getByRole("button", {
      name: "Clear personal memory",
    });
    expect(unsupported.hasAttribute("disabled")).toBe(true);
    expect(
      document.getElementById(
        unsupported.getAttribute("aria-describedby") ?? "",
      )?.textContent,
    ).toBe("This service does not currently support clearing this category.");
    expect(
      within(region)
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("disabled")),
    ).toHaveLength(6);
    fireEvent.click(unsupported);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(preferences);
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(mocks.createDeletion).not.toHaveBeenCalled();
  });

  it("blocks unknown deletion capabilities while keeping exports available", async () => {
    mocks.fetchCapabilities.mockReturnValue(new Promise(() => undefined));
    render(<ProductPreferencesPage />, { wrapper: Wrapper });
    expect(
      screen.getByText("Checking which data can be cleared…"),
    ).toBeDefined();
    const region = screen.getByRole("region", { name: "Clear personal data" });
    expect(
      within(region)
        .getAllByRole("button")
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    const exportButton = screen.getByRole("button", {
      name: "Export preferences",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);
    await waitFor(() => expect(mocks.createExport).toHaveBeenCalled());
    expect(mocks.createDeletion).not.toHaveBeenCalled();
  });

  it.each([
    {
      locale: "en-US" as const,
      error:
        "Could not confirm which data can be cleared. Please retry. Exports remain available.",
      retry: "Check clearing availability again",
      deletion: "Delete saved preferences",
    },
    {
      locale: "zh-CN" as const,
      error: "暂时无法确认可清理的数据范围，请重试。导出仍可使用。",
      retry: "重新检查清理能力",
      deletion: "删除已保存的偏好",
    },
  ])(
    "provides safe capability recovery in $locale",
    async ({ locale, error, retry, deletion }) => {
      mocks.fetchCapabilities.mockRejectedValueOnce(
        new Error("private-backend-details"),
      );
      renderWithClient(locale);
      expect(await screen.findByText(error)).toBeDefined();
      const deleteButton = screen.getByRole("button", { name: deletion });
      expect(deleteButton.hasAttribute("disabled")).toBe(true);
      expect(screen.queryByText("private-backend-details")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: retry }));
      await waitFor(() =>
        expect(deleteButton.hasAttribute("disabled")).toBe(false),
      );
      expect(mocks.fetchCapabilities).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["withdrawn", "failed"])(
    "pauses an open confirmation during reload and after discovery is %s",
    async (result) => {
      const { client } = renderWithClient();
      const deleteButton = screen.getByRole("button", {
        name: "Delete saved preferences",
      });
      await waitFor(() =>
        expect(deleteButton.hasAttribute("disabled")).toBe(false),
      );
      fireEvent.click(deleteButton);
      const input = screen.getByLabelText(
        'Type "DELETE PREFERENCES" to confirm',
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "DELETE PREFERENCES" } });
      const confirm = within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete preferences",
      });
      expect(confirm.hasAttribute("disabled")).toBe(false);
      let completeReload: (value: ProductDataCapabilities) => void = () =>
        undefined;
      let failReload: (reason: Error) => void = () => undefined;
      mocks.fetchCapabilities.mockReturnValueOnce(
        new Promise<ProductDataCapabilities>((resolve, reject) => {
          completeReload = resolve;
          failReload = reject;
        }),
      );
      // 使用同一 QueryClient 保留成功快照，模拟弹窗打开期间的后台重新发现。
      act(() => {
        void client.invalidateQueries({
          queryKey: [...PRODUCT_DATA_CAPABILITIES_QUERY_KEY, "user-1"],
        });
      });
      await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true));
      expect(input.hasAttribute("disabled")).toBe(true);
      expect(input.value).toBe("DELETE PREFERENCES");
      fireEvent.click(confirm);
      expect(mocks.createDeletion).not.toHaveBeenCalled();
      act(() => {
        if (result === "failed") {
          failReload(new Error("private-reload-failure"));
        } else
          completeReload({
            ...allCapabilities,
            deletion_scopes: {
              ...allCapabilities.deletion_scopes,
              preferences: false,
            },
          });
      });
      const dialog = screen.getByRole("dialog");
      expect(
        await within(dialog).findByText(
          result === "failed"
            ? "Could not confirm which data can be cleared. Please retry. Exports remain available."
            : "This category cannot currently be cleared. Confirmation is paused.",
        ),
      ).toBeDefined();
      expect(confirm.hasAttribute("disabled")).toBe(true);
      expect(mocks.createDeletion).not.toHaveBeenCalled();
      if (result === "failed") {
        // 失败时缓存仍有旧的 true，必须等新的成功响应才能恢复原确认草稿。
        expect(
          client.getQueryData([
            ...PRODUCT_DATA_CAPABILITIES_QUERY_KEY,
            "user-1",
          ]),
        ).toEqual(allCapabilities);
        expect(screen.queryByText("private-reload-failure")).toBeNull();
        fireEvent.click(
          within(dialog).getByRole("button", {
            name: "Check clearing availability again",
          }),
        );
        await waitFor(() =>
          expect(confirm.hasAttribute("disabled")).toBe(false),
        );
        expect(input.value).toBe("DELETE PREFERENCES");
        expect(mocks.createDeletion).not.toHaveBeenCalled();
      }
    },
  );

  it("discards cached support and the confirmation when switching accounts", async () => {
    const view = renderWithClient();
    const deleteButton = screen.getByRole("button", {
      name: "Delete saved preferences",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    fireEvent.change(
      screen.getByLabelText('Type "DELETE PREFERENCES" to confirm'),
      { target: { value: "DELETE PREFERENCES" } },
    );
    expect(
      view.client.getQueryData([
        ...PRODUCT_DATA_CAPABILITIES_QUERY_KEY,
        "user-1",
      ]),
    ).toEqual(allCapabilities);
    mocks.fetchCapabilities.mockReturnValueOnce(new Promise(() => undefined));
    auth.userId = "user-2";
    view.rerender(<ProductPreferencesPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Delete saved preferences" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText("Checking which data can be cleared…"),
    ).toBeDefined();
    expect(mocks.createDeletion).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.fetchCapabilities).toHaveBeenCalledTimes(2),
    );
  });

  it.each(["static", "anonymous"])(
    "does not discover deletion capabilities in %s mode",
    (mode) => {
      mocks.staticMode = mode === "static";
      if (mode === "anonymous") auth.userId = "";
      render(<ProductPreferencesPage />, { wrapper: Wrapper });
      expect(
        screen.getByText(
          mode === "static"
            ? "Personal data cannot be cleared in demo mode."
            : "Sign in to see which personal data can be cleared.",
        ),
      ).toBeDefined();
      expect(mocks.fetchCapabilities).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole("button", { name: "Delete saved preferences" })
          .hasAttribute("disabled"),
      ).toBe(true);
    },
  );

  it("explains when the personal settings route is missing", async () => {
    mocks.fetchSettings.mockRejectedValue(new ProductSettingsApiError(404));
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(/Flow Desk product extension is not installed/),
    ).toBeDefined();
  });

  it("keeps a generic message for other personal settings errors", async () => {
    mocks.fetchSettings.mockRejectedValue(new ProductSettingsApiError(503));
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(await screen.findByText(/Could not load preferences/)).toBeDefined();
    expect(screen.queryByText(/product extension is not installed/)).toBeNull();
  });

  it("separates export and personal deletion actions into labeled groups", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const exportRegion = await screen.findByRole("region", {
      name: "Export data",
    });
    const deletionRegion = screen.getByRole("region", {
      name: "Clear personal data",
    });

    expect(
      within(exportRegion).getByRole("button", {
        name: "Export supported data bundle (partial ZIP)",
      }),
    ).toBeDefined();
    expect(
      within(deletionRegion).getByRole("button", {
        name: "Clear my conversation history",
      }),
    ).toBeDefined();
    expect(
      within(deletionRegion).getByText(
        /Each action requires the exact confirmation phrase/,
      ),
    ).toBeDefined();
  });
  it("shows the disabled-feature hint only after a missing-route response", async () => {
    mocks.fetchJobs
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new ProductDataJobsApiError(404));
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Could not load personal data tasks."),
    ).toBeDefined();
    expect(
      screen.queryByText(/If this feature is intentionally disabled/),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText(/If this feature is intentionally disabled/),
    ).toBeDefined();
  });

  it("only shows a saved state while the selected density matches the server value", async () => {
    mocks.fetchSettings.mockResolvedValue({
      api_version: 1,
      settings: [{ key: "workspace.display", value: "comfortable" }],
    });
    mocks.saveSetting.mockImplementation(
      async (key: string, value: unknown) => {
        mocks.fetchSettings.mockResolvedValue({
          api_version: 1,
          settings: [{ key, value }],
        });
      },
    );
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const densitySelector = await screen.findByRole("combobox", {
      name: "Content density",
    });
    const saveButton = await screen.findByRole("button", {
      name: "Save preferences",
    });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(densitySelector);
    fireEvent.click(await screen.findByRole("option", { name: "Compact" }));
    expect(saveButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(saveButton);
    expect(await screen.findByText("Saved")).toBeDefined();
    fireEvent.click(densitySelector);
    fireEvent.click(await screen.findByRole("option", { name: "Comfortable" }));

    await waitFor(() => expect(screen.queryByText("Saved")).toBeNull());
    expect(saveButton.hasAttribute("disabled")).toBe(false);
  });

  it("keeps detailed export limits behind an accessible disclosure", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const summary = await screen.findByText(
      "Review export coverage by category",
    );
    const details = summary.closest("details");
    expect(details).toBeDefined();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain(
      "Conversation exports include thread summaries",
    );

    fireEvent.click(summary);

    expect(details?.open).toBe(true);
  });

  it("submits the combined data package as a partial ZIP export", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const exportButton = await screen.findByRole("button", {
      name: "Export supported data bundle (partial ZIP)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() => expect(mocks.createExport).toHaveBeenCalled());
    expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
      scope: "account",
      idempotencyKey: expect.any(String),
    });
  });

  it("recovers a failed request with the same key after the page is remounted", async () => {
    mocks.createExport.mockRejectedValueOnce(new Error("network timeout"));
    const firstView = render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const exportButton = await screen.findByRole("button", {
      name: "Export conversation history (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);
    await screen.findByRole("button", { name: "Retry the same request" });
    expect(
      screen.getByText(
        "Unconfirmed export request: Export conversation history (partial)",
      ),
    ).toBeDefined();
    const originalSubmission = mocks.createExport.mock.calls[0]?.[0];
    expect(originalSubmission).toMatchObject({
      scope: "threads",
      idempotencyKey: expect.any(String),
    });

    firstView.unmount();
    mocks.createExport.mockResolvedValueOnce({
      ...queuedExport,
      scope: ["threads"],
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });
    const recoverButton = await screen.findByRole("button", {
      name: "Retry the same request",
    });
    fireEvent.click(recoverButton);

    await waitFor(() => expect(mocks.createExport).toHaveBeenCalledTimes(2));
    expect(mocks.createExport.mock.calls[1]?.[0]).toEqual(originalSubmission);
    await waitFor(() => expect(window.sessionStorage.length).toBe(0));
  });

  it("recovers an ambiguous deletion with its original scope and key", async () => {
    mocks.createDeletion.mockRejectedValueOnce(new Error("network timeout"));
    const firstView = render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Delete saved preferences",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    fireEvent.change(
      screen.getByLabelText('Type "DELETE PREFERENCES" to confirm'),
      { target: { value: "DELETE PREFERENCES" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete preferences" }));
    await screen.findByRole("button", { name: "Retry the same request" });
    expect(
      screen.getByText(
        "Unconfirmed deletion request: Delete saved preferences",
      ),
    ).toBeDefined();
    const originalSubmission = mocks.createDeletion.mock.calls[0]?.[0];

    firstView.unmount();
    mocks.createDeletion.mockResolvedValueOnce({
      ...queuedExport,
      kind: "deletion",
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry the same request" }),
    );

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(2));
    expect(mocks.createDeletion.mock.calls[1]?.[0]).toEqual(originalSubmission);
    await waitFor(() => expect(window.sessionStorage.length).toBe(0));
  });

  it("fails closed when the browser cannot persist a recovery key", async () => {
    rs.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const exportButton = await screen.findByRole("button", {
      name: "Export conversation history (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(mocks.createExport).not.toHaveBeenCalled();
  });

  it("shows submission progress only on the selected export scope", async () => {
    mocks.createExport.mockReturnValue(new Promise(() => undefined));
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const exportRegion = await screen.findByRole("region", {
      name: "Export data",
    });
    const threadsButton = within(exportRegion).getByRole("button", {
      name: "Export conversation history (partial)",
    });
    await waitFor(() =>
      expect(threadsButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(threadsButton);

    const submitting = await within(exportRegion).findByRole("button", {
      name: "Submitting…",
    });
    expect(submitting.getAttribute("aria-busy")).toBe("true");
    expect(
      within(exportRegion).getByRole("button", {
        name: "Export preferences",
      }),
    ).toBeDefined();
    expect(
      within(exportRegion).getAllByRole("button", { name: "Submitting…" }),
    ).toHaveLength(1);
  });

  it("explains a safe export size failure without exposing the backend code", async () => {
    mocks.fetchJobs.mockResolvedValue({
      ...emptyJobs,
      jobs: [
        {
          ...queuedExport,
          kind: "export",
          scope: ["threads"],
          status: "failed",
          error_code: "export_size_limit",
        },
      ],
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        "The export exceeds the current size limit. Choose a smaller scope and try again.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("export_size_limit")).toBeNull();
  });

  it("keeps unknown data-job failures on generic localized guidance", async () => {
    mocks.fetchJobs.mockResolvedValue({
      ...emptyJobs,
      jobs: [
        {
          ...queuedExport,
          status: "failed",
          error_code: "private_host_detail",
        },
      ],
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        "The task failed. Check the service status, then submit a new task.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("private_host_detail")).toBeNull();
  });

  it("creates a new export for a failed temporary export and keeps its history", async () => {
    mocks.fetchJobs.mockResolvedValue({
      ...emptyJobs,
      jobs: [
        {
          ...queuedExport,
          scope: ["threads"],
          status: "failed",
          error_code: "temporary_storage_error",
        },
      ],
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        "The background task stopped repeatedly. Check the Gateway and storage services, then submit a new task.",
      ),
    ).toBeDefined();
    const retryButton = await screen.findByRole("button", {
      name: "Submit export again",
    });
    await waitFor(() =>
      expect(retryButton.hasAttribute("disabled")).toBe(false),
    );

    fireEvent.click(retryButton);

    await waitFor(() => expect(mocks.createExport).toHaveBeenCalled());
    expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
      scope: "threads",
      idempotencyKey: expect.any(String),
    });
    expect(
      screen.getByText(
        "The background task stopped repeatedly. Check the Gateway and storage services, then submit a new task.",
      ),
    ).toBeDefined();
    expect(mocks.fetchJobs.mock.calls.length).toBeGreaterThan(0);
  });

  it("does not offer retry for permanent export failures or failed deletions", async () => {
    mocks.fetchJobs.mockResolvedValue({
      ...emptyJobs,
      jobs: [
        {
          ...queuedExport,
          scope: ["threads"],
          status: "failed",
          error_code: "export_size_limit",
        },
        {
          ...queuedExport,
          job_id: "123e4567-e89b-12d3-a456-426614174001",
          kind: "deletion",
          status: "failed",
          error_code: "temporary_storage_error",
        },
      ],
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    await screen.findByText(
      "The export exceeds the current size limit. Choose a smaller scope and try again.",
    );
    expect(
      screen.queryByRole("button", { name: "Submit export again" }),
    ).toBeNull();
  });

  it("paginates older data jobs without losing active-job protection", async () => {
    const firstPageJobs = Array.from({ length: 20 }, (_, index) => ({
      ...queuedExport,
      job_id: `job-${index}`,
      status: index === 0 ? ("queued" as const) : ("completed" as const),
    }));
    mocks.fetchJobs.mockImplementation(async (_limit, offset) =>
      offset === 0
        ? {
            api_version: 1,
            jobs: firstPageJobs,
            limit: 20,
            offset: 0,
            has_more: true,
          }
        : {
            api_version: 1,
            jobs: [],
            limit: 20,
            offset: 20,
            has_more: false,
          },
    );

    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const next = await screen.findByRole("button", { name: "Next page" });
    expect(
      screen
        .getByRole("button", { name: "Export preferences" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(next);

    expect(await screen.findByText("Page 2")).toBeDefined();
    expect(
      await screen.findByRole("button", { name: "Previous page" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Next page" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(mocks.fetchJobs).toHaveBeenCalledWith(
      20,
      20,
      expect.any(AbortSignal),
    );
  });

  it("creates a preference-only export and explains its limited scope", async () => {
    mocks.fetchJobs.mockResolvedValueOnce(emptyJobs).mockResolvedValue({
      api_version: 1,
      jobs: [queuedExport],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /choose one export category or combine currently supported categories into a ZIP/i,
      ),
    ).toBeDefined();
    const exportButton = screen.getByRole("button", {
      name: "Export preferences",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() => expect(mocks.createExport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Queued")).toBeDefined();
    expect(
      screen.getByRole("list", { name: "Recent personal data tasks" }),
    ).toBeDefined();
  });

  it("offers conversation history export with a visible partial-coverage warning", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /conversation exports include thread summaries, gateway-visible messages, and owner-checked run status.*token usage/i,
      ),
    ).toBeDefined();
    const exportButton = screen.getByRole("button", {
      name: "Export conversation history (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
        scope: "threads",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("offers a project metadata export and explains the excluded content", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /project metadata exports include names, instructions.*exclude project documents/i,
      ),
    ).toBeDefined();
    const exportButton = screen.getByRole("button", {
      name: "Export project metadata (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
        scope: "projects",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("offers a scheduled task export and explains its partial scope", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /scheduled task exports contain task definitions and cadence only/i,
      ),
    ).toBeDefined();
    const exportButton = screen.getByRole("button", {
      name: "Export scheduled tasks (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
        scope: "scheduled_tasks",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("offers an owner Agent export and explains deployment-binding exclusions", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /Agent exports contain settings and SOUL text.*exclude deployment-shared Agents/i,
      ),
    ).toBeDefined();
    const exportButton = screen.getByRole("button", {
      name: "Export my Agents (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
        scope: "agents",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("offers an owner memory export and explains backend-specific coverage", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText(
        /memory exports use the configured backend's owner-scoped memory view.*local DeerMem includes shared summaries and the default-Agent bucket/i,
      ),
    ).toBeDefined();
    const exportButton = screen.getByRole("button", {
      name: "Export personal memory (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
        scope: "memory",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("offers a bounded file export and explains the supported file sources", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const coverageSummary = await screen.findByText(
      "Review export coverage by category",
    );
    const coverageDetails = coverageSummary.closest("details");
    fireEvent.click(coverageSummary);
    expect(coverageDetails?.textContent).toContain(
      "File exports include Gateway-readable thread uploads",
    );
    expect(coverageDetails?.textContent).toContain("bounded workspace files");
    expect(coverageDetails?.textContent).toContain(
      "File contents are not scanned for secrets",
    );
    const exportButton = screen.getByRole("button", {
      name: "Export my files (partial)",
    });
    await waitFor(() =>
      expect(exportButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(mocks.createExport.mock.calls[0]?.[0]).toMatchObject({
        scope: "files",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("labels a completed file package as partial and keeps its download available", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          scope: ["files"] as ["files"],
          status: "completed" as const,
          result: {
            artifact_id: "artifact-files",
            completeness: "partial" as const,
            expires_at: "2099-09-28T09:00:00Z",
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Personal file export (partial)"),
    ).toBeDefined();
    expect(screen.getByText("Partial export")).toBeDefined();
    expect(
      screen.getByText(
        /Gateway-readable thread uploads, thread outputs, eligible thread workspace files, and active original Project shelf documents/i,
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDefined();
  });

  it("removes an export download action after its artifact expires", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          status: "completed" as const,
          result: {
            artifact_id: "artifact-expiring",
            completeness: "complete" as const,
            expires_at: new Date(Date.now() + 250).toISOString(),
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByRole("button", { name: "Download JSON" }),
    ).toBeDefined();
    await waitFor(
      () =>
        expect(
          screen.queryByRole("button", { name: "Download JSON" }),
        ).toBeNull(),
      { timeout: 2_000 },
    );
  });

  it("aborts an in-progress artifact download when the page is closed", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [{ ...queuedExport, status: "completed" as const }],
      limit: 20,
      offset: 0,
    });
    mocks.downloadArtifact.mockImplementation(
      (_jobId: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Download cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const view = render(<ProductPreferencesPage />, { wrapper: Wrapper });
    fireEvent.click(
      await screen.findByRole("button", { name: "Download JSON" }),
    );
    await waitFor(() => expect(mocks.downloadArtifact).toHaveBeenCalled());
    const signal = mocks.downloadArtifact.mock.calls[0]?.[1] as AbortSignal;

    view.unmount();

    expect(signal.aborted).toBe(true);
  });

  it.each(["close", "switch account"])(
    "ignores a late artifact Blob after %s even if the adapter ignores abort",
    async (action) => {
      mocks.fetchJobs.mockResolvedValue({
        ...emptyJobs,
        jobs: [{ ...queuedExport, status: "completed" as const }],
      });
      let resolveDownload!: (blob: Blob) => void;
      mocks.downloadArtifact.mockImplementation(
        () =>
          new Promise<Blob>((resolve) => {
            resolveDownload = resolve;
          }),
      );
      const handoff = rs
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const createUrl = rs
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:late-export");
      const view = render(<ProductPreferencesPage />, { wrapper: Wrapper });
      fireEvent.click(
        await screen.findByRole("button", { name: "Download JSON" }),
      );
      await waitFor(() =>
        expect(mocks.downloadArtifact).toHaveBeenCalledTimes(1),
      );
      const signal = mocks.downloadArtifact.mock.calls[0]?.[1] as AbortSignal;

      if (action === "close") {
        view.unmount();
      } else {
        auth.userId = "user-2";
        view.rerender(<ProductPreferencesPage />);
      }
      expect(signal.aborted).toBe(true);
      await act(async () => resolveDownload(new Blob(["old account data"])));

      expect(createUrl).not.toHaveBeenCalled();
      expect(handoff).not.toHaveBeenCalled();
    },
  );

  it("labels a completed memory package as partial", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          scope: ["memory"] as ["memory"],
          status: "completed" as const,
          result: {
            artifact_id: "artifact-memory",
            completeness: "partial" as const,
            expires_at: "2099-09-28T09:00:00Z",
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Personal memory export (partial)"),
    ).toBeDefined();
    expect(screen.getByText("Partial export")).toBeDefined();
    expect(
      screen.getByText(
        /coverage may vary by backend; credentials, provider-private fields/i,
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDefined();
  });

  it("labels a completed Agent package as partial", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          scope: ["agents"] as ["agents"],
          status: "completed" as const,
          result: {
            artifact_id: "artifact-agents",
            completeness: "partial" as const,
            expires_at: "2099-09-28T09:00:00Z",
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Custom Agent export (partial)"),
    ).toBeDefined();
    expect(screen.getByText("Partial export")).toBeDefined();
    expect(
      screen.getByText(
        /excludes deployment-shared definitions, GitHub bindings/i,
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDefined();
  });

  it("labels a scheduled task package as partial and keeps its download available", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          scope: ["scheduled_tasks"] as ["scheduled_tasks"],
          status: "completed" as const,
          result: {
            artifact_id: "artifact-scheduled-tasks",
            completeness: "partial" as const,
            expires_at: "2099-09-28T09:00:00Z",
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Scheduled task definition export (partial)"),
    ).toBeDefined();
    expect(screen.getByText("Partial export")).toBeDefined();
    expect(
      screen.getByText(/excludes run history, run results, and runtime state/i),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDefined();
  });

  it("labels a project metadata package as partial and keeps its download available", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          scope: ["projects"] as ["projects"],
          status: "completed" as const,
          result: {
            artifact_id: "artifact-projects",
            completeness: "partial" as const,
            expires_at: "2099-09-28T09:00:00Z",
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Project metadata export (partial)"),
    ).toBeDefined();
    expect(screen.getByText("Partial export")).toBeDefined();
    expect(
      screen.getByText(/does not contain project documents or conversations/i),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDefined();
  });

  it("labels a completed conversation bundle as partial and keeps its download available", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          scope: ["threads"] as ["threads"],
          status: "completed" as const,
          result: {
            artifact_id: "artifact-1",
            completeness: "partial" as const,
            expires_at: "2099-09-28T09:00:00Z",
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Conversation history export (partial)"),
    ).toBeDefined();
    expect(screen.getByText("Partial export")).toBeDefined();
    expect(
      screen.getByText(/cannot restore checkpoints or other account data/i),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeDefined();
  });

  it("requires the exact deletion phrase before queuing preference removal", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Delete saved preferences",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    expect(
      screen.getByText(
        /permanently deletes your Flow Desk preference settings only/i,
      ),
    ).toBeDefined();
    const confirmButton = screen.getByRole("button", {
      name: "Delete preferences",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Type "DELETE PREFERENCES" to confirm'),
      { target: { value: "DELETE PREFERENCES" } },
    );
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.createDeletion.mock.calls[0]?.[0]).toMatchObject({
      scope: "preferences",
      idempotencyKey: expect.any(String),
    });
  });

  it("keeps the deletion confirmation busy and open while queuing", async () => {
    mocks.createDeletion.mockReturnValue(new Promise(() => undefined));
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Delete saved preferences",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    fireEvent.change(
      screen.getByLabelText('Type "DELETE PREFERENCES" to confirm'),
      { target: { value: "DELETE PREFERENCES" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete preferences" }));

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.getAttribute("aria-busy")).toBe("true"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("requires a distinct phrase to delete scheduled task definitions", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Delete scheduled task definitions",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    expect(
      screen.getByText(
        /run history and session content created by tasks are retained/i,
      ),
    ).toBeDefined();
    const confirmButton = screen.getByRole("button", {
      name: "Delete task definitions",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Type "DELETE SCHEDULED TASKS" to confirm'),
      { target: { value: "DELETE SCHEDULED TASKS" } },
    );
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.createDeletion.mock.calls[0]?.[0]).toMatchObject({
      scope: "scheduled_tasks",
      idempotencyKey: expect.any(String),
    });
  });

  it("requires a distinct phrase to delete custom Agent definitions", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Delete custom Agents",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    expect(
      screen.getByText(/definitions you created, their SOUL files/i),
    ).toBeDefined();
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Delete custom Agents",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Type "DELETE CUSTOM AGENTS" to confirm'),
      { target: { value: "DELETE CUSTOM AGENTS" } },
    );
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.createDeletion.mock.calls[0]?.[0]).toMatchObject({
      scope: "agents",
      idempotencyKey: expect.any(String),
    });
  });

  it("requires a distinct phrase before clearing the configured memory backend", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Clear personal memory",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    expect(
      screen.getByText(
        /memory summaries and facts managed for your account by the configured memory backend/i,
      ),
    ).toBeDefined();
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Clear personal memory",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Type "DELETE MY MEMORY" to confirm'),
      { target: { value: "DELETE MY MEMORY" } },
    );
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.createDeletion.mock.calls[0]?.[0]).toMatchObject({
      scope: "memory",
      idempotencyKey: expect.any(String),
    });
  });

  it("requires a project-removal phrase and explains that documents stay in Trash", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Remove my project spaces",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    expect(
      screen.getByText(
        /detaches their conversations.*moves active project documents to Trash/i,
      ),
    ).toBeDefined();
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Remove project spaces",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Type "DELETE MY PROJECTS" to confirm'),
      { target: { value: "DELETE MY PROJECTS" } },
    );
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.createDeletion.mock.calls[0]?.[0]).toMatchObject({
      scope: "projects",
      idempotencyKey: expect.any(String),
    });
  });

  it("requires an exact phrase and explains the limits of file deletion", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Delete my uploads and Project documents",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    expect(
      screen.getByText(
        /permanently deletes thread uploads.*recoverable Trash.*Generated outputs and thread workspace files remain/i,
      ),
    ).toBeDefined();
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Delete supported files",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Type "DELETE MY FILES" to confirm'),
      { target: { value: "DELETE MY FILES" } },
    );
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.createDeletion.mock.calls[0]?.[0]).toMatchObject({
      scope: "files",
      idempotencyKey: expect.any(String),
    });
  });

  it("discards an open deletion confirmation when the account changes", async () => {
    const view = render(<ProductPreferencesPage />, { wrapper: Wrapper });
    const deleteButton = await screen.findByRole("button", {
      name: "Delete my uploads and Project documents",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    fireEvent.change(
      screen.getByLabelText('Type "DELETE MY FILES" to confirm'),
      { target: { value: "DELETE MY FILES" } },
    );
    expect(
      within(screen.getByRole("dialog"))
        .getByRole("button", {
          name: "Delete supported files",
        })
        .hasAttribute("disabled"),
    ).toBe(false);

    auth.userId = "user-2";
    view.rerender(<ProductPreferencesPage />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByLabelText('Type "DELETE MY FILES" to confirm'),
    ).toBeNull();
    expect(mocks.createDeletion).not.toHaveBeenCalled();
  });

  it("requires an explicit phrase before clearing conversation history", async () => {
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const deleteButton = await screen.findByRole("button", {
      name: "Clear my conversation history",
    });
    await waitFor(() =>
      expect(deleteButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(deleteButton);
    expect(
      screen.getByText(/clears conversations you own, their uploaded files/i),
    ).toBeDefined();
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Clear conversation history",
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(
      screen.getByLabelText('Type "DELETE THREAD HISTORY" to confirm'),
      { target: { value: "DELETE THREAD HISTORY" } },
    );
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mocks.createDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.createDeletion.mock.calls[0]?.[0]).toMatchObject({
      scope: "threads",
      idempotencyKey: expect.any(String),
    });
  });

  it("shows remaining and unconfirmed conversation deletion counts", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          kind: "deletion" as const,
          scope: ["threads"] as ["threads"],
          status: "completed" as const,
          result: {
            completeness: "partial" as const,
            deleted_resources_count: 2,
            failed_resources_count: 1,
            remaining_resources_count: 1,
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Conversation history deletion"),
    ).toBeDefined();
    expect(screen.getByText("Partial deletion")).toBeDefined();
    expect(
      screen.getByText("2 conversation(s) were deleted or no longer exist."),
    ).toBeDefined();
    expect(
      screen.getByText(/1 conversation\(s\) remain; 1 deletion operation/i),
    ).toBeDefined();
  });

  it("shows recoverable file deletion and unsupported files in a partial result", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          kind: "deletion" as const,
          scope: ["files"] as ["files"],
          status: "completed" as const,
          result: {
            completeness: "partial" as const,
            deleted_resources_count: 2,
            failed_resources_count: 2,
            remaining_resources_count: 2,
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(await screen.findByText("Personal file deletion")).toBeDefined();
    expect(screen.getByText("Partial deletion")).toBeDefined();
    expect(
      screen.getByText(
        "Deleted 2 upload(s) or moved Project document(s) to recoverable Trash.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        /2 file\(s\) remain in the catalog; 2 deletion operation/i,
      ),
    ).toBeDefined();
  });

  it("shows remaining and unconfirmed scheduled task deletion counts", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          kind: "deletion" as const,
          scope: ["scheduled_tasks"] as ["scheduled_tasks"],
          status: "completed" as const,
          result: {
            completeness: "partial" as const,
            deleted_resources_count: 1,
            failed_resources_count: 1,
            remaining_resources_count: 1,
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(
      await screen.findByText("Scheduled task definition deletion"),
    ).toBeDefined();
    expect(screen.getByText("Partial deletion")).toBeDefined();
    expect(
      screen.getByText(
        "1 scheduled task definition(s) were deleted or no longer exist.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        /1 scheduled task definition\(s\) remain.*1 more could not be confirmed/i,
      ),
    ).toBeDefined();
  });

  it("shows remaining custom Agent deletion counts", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [
        {
          ...queuedExport,
          kind: "deletion" as const,
          scope: ["agents"] as ["agents"],
          status: "completed" as const,
          result: {
            completeness: "partial" as const,
            deleted_resources_count: 1,
            failed_resources_count: 1,
            remaining_resources_count: 1,
          },
        },
      ],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(await screen.findByText("Custom Agent deletion")).toBeDefined();
    expect(
      screen.getByText(
        "1 custom Agent definition(s) were deleted or no longer exist.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        /1 custom Agent\(s\) remain; 1 deletion operation\(s\) could not be confirmed/i,
      ),
    ).toBeDefined();
  });

  it("prevents a second active task and lets the owner request cancellation", async () => {
    mocks.fetchJobs.mockResolvedValue({
      api_version: 1,
      jobs: [queuedExport],
      limit: 20,
      offset: 0,
    });
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    expect(await screen.findByText("Queued")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Export preferences" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel task" }));

    await waitFor(() => expect(mocks.cancelJob).toHaveBeenCalled());
    expect(mocks.cancelJob.mock.calls[0]?.[0]).toBe(queuedExport.job_id);
  });

  it("disables data operations unless the account has every scope permission", async () => {
    auth.permissions = [
      "preferences:read",
      "preferences:write",
      "threads:read",
    ];
    render(<ProductPreferencesPage />, { wrapper: Wrapper });

    const threadExport = await screen.findByRole("button", {
      name: "Export conversation history (partial)",
    });
    const accountExport = screen.getByRole("button", {
      name: "Export supported data bundle (partial ZIP)",
    });
    const threadDeletion = screen.getByRole("button", {
      name: "Clear my conversation history",
    });
    const fileDeletion = screen.getByRole("button", {
      name: "Delete my uploads and Project documents",
    });
    const preferenceDeletion = screen.getByRole("button", {
      name: "Delete saved preferences",
    });

    await waitFor(() => {
      expect(threadExport.hasAttribute("disabled")).toBe(true);
      expect(accountExport.hasAttribute("disabled")).toBe(true);
      expect(threadDeletion.hasAttribute("disabled")).toBe(true);
      expect(fileDeletion.hasAttribute("disabled")).toBe(true);
      expect(preferenceDeletion.hasAttribute("disabled")).toBe(false);
    });
    expect(
      screen.getByText("Your account needs this permission: runs:read"),
    ).toBeDefined();
    expect(
      screen.getByText("Your account needs this permission: threads:delete"),
    ).toBeDefined();
  });
});
