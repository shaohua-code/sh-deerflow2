"""Exercise the dev homepage readiness probe against a local HTTP server."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from scripts.wait_for_http import HttpReadinessTimeout, wait_for_http


@contextmanager
def _http_server(
    responses: list[tuple[int, str]],
    *,
    incomplete_body: bool = False,
) -> Iterator[tuple[str, list[tuple[str, str | None]]]]:
    requests: list[tuple[str, str | None]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
            requests.append((self.path, self.headers.get("Accept")))
            status, content_type = responses[min(len(requests) - 1, len(responses) - 1)]
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            if status == 302:
                self.send_header("Location", "/ready")
            if incomplete_body:
                self.send_header("Content-Length", "100")
            self.end_headers()
            if incomplete_body:
                body = b"<"
            elif content_type == "text/html":
                body = b"<html>ready</html>"
            else:
                body = b"not ready"
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                # A timed-out probe may close before this local test server writes.
                pass

        def log_message(self, _format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/", requests
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


def test_retries_transient_http_error_until_homepage_is_ready() -> None:
    with _http_server([(503, "text/html"), (200, "text/html")]) as (url, requests):
        attempts, _elapsed = wait_for_http(
            url, timeout_seconds=2, retry_interval_seconds=0.01
        )

    assert attempts == 2
    assert requests == [("/", "text/html"), ("/", "text/html")]


def test_requires_html_not_just_an_open_port_or_http_200() -> None:
    with _http_server([(200, "application/json"), (200, "text/html")]) as (
        url,
        requests,
    ):
        attempts, _elapsed = wait_for_http(
            url, timeout_seconds=2, retry_interval_seconds=0.01
        )

    assert attempts == 2
    assert len(requests) == 2


def test_http_error_cannot_pass_the_bounded_wait() -> None:
    with _http_server([(503, "text/html")]) as (url, requests):
        with pytest.raises(HttpReadinessTimeout, match=r"No HTTP 200 HTML"):
            wait_for_http(url, timeout_seconds=1, retry_interval_seconds=0.01)

    assert requests


def test_redirect_does_not_count_as_homepage_readiness() -> None:
    with _http_server([(302, "text/html")]) as (url, requests):
        with pytest.raises(HttpReadinessTimeout, match=r"No HTTP 200 HTML"):
            wait_for_http(url, timeout_seconds=1, retry_interval_seconds=0.01)

    assert requests
    assert all(path == "/" for path, _accept in requests)


def test_incomplete_html_body_does_not_count_as_ready() -> None:
    with _http_server([(200, "text/html")], incomplete_body=True) as (url, requests):
        with pytest.raises(HttpReadinessTimeout, match=r"No HTTP 200 HTML"):
            wait_for_http(url, timeout_seconds=1, retry_interval_seconds=0.01)

    assert requests
