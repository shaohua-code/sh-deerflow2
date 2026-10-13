import { afterEach, describe, expect, it, rs } from "@rstest/core";

const mocks = rs.hoisted(() => ({ toastError: rs.fn() }));
rs.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { reportSidecarFailure } from "@/core/sidecar/error-feedback";

afterEach(() => {
  mocks.toastError.mockReset();
  rs.restoreAllMocks();
});

describe("sidecar failure feedback", () => {
  it.each([
    ["send", "Failed to send sidecar message:"],
    ["delete", "Failed to delete sidecar thread:"],
  ] as const)(
    "keeps %s details out of the user notification",
    (action, label) => {
      const error = new Error("private Gateway database detail");
      const log = rs
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      reportSidecarFailure(action, error, "The operation failed. Try again.");

      expect(log).toHaveBeenCalledWith(label, error);
      expect(mocks.toastError).toHaveBeenCalledWith(
        "The operation failed. Try again.",
      );
      expect(mocks.toastError).not.toHaveBeenCalledWith(error.message);
    },
  );
});
