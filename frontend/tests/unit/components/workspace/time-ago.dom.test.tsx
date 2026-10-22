import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { TimeAgo } from "@/components/workspace/time-ago";
import { I18nProvider } from "@/core/i18n/context";

function Wrapper({ children }: PropsWithChildren) {
  return <I18nProvider initialLocale="en-US">{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe("TimeAgo", () => {
  it("renders a localized relative label", () => {
    render(
      <Wrapper>
        <TimeAgo date="2020-01-01T00:00:00.000Z" />
      </Wrapper>,
    );

    expect(screen.getByText(/ago/i)).toBeTruthy();
  });
});
