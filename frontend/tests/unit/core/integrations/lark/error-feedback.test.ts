import { afterEach, describe, expect, it, rs } from "@rstest/core";

const mocks = rs.hoisted(() => ({ toastError: rs.fn() }));
rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { reportLarkFailure } from "@/core/integrations/lark/error-feedback";

afterEach(() => {
  mocks.toastError.mockReset();
  rs.restoreAllMocks();
});

describe("Lark integration failure feedback", () => {
  it("keeps the Gateway detail in diagnostics and shows only localized copy", () => {
    const error = new Error("private Gateway path and credential detail");
    const log = rs.spyOn(console, "error").mockImplementation(() => undefined);

    reportLarkFailure(
      "install",
      error,
      "The integration could not be installed.",
    );

    expect(log).toHaveBeenCalledWith(
      "Failed to install Lark integration:",
      error,
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "The integration could not be installed.",
      undefined,
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(error.message);
  });

  it("preserves the existing toast identity while replacing authorization errors", () => {
    const error = new Error("OAuth provider response detail");
    const log = rs.spyOn(console, "error").mockImplementation(() => undefined);
    const toastOptions = { id: "authorization-toast" };

    reportLarkFailure(
      "complete-authorization",
      error,
      "Authorization could not be completed.",
      toastOptions,
    );

    expect(log).toHaveBeenCalledWith(
      "Failed to complete Lark authorization:",
      error,
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Authorization could not be completed.",
      toastOptions,
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith(error.message);
  });
});
