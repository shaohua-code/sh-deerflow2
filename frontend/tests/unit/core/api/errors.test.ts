import { describe, expect, it } from "@rstest/core";

import {
  createGatewayApiError,
  GatewayApiError,
  throwGatewayApiError,
} from "@/core/api/errors";

describe("GatewayApiError", () => {
  it("preserves the HTTP status and detail for operation-level mapping", async () => {
    const response = {
      status: 409,
      json: async () => ({ detail: "private backend conflict detail" }),
    } as unknown as Response;

    const error = await createGatewayApiError(response, "Safe fallback");

    expect(error).toBeInstanceOf(GatewayApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("private backend conflict detail");
  });

  it("uses the caller fallback when the error envelope cannot be parsed", async () => {
    const response = {
      status: 503,
      json: async () => {
        throw new Error("response body unavailable");
      },
    } as unknown as Response;

    const error = await createGatewayApiError(response, "Safe fallback");

    expect(error.status).toBe(503);
    expect(error.message).toBe("Safe fallback");
  });

  it("throws the typed error through the shared Gateway helper", async () => {
    const response = {
      status: 500,
      json: async () => ({ detail: "private storage information" }),
    } as unknown as Response;

    await expect(
      throwGatewayApiError(response, "Safe fallback"),
    ).rejects.toMatchObject({
      name: "GatewayApiError",
      status: 500,
      message: "private storage information",
    });
  });
});
