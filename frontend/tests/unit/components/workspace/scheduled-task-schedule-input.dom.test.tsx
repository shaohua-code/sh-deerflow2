import { afterEach, describe, expect, test } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  ScheduledTaskScheduleInput,
  type ScheduleValue,
} from "@/components/workspace/scheduled-task-schedule-input";
import { I18nProvider } from "@/core/i18n/context";

afterEach(cleanup);

describe("ScheduledTaskScheduleInput", () => {
  test.each([1, 30, 59])(
    "preserves an existing %s-second interval until explicitly edited",
    (everySeconds) => {
      const emitted: ScheduleValue[] = [];
      render(
        <I18nProvider initialLocale="en-US">
          <ScheduledTaskScheduleInput
            initial={{
              schedule_type: "interval",
              schedule_spec: { every_seconds: everySeconds },
              timezone: "UTC",
            }}
            onChange={(value) => emitted.push(value)}
          />
        </I18nProvider>,
      );

      const amountInput = screen.getByRole<HTMLInputElement>("spinbutton");
      expect(amountInput.value).toBe(String(everySeconds));
      expect(emitted.at(-1)?.schedule_spec.every_seconds).toBe(everySeconds);

      fireEvent.focus(amountInput);
      fireEvent.blur(amountInput);
      expect(amountInput.value).toBe(String(everySeconds));
      expect(emitted.at(-1)?.schedule_spec.every_seconds).toBe(everySeconds);

      fireEvent.change(amountInput, { target: { value: "9" } });
      expect(amountInput.value).toBe("9");
      expect(emitted.at(-1)?.schedule_spec.every_seconds).toBe(60);
      fireEvent.blur(amountInput);
      expect(amountInput.value).toBe("60");
    },
  );

  test("keeps interval text editable until blur applies the floor", () => {
    const emitted: ScheduleValue[] = [];

    render(
      <I18nProvider initialLocale="en-US">
        <ScheduledTaskScheduleInput
          initial={{
            schedule_type: "interval",
            schedule_spec: { every_seconds: 90 },
            timezone: "UTC",
          }}
          onChange={(value) => emitted.push(value)}
        />
      </I18nProvider>,
    );

    const amountInput = screen.getByRole("spinbutton");
    expect((amountInput as HTMLInputElement).value).toBe("90");
    expect(emitted.at(-1)?.schedule_spec.every_seconds).toBe(90);

    fireEvent.change(amountInput, { target: { value: "9" } });
    expect((amountInput as HTMLInputElement).value).toBe("9");
    expect(emitted.at(-1)?.schedule_spec.every_seconds).toBe(60);

    fireEvent.change(amountInput, { target: { value: "" } });
    expect((amountInput as HTMLInputElement).value).toBe("");
    expect(emitted.at(-1)?.schedule_spec.every_seconds).toBe(60);

    fireEvent.blur(amountInput);
    expect((amountInput as HTMLInputElement).value).toBe("60");
    expect(emitted.at(-1)?.schedule_spec.every_seconds).toBe(60);
  });

  test.each([
    {
      locale: "en-US" as const,
      repeatLabel: "Repeat",
      timezoneLabel: "Timezone",
      intervalLabel: "Interval",
      intervalUnitLabel: "Interval unit",
    },
    {
      locale: "zh-CN" as const,
      repeatLabel: "重复方式",
      timezoneLabel: "时区",
      intervalLabel: "间隔",
      intervalUnitLabel: "间隔单位",
    },
  ])(
    "provides localized names for schedule selectors in $locale",
    ({
      locale,
      repeatLabel,
      timezoneLabel,
      intervalLabel,
      intervalUnitLabel,
    }) => {
      // Match the cookie-backed locale selection used on real workspace pages.
      document.cookie = `locale=${locale}; path=/`;
      render(
        <I18nProvider initialLocale={locale}>
          <ScheduledTaskScheduleInput
            initial={{
              schedule_type: "cron",
              schedule_spec: { cron: "0 9 * * *" },
              timezone: "UTC",
            }}
            onChange={() => undefined}
          />
        </I18nProvider>,
      );

      expect(screen.getByRole("combobox", { name: repeatLabel })).toBeTruthy();
      expect(
        screen.getByRole("combobox", { name: timezoneLabel }),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: intervalLabel }));
      expect(
        screen.getByRole("combobox", { name: intervalUnitLabel }),
      ).toBeTruthy();
    },
  );
});
