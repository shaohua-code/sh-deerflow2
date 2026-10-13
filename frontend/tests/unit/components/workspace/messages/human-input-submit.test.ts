import { describe, expect, it, rs } from "@rstest/core";

import { submitHumanInputWithRecovery } from "@/components/workspace/messages/human-input-submit";

describe("submitHumanInputWithRecovery", () => {
  it("keeps the pending state when dispatch succeeds", async () => {
    const clearPending = rs.fn();
    const onFailure = rs.fn();

    await expect(
      submitHumanInputWithRecovery(async () => true, clearPending, onFailure),
    ).resolves.toBe(true);

    expect(clearPending).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("unlocks the card when the sender declines the response", async () => {
    const clearPending = rs.fn();
    const onFailure = rs.fn();

    await expect(
      submitHumanInputWithRecovery(() => false, clearPending, onFailure),
    ).resolves.toBe(false);

    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("catches dispatch errors, unlocks the card, and forwards the error to its handler", async () => {
    const clearPending = rs.fn();
    const onFailure = rs.fn();
    const privateError = new Error("private Gateway detail");

    await expect(
      submitHumanInputWithRecovery(
        () => Promise.reject(privateError),
        clearPending,
        onFailure,
      ),
    ).resolves.toBe(false);

    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(privateError);
  });
});
