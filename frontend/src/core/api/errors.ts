/**
 * Raised after the shared fetcher has started a login redirect for a 401.
 *
 * Callers may use this type to avoid showing a second, misleading API error
 * while the browser is already navigating to the authentication flow.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * A failed Gateway response with a stable HTTP status for product-level UX.
 * The message keeps the original detail for diagnostics, but callers should
 * map the status to localized copy instead of displaying `message` directly.
 */
export class GatewayApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayApiError";
  }
}

/** Read a Gateway error envelope while retaining status for safe UI mapping. */
export async function createGatewayApiError(
  response: Response,
  fallback: string,
): Promise<GatewayApiError> {
  const body = (await response.json().catch(() => ({}))) as {
    detail?: unknown;
  };
  return new GatewayApiError(
    response.status,
    typeof body.detail === "string" ? body.detail : fallback,
  );
}

/**
 * Throw an Error from a failed Gateway REST response.
 *
 * Parses the FastAPI error envelope (`{ detail: string }`) and falls back to
 * the caller-provided message when the body is missing or not that shape.
 * Shared by the domain API modules (channels, scheduled tasks) so the envelope
 * format is interpreted in exactly one place.
 */
export async function throwGatewayApiError(
  response: Response,
  fallback: string,
): Promise<never> {
  throw await createGatewayApiError(response, fallback);
}
