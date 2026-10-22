"use client";

import { useEffect, useState } from "react";

import type { Locale } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import {
  formatTimeAgo,
  TIME_AGO_HYDRATION_PLACEHOLDER,
} from "@/core/utils/datetime";

/** 客户端挂载后再展示相对时间，避免 SSR/hydration 与 locale 或“当前时刻”不一致。 */
export function useRelativeTimesReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  return ready;
}

export function useTimeAgoText(
  date: Date | string | number | null | undefined,
  locale?: Locale,
): string {
  const { locale: contextLocale } = useI18n();
  const effectiveLocale = locale ?? contextLocale;
  const relativeTimesReady = useRelativeTimesReady();

  if (date == null || date === "") {
    return TIME_AGO_HYDRATION_PLACEHOLDER;
  }
  if (!relativeTimesReady) {
    return TIME_AGO_HYDRATION_PLACEHOLDER;
  }
  return formatTimeAgo(date, effectiveLocale);
}

type TimeAgoProps = {
  date: Date | string | number;
  locale?: Locale;
  className?: string;
};

export function TimeAgo({ date, className, locale }: TimeAgoProps) {
  const text = useTimeAgoText(date, locale);

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
