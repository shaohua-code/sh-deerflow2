import { describe, expect, it } from "@rstest/core";

import {
  isAdminUserPage,
  isAdminUserSummary,
  isAdminUserStatusChange,
  isProductAuditPage,
  isProductAdminSettings,
  isProductBootstrap,
  isPublicProductBrand,
  isProductFilePage,
  isProductDataJob,
  isProductDataJobPage,
  isProductRuntimeVersion,
  isProductUserSettings,
} from "@/product/api";
import { isProductFeatureEnabled } from "@/product/features";

const validBootstrap = {
  api_version: 1,
  product: {
    name: "Flow Desk",
    name_zh: "智能工作台",
    features: {
      overview: true,
      chats: true,
      agents: true,
      scheduled_tasks: true,
      capabilities: true,
      files: false,
      data_privacy: false,
      administration: false,
    },
  },
  user: { id: "test-user", is_admin: false },
};

describe("product runtime version DTO", () => {
  it("accepts the frontend-compatible version response", () => {
    expect(
      isProductRuntimeVersion({
        api_version: 1,
        product: { name: "Flow Desk", version: "1.2.3" },
        engine: { name: "DeerFlow", version: "2.4.0" },
      }),
    ).toBe(true);
  });

  it("rejects missing versions and unknown API versions", () => {
    expect(
      isProductRuntimeVersion({
        api_version: 1,
        product: { name: "Flow Desk", version: "1.2.3" },
        engine: { name: "DeerFlow" },
      }),
    ).toBe(false);
    expect(
      isProductRuntimeVersion({
        api_version: 2,
        product: { name: "Flow Desk", version: "1.2.3" },
        engine: { name: "DeerFlow", version: "2.4.0" },
      }),
    ).toBe(false);
  });
});

describe("product bootstrap DTO", () => {
  it("accepts the versioned response when all fields have the expected types", () => {
    expect(isProductBootstrap(validBootstrap)).toBe(true);
  });

  it("rejects missing features and non-boolean feature flags", () => {
    expect(
      isProductBootstrap({
        ...validBootstrap,
        product: { ...validBootstrap.product, features: {} },
      }),
    ).toBe(false);

    expect(
      isProductBootstrap({
        ...validBootstrap,
        product: {
          ...validBootstrap.product,
          features: { ...validBootstrap.product.features, files: "false" },
        },
      }),
    ).toBe(false);
  });

  it("rejects unknown contract versions", () => {
    expect(isProductBootstrap({ ...validBootstrap, api_version: 2 })).toBe(
      false,
    );
  });
});

describe("public product-brand DTO", () => {
  it("accepts only the versioned display-name shape needed before login", () => {
    expect(
      isPublicProductBrand({
        api_version: 1,
        product: { name: "Northstar Desk", name_zh: "北辰工作台" },
      }),
    ).toBe(true);
    expect(
      isPublicProductBrand({
        api_version: 1,
        product: {
          name: "Northstar Desk",
          name_zh: "北辰工作台",
          features: {},
        },
        user: { id: "private-user", is_admin: true },
      }),
    ).toBe(false);
    expect(
      isPublicProductBrand({
        api_version: 2,
        product: { name: "Northstar Desk", name_zh: "北辰工作台" },
      }),
    ).toBe(false);
    expect(
      isPublicProductBrand({
        api_version: 1,
        product: { name: "", name_zh: "北辰工作台" },
      }),
    ).toBe(false);
  });
});

describe("product feature display flags", () => {
  it("keeps local defaults until the server config is available", () => {
    expect(isProductFeatureEnabled(undefined, "chats")).toBe(true);
    expect(isProductFeatureEnabled(undefined, "files")).toBe(false);
  });

  it("uses explicit server values, including false", () => {
    expect(isProductFeatureEnabled({ chats: false }, "chats")).toBe(false);
    expect(isProductFeatureEnabled({ files: true }, "files")).toBe(true);
  });
});

