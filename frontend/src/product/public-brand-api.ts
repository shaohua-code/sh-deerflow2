/** 未登录的公开页面只读取产品名；该 DTO 不包含 feature flags 或用户身份。 */
export type PublicProductBrand = {
  api_version: 1;
  product: { name: string; name_zh: string };
};

/** 公开首页的匿名请求保持独立，避免根布局引入登录后的产品 API。 */
export async function fetchPublicProductBrand(
  signal?: AbortSignal,
): Promise<PublicProductBrand> {
  // 与 isStaticWebsiteOnly 保持同一精确字面值判断；公开根布局无需载入完整 env 校验器。
  if (process.env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true") {
    throw new Error("Public product brand is unavailable in static demo mode");
  }
  const response = await globalThis.fetch("/api/product/v1/public-brand", {
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Unable to load public product brand (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isPublicProductBrand(payload)) {
    throw new Error(
      "The public product-brand API returned an unsupported response",
    );
  }
  return payload;
}

export function isPublicProductBrand(
  payload: unknown,
): payload is PublicProductBrand {
  if (!isRecord(payload)) return false;
  const product = payload.product;
  return (
    Object.keys(payload).length === 2 &&
    Object.hasOwn(payload, "api_version") &&
    Object.hasOwn(payload, "product") &&
    payload.api_version === 1 &&
    isRecord(product) &&
    Object.keys(product).length === 2 &&
    Object.hasOwn(product, "name") &&
    Object.hasOwn(product, "name_zh") &&
    typeof product.name === "string" &&
    typeof product.name_zh === "string" &&
    product.name.trim().length > 0 &&
    product.name_zh.trim().length > 0 &&
    [...product.name].length <= 80 &&
    [...product.name_zh].length <= 80
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
