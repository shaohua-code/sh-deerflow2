/** 产品数据任务只展示明确允许公开的错误码，不透传异常文本。 */
export type DataJobFailureReason =
  | "temporary"
  | "authorizationUnavailable"
  | "authorizationDenied"
  | "scopeUnavailable"
  | "sizeLimit"
  | "unsupported"
  | "invalidData"
  | "integrity"
  | "unknown";

const REASON_BY_ERROR_CODE: Readonly<Record<string, DataJobFailureReason>> = {
  account_export_size_limit: "sizeLimit",
  authorization_revoked: "authorizationDenied",
  authorization_unavailable: "authorizationUnavailable",
  export_size_limit: "sizeLimit",
  invalid_deleter_result: "invalidData",
  invalid_export_data: "invalidData",
  invalid_reader_page: "invalidData",
  no_export_scopes_available: "scopeUnavailable",
  scope_unavailable: "scopeUnavailable",
  scope_export_incomplete: "invalidData",
  unsupported_job_kind: "unsupported",
  unsupported_scope: "unsupported",
  invalid_scope_artifact: "integrity",
  scope_artifact_integrity_error: "integrity",
  temporary_storage_error: "temporary",
  worker_lease_exhausted: "temporary",
};

/** 中文说明：只把后端稳定枚举映射为产品文案；新增错误码时需先确认其不含路径或用户数据。 */
export function getDataJobFailureReason(
  errorCode: string | null | undefined,
): DataJobFailureReason {
  // 不能直接依赖普通对象索引：constructor、toString 等原型键不是白名单项。
  return errorCode && Object.hasOwn(REASON_BY_ERROR_CODE, errorCode)
    ? (REASON_BY_ERROR_CODE[errorCode] ?? "unknown")
    : "unknown";
}

/** 暂时错误和授权服务中断允许重建导出；权限撤销及删除操作不能重试。 */
export function isRetryableDataJobFailure(
  errorCode: string | null | undefined,
): boolean {
  const reason = getDataJobFailureReason(errorCode);
  return (
    reason === "temporary" ||
    reason === "scopeUnavailable" ||
    reason === "authorizationUnavailable"
  );
}
