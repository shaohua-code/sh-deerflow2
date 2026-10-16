"""Wait for a development HTTP page to serve HTML, not merely open a port."""

from __future__ import annotations

import argparse
import math
import sys
import time
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class HttpReadinessTimeout(TimeoutError):
    """The page never returned an HTTP 200 HTML response within the deadline."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def wait_for_http(
    url: str,
    *,
    timeout_seconds: float = 300,
    request_timeout_seconds: float = 30,
    retry_interval_seconds: float = 1,
) -> tuple[int, float]:
    """Return (attempts, elapsed seconds) once a GET of *url* serves HTML.

    A port can listen while Next.js still compiles its first route. Use one
    monotonic deadline across transient connection failures and HTTP errors.
    Disable environment proxies because this probes the local nginx listener.
    """
    for name, value in (
        ("timeout_seconds", timeout_seconds),
        ("request_timeout_seconds", request_timeout_seconds),
        ("retry_interval_seconds", retry_interval_seconds),
    ):
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"{name} must be a positive finite number")

    started = time.monotonic()
    deadline = started + timeout_seconds
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    request = Request(
        url,
        headers={"Accept": "text/html", "Cache-Control": "no-cache"},
        method="GET",
    )
    attempts = 0
    last_result = "no response"

    while (remaining := deadline - time.monotonic()) > 0:
        attempts += 1
        try:
            with opener.open(
                request, timeout=min(request_timeout_seconds, remaining)
            ) as response:
                status = response.status
                content_type = response.headers.get_content_type()
                if (
                    status == 200
                    and content_type == "text/html"
                    and response.geturl() == url
                ):
                    # Finish the GET before reporting readiness. The first
                    # streamed byte alone need not mean the route is done.
                    content_length = response.headers.get("Content-Length")
                    expected_bytes = (
                        int(content_length)
                        if content_length is not None and content_length.isdecimal()
                        else None
                    )
                    received_bytes = 0
                    while time.monotonic() < deadline:
                        # read1 returns after at most one socket read. A slow
                        # streaming response cannot keep one read(64 KiB)
                        # alive indefinitely by trickling bytes.
                        chunk = response.read1(64 * 1024)
                        if not chunk:
                            if (
                                expected_bytes is not None
                                and received_bytes != expected_bytes
                            ):
                                last_result = (
                                    "HTTP 200 HTML incomplete body "
                                    f"({received_bytes}/{expected_bytes} bytes)"
                                )
                            elif received_bytes and time.monotonic() < deadline:
                                return attempts, time.monotonic() - started
                            elif received_bytes:
                                last_result = "HTTP 200 HTML body exceeded the deadline"
                            else:
                                last_result = "HTTP 200 HTML with an empty body"
                            break
                        received_bytes += len(chunk)
                    else:
                        last_result = "HTTP 200 HTML body exceeded the deadline"
                else:
                    last_result = (
                        f"HTTP {status} ({content_type}, URL {response.geturl()})"
                    )
        except HTTPError as exc:
            last_result = f"HTTP {exc.code}"
            exc.close()
        except (URLError, TimeoutError, OSError, HTTPException) as exc:
            last_result = f"{type(exc).__name__}: {exc}"

        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(retry_interval_seconds, remaining))

    raise HttpReadinessTimeout(
        f"No HTTP 200 HTML from {url} within {timeout_seconds:g}s "
        f"after {attempts} attempt(s); last result: {last_result}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Local page to prewarm")
    parser.add_argument("--timeout-seconds", type=float, default=300)
    args = parser.parse_args(argv)

    print(f"Prewarming development homepage at {args.url} ...", flush=True)
    try:
        attempts, elapsed = wait_for_http(
            args.url, timeout_seconds=args.timeout_seconds
        )
    except (HttpReadinessTimeout, ValueError) as exc:
        print(
            f"ERROR: Development homepage is not ready: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 1
    print(
        f"OK: Development homepage ready in {elapsed:.1f}s ({attempts} attempt(s))",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