describe("product file catalog DTO", () => {
  it("accepts owner-scoped workspace file metadata and rejects unknown sources", () => {
    const file = {
      file_id: "thread_workspace:thread-1:docs/guide.md",
      source: "thread_workspace",
      name: "docs/guide.md",
      size_bytes: 64,
      artifact_url:
        "/api/threads/thread-1/artifacts/mnt/user-data/workspace/docs/guide.md",
      modified_at: null,
      storage_name: "docs/guide.md",
      thread_id: "thread-1",
      thread_name: "产品讨论",
      project_id: null,
      project_name: null,
      document_id: null,
    };
    const page = {
      api_version: 1,
      files: [file],
      total: 1,
      limit: 50,
      offset: 0,
      has_more: false,
      next_offset: null,
      truncated: false,
      failed_count: 0,
      coverage_notes: [],
    };

    expect(isProductFilePage(page)).toBe(true);
    expect(
      isProductFilePage({
        ...page,
        catalog_updated_at: "2026-10-09T12:00:00Z",
        catalog_stale: false,
        catalog_refresh_deferred: true,
      }),
    ).toBe(true);
    expect(
      isProductFilePage({
        ...page,
        files: [{ ...file, source: "unexpected" }],
      }),
    ).toBe(false);
    expect(
      isProductFilePage({ ...page, catalog_refresh_deferred: "true" }),
    ).toBe(false);
  });
});

