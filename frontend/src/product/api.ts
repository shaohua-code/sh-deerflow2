import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { isStaticWebsiteOnly } from "@/core/static-mode";

export {
  fetchPublicProductBrand,
  isPublicProductBrand,
} from "./public-brand-api";
export type { PublicProductBrand } from "./public-brand-api";

/**
 * `/api/product/v1` DTO。它与 DeerFlow 的 LangGraph API 分开版本化，产品页面
 * 可以逐步演进，同时继续复用原有的登录 Cookie、CSRF 与 nginx 同源代理。
 */
export type ProductFeatureKey =
  | "overview"
  | "chats"
  | "agents"
  | "scheduled_tasks"
  | "capabilities"
  | "files"
  | "data_privacy"
  | "administration";

export type ProductBootstrap = {
  api_version: 1;
  product: {
    name: string;
    name_zh: string;
    features: Record<ProductFeatureKey, boolean>;
  };
  user: { id: string; is_admin: boolean };
};

/**
 * 产品用户偏好只承载 JSON 数据，不用于保存 provider 密钥等凭据。
 * 递归类型让设置页在不和 DeerFlow 内部数据库结构耦合的情况下共享 DTO。
 */
export type ProductJsonValue =
  | null
  | boolean
  | number
  | string
  | ProductJsonValue[]
  | { [key: string]: ProductJsonValue };

export type ProductUserSetting = { key: string; value: ProductJsonValue };

export type ProductUserSettings = {
  api_version: 1;
  settings: ProductUserSetting[];
};

/** 自有持久任务的公开投影；仓储 lease/idempotency 字段不会暴露给浏览器。 */
export type ProductDataJobStatus =
  | "queued"
  | "running"
  | "retry_wait"
  | "completed"
  | "failed"
  | "cancelled";

