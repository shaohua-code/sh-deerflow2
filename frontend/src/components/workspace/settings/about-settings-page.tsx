"use client";

import { useQuery } from "@tanstack/react-query";

import { createMarkdownLinkComponent } from "@/components/workspace/messages/markdown-link";
import { useI18n } from "@/core/i18n/hooks";
import {
  SafeStreamdown,
  toStreamdownComponents,
} from "@/core/streamdown/components";
import { fetchProductRuntimeVersion } from "@/product/api";
import { getProductCopy } from "@/product/copy";
import { APP_VERSION } from "@/version";

import { getAboutMarkdown } from "./about-content";

export function AboutSettingsPage() {
  const { locale } = useI18n();
  const copy = getProductCopy(locale);
  const versionQuery = useQuery({
    queryKey: ["product", "runtime-version"],
    queryFn: ({ signal }) => fetchProductRuntimeVersion(signal),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return (
    <div className="space-y-6">
      <SafeStreamdown
        components={toStreamdownComponents({
          // Product copy is trusted, but Streamdown's default <a> still
          // injects a block overlay inside <p>. Use the same phrasing-level
          // anchor as chat/memory markdown.
          a: createMarkdownLinkComponent(),
        })}
      >
        {getAboutMarkdown(locale)}
      </SafeStreamdown>
      <section className="border-border/70 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">{copy.runtimeVersions}</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{copy.runtimeFrontend}</dt>
            <dd className="font-mono">{APP_VERSION}</dd>
          </div>
          {versionQuery.data ? (
            <>
              <div>
                <dt className="text-muted-foreground">{copy.runtimeProduct}</dt>
                <dd className="font-mono">
                  {versionQuery.data.product.version}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{copy.runtimeEngine}</dt>
                <dd className="font-mono">
                  {versionQuery.data.engine.name}{" "}
                  {versionQuery.data.engine.version}
                </dd>
              </div>
            </>
          ) : versionQuery.isLoading ? (
            <dd role="status" className="text-muted-foreground">
              {copy.loading}
            </dd>
          ) : (
            <dd role="status" className="text-muted-foreground">
              {copy.runtimeVersionUnavailable}
            </dd>
          )}
        </dl>
      </section>
    </div>
  );
}