describe("product user settings DTO", () => {
  it("accepts recursive JSON preferences", () => {
    expect(
      isProductUserSettings({
        api_version: 1,
        settings: [
          {
            key: "workspace.layout",
            value: { density: "compact", panels: ["recent", true, null] },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects unsupported versions, missing keys, and non-JSON values", () => {
    expect(isProductUserSettings({ api_version: 2, settings: [] })).toBe(false);
    expect(
      isProductUserSettings({
        api_version: 1,
        settings: [{ value: "missing key" }],
      }),
    ).toBe(false);
    expect(
      isProductUserSettings({
        api_version: 1,
        settings: [{ key: "bad", value: Number.POSITIVE_INFINITY }],
      }),
    ).toBe(false);
  });
});

describe("product preference data-job DTO", () => {
  const job = {
    job_id: "123e4567-e89b-12d3-a456-426614174000",
    kind: "export",
    scope: ["preferences"],
    status: "completed",
    progress: { stage: "packaging", completed: 1, total: 1 },
    result: {
      artifact_id: "artifact-1",
      size_bytes: 128,
      sha256: "a".repeat(64),
      completeness: "complete",
      expires_at: "2026-09-28T10:00:00Z",
    },
    error_code: null,
    attempt: 1,
    max_attempts: 3,
    cancel_requested: false,
    request_id: null,
    created_at: "2026-09-28T09:00:00Z",
    updated_at: "2026-09-28T09:00:01Z",
  };

  it("accepts a complete owner-scoped job and page", () => {
    expect(isProductDataJob(job)).toBe(true);
    expect(
      isProductDataJobPage({
        api_version: 1,
        jobs: [job],
        limit: 20,
        offset: 0,
        has_more: true,
      }),
    ).toBe(true);
    expect(
      isProductDataJobPage({
        api_version: 1,
        jobs: [job],
        limit: 20,
        offset: 0,
        has_more: "yes",
      }),
    ).toBe(false);
  });

  it("accepts partial conversation exports and owner-scoped conversation deletion", () => {
    expect(
      isProductDataJob({
        ...job,
        scope: ["threads"],
        result: {
          ...job.result,
          completeness: "partial",
          failed_resources_count: 2,
        },
      }),
    ).toBe(true);
    expect(
      isProductDataJob({
        ...job,
        scope: ["files"],
        result: { ...job.result, completeness: "partial" },
      }),
    ).toBe(true);
    expect(
      isProductDataJob({ ...job, kind: "deletion", scope: ["threads"] }),
    ).toBe(true);
    expect(
      isProductDataJob({
        ...job,
        scope: ["agents"],
        result: { ...job.result, completeness: "partial" },
      }),
    ).toBe(true);
    expect(
      isProductDataJob({
        ...job,
        result: { ...job.result, completeness: "unknown" },
      }),
    ).toBe(false);
  });

  it("rejects unsupported scopes, states, progress, and API versions", () => {
    expect(isProductDataJob({ ...job, scope: ["unknown"] })).toBe(false);
    // Files are a supported deletion scope; keep the negative assertion focused
    // on a value that the current product API does not recognize.
    expect(
      isProductDataJob({ ...job, kind: "deletion", scope: ["unknown"] }),
    ).toBe(false);
    expect(isProductDataJob({ ...job, status: "unknown" })).toBe(false);
    expect(
      isProductDataJob({
        ...job,
        progress: { stage: "packaging", completed: -1, total: 1 },
      }),
    ).toBe(false);
    expect(
      isProductDataJobPage({
        api_version: 2,
        jobs: [job],
        limit: 20,
        offset: 0,
      }),
    ).toBe(false);
  });
});

describe("product audit DTO", () => {
  const event = {
    event_id: "event-1",
    actor_user_id: "admin-1",
    action: "settings.write",
    resource_type: "user_setting",
    resource_id: "workspace.display",
    outcome: "success",
    occurred_at: "2026-09-27T10:00:00Z",
    request_id: null,
  };

  it("accepts bounded audit pages with optional request IDs", () => {
    expect(
      isProductAuditPage({
        api_version: 1,
        events: [{ ...event, request_id: "trace-1" }],
        limit: 50,
        offset: 0,
      }),
    ).toBe(true);
  });

  it("accepts the optional has_more pagination flag and rejects invalid values", () => {
    expect(
      isProductAuditPage({
        api_version: 1,
        events: [event],
        limit: 50,
        offset: 0,
        has_more: true,
      }),
    ).toBe(true);
    expect(
      isProductAuditPage({
        api_version: 1,
        events: [event],
        limit: 50,
        offset: 0,
        has_more: "yes",
      }),
    ).toBe(false);
  });

  it("rejects incomplete events and unsupported versions", () => {
    expect(
      isProductAuditPage({
        api_version: 1,
        events: [{ ...event, actor_user_id: 1 }],
        limit: 50,
        offset: 0,
      }),
    ).toBe(false);
    expect(
      isProductAuditPage({
        api_version: 2,
        events: [event],
        limit: 50,
        offset: 0,
      }),
    ).toBe(false);
    expect(
      isProductAuditPage({
        api_version: 1,
        events: [event],
        limit: 101,
        offset: 0,
      }),
    ).toBe(false);
  });
});

describe("product admin settings DTO", () => {
  const settings = {
    api_version: 1,
    version: 3,
    product: validBootstrap.product,
  };

  it("accepts a complete versioned product configuration", () => {
    expect(isProductAdminSettings(settings)).toBe(true);
  });

  it("rejects incomplete feature maps and invalid versions", () => {
    expect(
      isProductAdminSettings({
        ...settings,
        product: {
          ...settings.product,
          features: { chats: true },
        },
      }),
    ).toBe(false);
    expect(isProductAdminSettings({ ...settings, version: -1 })).toBe(false);
  });
});

describe("admin account DTO", () => {
  const user = {
    id: "user-1",
    email: "person@example.com",
    system_role: "user",
    is_active: true,
    needs_setup: false,
    created_at: "2026-09-27T10:00:00Z",
  } as const;

  it("accepts safe, paginated account summaries", () => {
    expect(isAdminUserSummary(user)).toBe(true);
    expect(
      isAdminUserPage({ users: [user], total: 1, limit: 50, offset: 0 }),
    ).toBe(true);
  });

  it("validates run cancellation results after an admin status change", () => {
    expect(
      isAdminUserStatusChange({
        ...user,
        is_active: false,
        active_runs_stopped: 2,
        active_runs_stop_pending: 1,
        active_runs_stop_failed: 0,
      }),
    ).toBe(true);
    expect(
      isAdminUserStatusChange({
        ...user,
        active_runs_stopped: -1,
        active_runs_stop_pending: 0,
        active_runs_stop_failed: 0,
      }),
    ).toBe(false);
  });

  it("rejects malformed roles, statuses, and page bounds", () => {
    expect(isAdminUserSummary({ ...user, system_role: "owner" })).toBe(false);
    expect(isAdminUserSummary({ ...user, is_active: "yes" })).toBe(false);
    expect(
      isAdminUserPage({ users: [user], total: 1, limit: 101, offset: 0 }),
    ).toBe(false);
  });
});