export type ProductDataJob = {
  job_id: string;
  kind: "export" | "deletion";
  scope:
    | ["preferences"]
    | ["account"]
    | ["threads"]
    | ["projects"]
    | ["scheduled_tasks"]
    | ["agents"]
    | ["memory"]
    | ["files"];
  status: ProductDataJobStatus;
  progress: { stage: string; completed: number; total: number };
  result: {
    artifact_id?: string;
    sha256?: string;
    size_bytes?: number;
    expires_at?: string;
    completeness?: "complete" | "partial";
    failed_resources_count?: number;
    deleted_resources_count?: number;
    remaining_resources_count?: number;
  } | null;
  error_code: string | null;
  attempt: number;
  max_attempts: number;
  cancel_requested: boolean;
  request_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductDataJobPage = {
  api_version: 1;
  jobs: ProductDataJob[];
  limit: number;
  offset: number;
  /** 旧版 v1 Gateway 升级期间可能缺少此字段；前端会按页长兼容回退。 */
  has_more?: boolean;
  /** 新版 Gateway 提供可见任务后的真实 offset；滚动升级时跨过被过滤的 NULL 授权行。 */
  next_offset?: number | null;
};

export type ProductDataExportScope =
  | "preferences"
  | "account"
  | "threads"
  | "projects"
  | "scheduled_tasks"
  | "agents"
  | "memory"
  | "files";

export type ProductDataDeletionScope =
  | "preferences"
  | "threads"
  | "scheduled_tasks"
  | "agents"
  | "projects"
  | "memory"
  | "files";

/** 删除能力只用于界面预检；创建任务时 Gateway 仍会校验当前后端支持与账号权限。 */
export type ProductDataCapabilities = {
  api_version: 1;
  deletion_scopes: Record<ProductDataDeletionScope, boolean>;
};

const PRODUCT_DATA_DELETION_SCOPES = [
  "preferences",
  "memory",
  "files",
  "threads",
  "projects",
  "agents",
  "scheduled_tasks",
] as const satisfies readonly ProductDataDeletionScope[];

/** 缺少、额外或错误类型的能力字段均拒绝，不能把未知范围默认视为可删除。 */
export function isProductDataCapabilities(
  payload: unknown,
): payload is ProductDataCapabilities {
  if (!isProductApiRecord(payload)) return false;
  const scopes = payload.deletion_scopes;
  return (
    Object.keys(payload).length === 2 &&
    Object.hasOwn(payload, "api_version") &&
    Object.hasOwn(payload, "deletion_scopes") &&
    payload.api_version === 1 &&
    isProductApiRecord(scopes) &&
    Object.keys(scopes).length === PRODUCT_DATA_DELETION_SCOPES.length &&
    PRODUCT_DATA_DELETION_SCOPES.every(
      (scope) =>
        Object.hasOwn(scopes, scope) && typeof scopes[scope] === "boolean",
    )
  );
}

/** 通过已登录的同源 fetcher 发现本部署支持的删除范围，响应不含运维配置或原因。 */
export async function fetchProductDataCapabilities(
  signal?: AbortSignal,
): Promise<ProductDataCapabilities> {
  if (isStaticWebsiteOnly()) {
    throw new Error(
      "Product data capabilities are unavailable in static demo mode",
    );
  }
  const response = await fetchWithAuth("/api/product/v1/data-capabilities", {
    signal,
  });
  if (!response.ok) {
    throw new Error(`Unable to load data capabilities (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isProductDataCapabilities(payload)) {
    throw new Error(
      "The product data-capability API returned an unsupported response",
    );
  }
  return payload;
}

export type ProductAuditEvent = {
  event_id: string;
  actor_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: string;
  occurred_at: string;
  request_id: string | null;
};

export type ProductAuditPage = {
  api_version: 1;
  events: ProductAuditEvent[];
  limit: number;
  offset: number;
  /** 旧版 Gateway 可能没有该字段；前端会用页长作兼容回退。 */
  has_more?: boolean;
};

export type ProductAdminSettings = {
  api_version: 1;
  version: number;
  product: ProductBootstrap["product"];
};

export type ProductAdminSettingsPatch = {
  expected_version: number;
  name: string;
  name_zh: string;
  features: Record<ProductFeatureKey, boolean>;
};

/** Gateway 核心账号 DTO；密码哈希和令牌版本不得越过此数据边界。 */
export type AdminUserSummary = {
  id: string;
  email: string;
  system_role: "admin" | "user";
  is_active: boolean;
  needs_setup: boolean;
  created_at: string;
};

/** 停用账号后由 Gateway 回报正在运行任务的中止结果。 */
export type AdminUserStatusChange = AdminUserSummary & {
  active_runs_stopped: number;
  active_runs_stop_pending: number;
  active_runs_stop_failed: number;
};

export type AdminUserPage = {
  users: AdminUserSummary[];
  total: number;
  limit: number;
  offset: number;
};

/** 供 About/诊断页显示实际安装的产品扩展与 DeerFlow 引擎版本。 */
export type ProductRuntimeVersion = {
  api_version: 1;
  product: { name: string; version: string };
  engine: { name: string; version: string };
};

/** 元数据型全局文件目录；文件正文仍由 Gateway 现有授权路由提供。 */
export type ProductFileEntry = {
  file_id: string;
  source:
    | "thread_upload"
    | "thread_output"
    | "thread_workspace"
    | "project_document";
  name: string;
  size_bytes: number;
  artifact_url: string;
  modified_at: string | null;
  storage_name: string | null;
  thread_id: string | null;
  thread_name: string | null;
  project_id: string | null;
  project_name: string | null;
  document_id: string | null;
};

export type ProductFilePage = {
  api_version: 1;
  files: ProductFileEntry[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
  truncated: boolean;
  failed_count: number;
  coverage_notes: string[];
  /** 新版扩展提供持久快照状态；旧版 Gateway 可省略这些 additive 字段。 */
  catalog_updated_at?: string | null;
  catalog_stale?: boolean;
  catalog_refresh_deferred?: boolean;
};

/** 保留偏好接口的 HTTP 状态码；404 表示当前 Gateway 没有安装产品扩展路由。 */
export class ProductSettingsApiError extends Error {
  constructor(readonly status: number) {
    super("Unable to load personal settings (" + status + ")");
    this.name = "ProductSettingsApiError";
  }
}

/** 保留列表接口的 HTTP 状态码，让页面区分网关故障和接口未开放。 */
export class ProductDataJobsApiError extends Error {
  constructor(readonly status: number) {
    super("Unable to load preference jobs (" + status + ")");
    this.name = "ProductDataJobsApiError";
  }
}

/** 后端返回 HTTP 409 时保留冲突标记，管理页提示管理员先刷新最新版本。 */
export class ProductConfigConflictError extends Error {
  constructor() {
    super("Product settings changed; reload before saving");
    this.name = "ProductConfigConflictError";
  }
}

export class AdminUserStatusConflictError extends Error {
  constructor() {
    super("Account status change violates an administrator invariant");
    this.name = "AdminUserStatusConflictError";
  }
}

/**
 * 按服务端分页搜索当前账号的文件元数据。
 * 文件中心通常使用小页；前台账号导出一次请求最多 10,000 条，避免翻每页都重扫整个存储目录。
 */
export async function fetchProductFiles(
  limit = 50,
  offset = 0,
  query = "",
  signal?: AbortSignal,
  refresh = false,
): Promise<ProductFilePage> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    query,
  });
  if (refresh) params.set("refresh", "true");
  const response = await fetchWithAuth(`/api/product/v1/files?${params}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`Unable to load the file catalog (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isProductFilePage(payload)) {
    throw new Error("The product file API returned an unsupported response");
  }
  return payload;
}

/** 删除已完成 Gateway 删除操作对应的缓存行，避免有效期内旧文件再次出现。 */
export async function invalidateProductFileCatalogEntry(
  fileId: string,
): Promise<void> {
  const params = new URLSearchParams({ file_id: fileId });
  const response = await fetchWithAuth(
    `/api/product/v1/files/catalog-entry?${params}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Unable to update the file catalog (${response.status})`);
  }
}

export function isProductFilePage(
  payload: unknown,
): payload is ProductFilePage {
  if (!isProductApiRecord(payload)) return false;
  return (
    payload.api_version === 1 &&
    Number.isInteger(payload.total) &&
    Number.isInteger(payload.limit) &&
    Number.isInteger(payload.offset) &&
    typeof payload.has_more === "boolean" &&
    (payload.next_offset === null || Number.isInteger(payload.next_offset)) &&
    typeof payload.truncated === "boolean" &&
    Number.isInteger(payload.failed_count) &&
    (payload.catalog_updated_at === undefined ||
      payload.catalog_updated_at === null ||
      (typeof payload.catalog_updated_at === "string" &&
        !Number.isNaN(Date.parse(payload.catalog_updated_at)))) &&
    (payload.catalog_stale === undefined ||
      typeof payload.catalog_stale === "boolean") &&
    (payload.catalog_refresh_deferred === undefined ||
      typeof payload.catalog_refresh_deferred === "boolean") &&
    Array.isArray(payload.coverage_notes) &&
    payload.coverage_notes.every((note) => typeof note === "string") &&
    Array.isArray(payload.files) &&
    payload.files.every(isProductFileEntry)
  );
}

function isProductFileEntry(value: unknown): value is ProductFileEntry {
  if (!isProductApiRecord(value)) return false;
  return (
    typeof value.file_id === "string" &&
    (value.source === "thread_upload" ||
      value.source === "thread_output" ||
      value.source === "thread_workspace" ||
      value.source === "project_document") &&
    typeof value.name === "string" &&
    Number.isInteger(value.size_bytes) &&
    typeof value.artifact_url === "string" &&
    (value.modified_at === null || typeof value.modified_at === "string") &&
    (value.storage_name === null || typeof value.storage_name === "string") &&
    (value.thread_id === null || typeof value.thread_id === "string") &&
    (value.thread_name === null || typeof value.thread_name === "string") &&
    (value.project_id === null || typeof value.project_id === "string") &&
    (value.project_name === null || typeof value.project_name === "string") &&
    (value.document_id === null || typeof value.document_id === "string")
  );
}

function isProductApiRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取登录用户的自有产品配置。新增产品 API 时复用这里的 fetchWithAuth，
 * 不要裸用浏览器 fetch，否则跨站 Cookie / CSRF 语义容易和 Gateway 不一致。
 */
export async function fetchProductBootstrap(
  signal?: AbortSignal,
): Promise<ProductBootstrap> {
  const response = await fetchWithAuth("/api/product/v1/bootstrap", { signal });
  if (!response.ok) {
    throw new Error(`Unable to load product settings (${response.status})`);
  }

  const payload: unknown = await response.json();
  if (!isProductBootstrap(payload)) {
    throw new Error("The product API returned an unsupported response");
  }
  return payload;
}

/**
 * 读取 Gateway 上真正运行的分发版本；这与前端构建版本分开显示，
 * 便于报告产品包和引擎包的版本不一致问题。
 */
export async function fetchProductRuntimeVersion(
  signal?: AbortSignal,
): Promise<ProductRuntimeVersion> {
  const response = await fetchWithAuth("/api/product/v1/version", { signal });
  if (!response.ok) {
    throw new Error(`Unable to load runtime versions (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isProductRuntimeVersion(payload)) {
    throw new Error("The product API returned unsupported version details");
  }
  return payload;
}

export function isProductRuntimeVersion(
  payload: unknown,
): payload is ProductRuntimeVersion {
  if (typeof payload !== "object" || payload === null) return false;
  const result = payload as Partial<ProductRuntimeVersion>;
  return (
    result.api_version === 1 &&
    typeof result.product?.name === "string" &&
    typeof result.product.version === "string" &&
    typeof result.engine?.name === "string" &&
    typeof result.engine.version === "string"
  );
}

/** 读取当前登录用户自己的偏好；user_id 由 Gateway principal 决定。 */
export async function fetchProductSettings(
  signal?: AbortSignal,
): Promise<ProductUserSettings> {
  const response = await fetchWithAuth("/api/product/v1/settings", { signal });
  if (!response.ok) {
    throw new ProductSettingsApiError(response.status);
  }

  const payload: unknown = await response.json();
  if (!isProductUserSettings(payload)) {
    throw new Error(
      "The product settings API returned an unsupported response",
    );
  }
  return payload;
}

/** 保存单项偏好；fetcher 会为 PUT 自动附加 Gateway 要求的 CSRF token。 */
export async function saveProductSetting(
  key: string,
  value: ProductJsonValue,
): Promise<void> {
  const response = await fetchWithAuth(
    `/api/product/v1/settings/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
  if (!response.ok) {
    throw new Error(`Unable to save personal settings (${response.status})`);
  }
}

/** 删除单项偏好，同样通过统一 fetcher 处理凭据和 CSRF。 */
export async function deleteProductSetting(key: string): Promise<void> {
  const response = await fetchWithAuth(
    `/api/product/v1/settings/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Unable to delete personal settings (${response.status})`);
  }
}

/**
 * 读取当前登录用户的产品偏好任务。Gateway principal 决定 owner，
 * 查询 key 也按用户分区，避免切换账号时闪现前一用户的任务状态。
 */
export async function fetchProductDataJobs(
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<ProductDataJobPage> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetchWithAuth(
    `/api/product/v1/data-jobs?${query.toString()}`,
    { signal },
  );
  if (!response.ok) {
    throw new ProductDataJobsApiError(response.status);
  }
  const payload: unknown = await response.json();
  if (!isProductDataJobPage(payload)) {
    throw new Error(
      "The product data-job API returned an unsupported response",
    );
  }
  return payload;
}

/** 创建一个明确范围的导出任务；幂等键避免网络重试重复创建作业。 */
export async function createProductDataExport(
  scope: ProductDataExportScope = "preferences",
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ProductDataJob> {
  const response = await fetchWithAuth("/api/product/v1/data-exports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ scope: [scope] }),
  });
  return readProductDataJobResponse(response, "Unable to create data export");
}

/**
 * 只允许明确范围；Gateway 会再次校验确认短语和当前用户所有权。
 */
export async function createProductDataDeletion(
  scope: ProductDataDeletionScope = "preferences",
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ProductDataJob> {
  const confirmation =
    scope === "threads"
      ? "DELETE THREAD HISTORY"
      : scope === "scheduled_tasks"
        ? "DELETE SCHEDULED TASKS"
        : scope === "agents"
          ? "DELETE CUSTOM AGENTS"
          : scope === "projects"
            ? "DELETE MY PROJECTS"
            : scope === "memory"
              ? "DELETE MY MEMORY"
              : scope === "files"
                ? "DELETE MY FILES"
                : "DELETE PREFERENCES";
  const response = await fetchWithAuth("/api/product/v1/data-deletions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      scope: [scope],
      confirmation,
    }),
  });
  return readProductDataJobResponse(response, "Unable to create data deletion");
}

/** 取消当前用户拥有的任务；API 对其他用户的任务统一返回 404。 */
export async function cancelProductDataJob(
  jobId: string,
): Promise<ProductDataJob> {
  const response = await fetchWithAuth(
    `/api/product/v1/data-jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
  return readProductDataJobResponse(
    response,
    "Unable to cancel preference task",
  );
}

/**
 * 下载仅限 owner 的短期制品；Gateway 再次校验状态和 24 小时过期时间。
 * 页面切换身份或卸载时传入 AbortSignal，避免旧账号的迟到响应继续触发下载。
 */
export async function downloadProductDataJobArtifact(
  jobId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchWithAuth(
    `/api/product/v1/data-jobs/${encodeURIComponent(jobId)}/artifact`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(
      `Unable to download preference export (${response.status})`,
    );
  }
  return response.blob();
}

async function readProductDataJobResponse(
  response: Response,
  errorPrefix: string,
): Promise<ProductDataJob> {
  if (!response.ok) throw new Error(`${errorPrefix} (${response.status})`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null) {
    throw new Error(
      "The product data-job API returned an unsupported response",
    );
  }
  if ((payload as { api_version?: unknown }).api_version !== 1) {
    throw new Error(
      "The product data-job API returned an unsupported response",
    );
  }
  const job = (payload as { job?: unknown }).job;
  if (!isProductDataJob(job)) {
    throw new Error(
      "The product data-job API returned an unsupported response",
    );
  }
  return job;
}

/** 管理员审计读取继续走登录态 fetcher；最终授权始终由 Gateway 校验。 */
export async function fetchProductAuditEvents(
  limit = 50,
  offset = 0,
  signal?: AbortSignal,
): Promise<ProductAuditPage> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetchWithAuth(
    `/api/product/v1/admin/audit-events?${query.toString()}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Unable to load audit events (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isProductAuditPage(payload)) {
    throw new Error("The audit API returned an unsupported response");
  }
  return payload;
}

export async function fetchProductAdminSettings(
  signal?: AbortSignal,
): Promise<ProductAdminSettings> {
  const response = await fetchWithAuth("/api/product/v1/admin/settings", {
    signal,
  });
  if (!response.ok) {
    throw new Error(`Unable to load product settings (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isProductAdminSettings(payload)) {
    throw new Error(
      "The product settings API returned an unsupported response",
    );
  }
  return payload;
}

export async function updateProductAdminSettings(
  settings: ProductAdminSettingsPatch,
): Promise<ProductAdminSettings> {
  const response = await fetchWithAuth("/api/product/v1/admin/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (response.status === 409) throw new ProductConfigConflictError();
  if (!response.ok) {
    throw new Error(`Unable to save product settings (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isProductAdminSettings(payload)) {
    throw new Error(
      "The product settings API returned an unsupported response",
    );
  }
  return payload;
}

/**
 * 账户状态属于 Gateway 认证契约，不写入产品扩展表；产品管理页只复用
 * 已登录会话访问核心管理 API，真正的管理员校验仍由 Gateway 完成。
 */
export async function fetchAdminUsers(
  limit = 50,
  offset = 0,
  signal?: AbortSignal,
): Promise<AdminUserPage> {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetchWithAuth(
    `/api/v1/auth/admin/users?${query.toString()}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Unable to load accounts (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isAdminUserPage(payload)) {
    throw new Error("The account API returned an unsupported response");
  }
  return payload;
}

export async function updateAdminUserStatus(
  userId: string,
  isActive: boolean,
): Promise<AdminUserStatusChange> {
  const response = await fetchWithAuth(
    `/api/v1/auth/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: isActive }),
    },
  );
  if (response.status === 409) throw new AdminUserStatusConflictError();
  if (!response.ok) {
    throw new Error(`Unable to update account status (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isAdminUserStatusChange(payload)) {
    throw new Error("The account API returned an unsupported response");
  }
  return payload;
}

/**
 * 验证服务端 DTO 的完整结构。网络响应本质上仍是不可信输入；只检查
 * `features` 是 object 会让缺字段或字符串开关悄悄进入 UI 配置。
 */
export function isProductBootstrap(
  payload: unknown,
): payload is ProductBootstrap {
  if (typeof payload !== "object" || payload === null) return false;
  const result = payload as Partial<ProductBootstrap>;
  const featureKeys: ProductFeatureKey[] = [
    "overview",
    "chats",
    "agents",
    "scheduled_tasks",
    "capabilities",
    "files",
    "data_privacy",
    "administration",
  ];
  return (
    result.api_version === 1 &&
    typeof result.product?.name === "string" &&
    typeof result.product.name_zh === "string" &&
    typeof result.product.features === "object" &&
    result.product.features !== null &&
    featureKeys.every(
      (key) => typeof result.product?.features[key] === "boolean",
    ) &&
    typeof result.user?.id === "string" &&
    typeof result.user.is_admin === "boolean"
  );
}

export function isProductUserSettings(
  payload: unknown,
): payload is ProductUserSettings {
  if (typeof payload !== "object" || payload === null) return false;
  const result = payload as Partial<ProductUserSettings>;
  return (
    result.api_version === 1 &&
    Array.isArray(result.settings) &&
    result.settings.every(
      (setting) =>
        typeof setting === "object" &&
        setting !== null &&
        typeof setting.key === "string" &&
        isProductJsonValue(setting.value),
    )
  );
}

/**
 * 数据任务来自服务端持久状态，轮询时也要验证每个字段；只校验 jobs 是数组
 * 会让坏响应在进度条或下载状态渲染时变成前端运行时错误。
 */
export function isProductDataJob(payload: unknown): payload is ProductDataJob {
  if (typeof payload !== "object" || payload === null) return false;
  const job = payload as Partial<ProductDataJob>;
  const statuses: ProductDataJobStatus[] = [
    "queued",
    "running",
    "retry_wait",
    "completed",
    "failed",
    "cancelled",
  ];
  return (
    typeof job.job_id === "string" &&
    (job.kind === "export" || job.kind === "deletion") &&
    Array.isArray(job.scope) &&
    job.scope.length === 1 &&
    (job.scope[0] === "preferences" ||
      (job.kind === "deletion" &&
        (job.scope[0] === "threads" ||
          job.scope[0] === "scheduled_tasks" ||
          job.scope[0] === "agents" ||
          job.scope[0] === "projects" ||
          job.scope[0] === "memory" ||
          job.scope[0] === "files")) ||
      (job.kind === "export" &&
        (job.scope[0] === "account" ||
          job.scope[0] === "threads" ||
          job.scope[0] === "projects" ||
          job.scope[0] === "scheduled_tasks" ||
          job.scope[0] === "agents" ||
          job.scope[0] === "memory" ||
          job.scope[0] === "files"))) &&
    statuses.includes(job.status!) &&
    typeof job.progress === "object" &&
    job.progress !== null &&
    typeof job.progress.stage === "string" &&
    Number.isInteger(job.progress.completed) &&
    job.progress.completed >= 0 &&
    Number.isInteger(job.progress.total) &&
    job.progress.total >= 0 &&
    isProductDataJobResult(job.result) &&
    (typeof job.error_code === "string" || job.error_code === null) &&
    typeof job.attempt === "number" &&
    Number.isInteger(job.attempt) &&
    job.attempt >= 0 &&
    typeof job.max_attempts === "number" &&
    Number.isInteger(job.max_attempts) &&
    job.max_attempts >= 1 &&
    typeof job.cancel_requested === "boolean" &&
    (typeof job.request_id === "string" || job.request_id === null) &&
    typeof job.created_at === "string" &&
    typeof job.updated_at === "string"
  );
}

function isProductDataJobResult(
  value: unknown,
): value is ProductDataJob["result"] {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const result = value;
  return (
    (result.artifact_id === undefined ||
      typeof result.artifact_id === "string") &&
    (result.sha256 === undefined || typeof result.sha256 === "string") &&
    (result.size_bytes === undefined ||
      (typeof result.size_bytes === "number" &&
        Number.isInteger(result.size_bytes) &&
        result.size_bytes >= 0)) &&
    (result.expires_at === undefined ||
      typeof result.expires_at === "string") &&
    (result.completeness === undefined ||
      result.completeness === "complete" ||
      result.completeness === "partial") &&
    (result.failed_resources_count === undefined ||
      (typeof result.failed_resources_count === "number" &&
        Number.isInteger(result.failed_resources_count) &&
        result.failed_resources_count >= 0)) &&
    (result.deleted_resources_count === undefined ||
      (typeof result.deleted_resources_count === "number" &&
        Number.isInteger(result.deleted_resources_count) &&
        result.deleted_resources_count >= 0)) &&
    (result.remaining_resources_count === undefined ||
      (typeof result.remaining_resources_count === "number" &&
        Number.isInteger(result.remaining_resources_count) &&
        result.remaining_resources_count >= 0))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProductDataJobPage(
  payload: unknown,
): payload is ProductDataJobPage {
  if (typeof payload !== "object" || payload === null) return false;
  const page = payload as Partial<ProductDataJobPage>;
  return (
    page.api_version === 1 &&
    Number.isInteger(page.limit) &&
    (page.limit ?? 0) >= 1 &&
    (page.limit ?? 101) <= 100 &&
    Number.isInteger(page.offset) &&
    (page.offset ?? -1) >= 0 &&
    Array.isArray(page.jobs) &&
    page.jobs.every(isProductDataJob) &&
    (page.has_more === undefined || typeof page.has_more === "boolean") &&
    (page.next_offset === undefined ||
      page.next_offset === null ||
      (Number.isInteger(page.next_offset) && page.next_offset >= 0))
  );
}

export function isProductAuditPage(
  payload: unknown,
): payload is ProductAuditPage {
  if (typeof payload !== "object" || payload === null) return false;
  const page = payload as Partial<ProductAuditPage>;
  return (
    page.api_version === 1 &&
    typeof page.limit === "number" &&
    Number.isInteger(page.limit) &&
    page.limit >= 1 &&
    page.limit <= 100 &&
    typeof page.offset === "number" &&
    Number.isInteger(page.offset) &&
    page.offset >= 0 &&
    Array.isArray(page.events) &&
    (page.has_more === undefined || typeof page.has_more === "boolean") &&
    page.events.every(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        typeof event.event_id === "string" &&
        typeof event.actor_user_id === "string" &&
        typeof event.action === "string" &&
        typeof event.resource_type === "string" &&
        typeof event.resource_id === "string" &&
        typeof event.outcome === "string" &&
        typeof event.occurred_at === "string" &&
        (typeof event.request_id === "string" || event.request_id === null),
    )
  );
}

export function isProductAdminSettings(
  payload: unknown,
): payload is ProductAdminSettings {
  if (typeof payload !== "object" || payload === null) return false;
  const result = payload as Partial<ProductAdminSettings>;
  const featureKeys: ProductFeatureKey[] = [
    "overview",
    "chats",
    "agents",
    "scheduled_tasks",
    "capabilities",
    "files",
    "data_privacy",
    "administration",
  ];
  return (
    result.api_version === 1 &&
    Number.isInteger(result.version) &&
    (result.version ?? -1) >= 0 &&
    typeof result.product?.name === "string" &&
    typeof result.product.name_zh === "string" &&
    typeof result.product.features === "object" &&
    result.product.features !== null &&
    featureKeys.every(
      (key) => typeof result.product?.features[key] === "boolean",
    )
  );
}

export function isAdminUserPage(payload: unknown): payload is AdminUserPage {
  if (typeof payload !== "object" || payload === null) return false;
  const page = payload as Partial<AdminUserPage>;
  return (
    Number.isInteger(page.total) &&
    (page.total ?? -1) >= 0 &&
    Number.isInteger(page.limit) &&
    (page.limit ?? 0) >= 1 &&
    (page.limit ?? 101) <= 100 &&
    Number.isInteger(page.offset) &&
    (page.offset ?? -1) >= 0 &&
    Array.isArray(page.users) &&
    page.users.every(isAdminUserSummary)
  );
}

export function isAdminUserSummary(
  payload: unknown,
): payload is AdminUserSummary {
  if (typeof payload !== "object" || payload === null) return false;
  const user = payload as Partial<AdminUserSummary>;
  return (
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    (user.system_role === "admin" || user.system_role === "user") &&
    typeof user.is_active === "boolean" &&
    typeof user.needs_setup === "boolean" &&
    typeof user.created_at === "string"
  );
}

export function isAdminUserStatusChange(
  payload: unknown,
): payload is AdminUserStatusChange {
  if (!isAdminUserSummary(payload)) return false;
  const result = payload as Partial<AdminUserStatusChange>;
  return (
    Number.isInteger(result.active_runs_stopped) &&
    (result.active_runs_stopped ?? -1) >= 0 &&
    Number.isInteger(result.active_runs_stop_pending) &&
    (result.active_runs_stop_pending ?? -1) >= 0 &&
    Number.isInteger(result.active_runs_stop_failed) &&
    (result.active_runs_stop_failed ?? -1) >= 0
  );
}

function isProductJsonValue(value: unknown): value is ProductJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isProductJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isProductJsonValue);
}
