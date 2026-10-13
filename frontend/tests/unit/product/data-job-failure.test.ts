import { describe, expect, it } from "@rstest/core";

import {
  getDataJobFailureReason,
  isRetryableDataJobFailure,
} from "@/product/data-job-failure";

describe("getDataJobFailureReason", () => {
  it("maps only explicitly supported backend error codes", () => {
    expect(getDataJobFailureReason("export_size_limit")).toBe("sizeLimit");
    expect(getDataJobFailureReason("temporary_storage_error")).toBe(
      "temporary",
    );
    expect(getDataJobFailureReason("authorization_revoked")).toBe(
      "authorizationDenied",
    );
    expect(getDataJobFailureReason("authorization_unavailable")).toBe(
      "authorizationUnavailable",
    );
  });

  it("treats object prototype keys and arbitrary strings as unknown", () => {
    for (const errorCode of [
      "constructor",
      "toString",
      "__proto__",
      "internal-secret-path",
    ]) {
      expect(getDataJobFailureReason(errorCode)).toBe("unknown");
    }
    expect(getDataJobFailureReason(undefined)).toBe("unknown");
  });
});

describe("isRetryableDataJobFailure", () => {
  it("allows explicit retries only for temporary and unavailable scopes", () => {
    expect(isRetryableDataJobFailure("temporary_storage_error")).toBe(true);
    expect(isRetryableDataJobFailure("scope_unavailable")).toBe(true);
    expect(isRetryableDataJobFailure("authorization_unavailable")).toBe(true);
    expect(isRetryableDataJobFailure("authorization_revoked")).toBe(false);
    expect(isRetryableDataJobFailure("export_size_limit")).toBe(false);
    expect(isRetryableDataJobFailure("unknown_internal_error")).toBe(false);
  });
});
