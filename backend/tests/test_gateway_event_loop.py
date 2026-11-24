"""Windows Gateway startup must run on a SelectorEventLoop, never Proactor.

uvicorn's default asyncio loop factory returns ``ProactorEventLoop`` on Windows
when the server starts without ``--reload``/workers (backend ``make gateway``,
root ``make start``, daemon mode). psycopg's async support only works on
selector loops, so the checkpointer's connection pool failed every connection
and startup died with ``psycopg_pool.PoolTimeout: couldn't get a connection
after 30.00 sec`` before the Gateway finished booting (``--reload`` dev runs
were unaffected because uvicorn selects a selector loop for subprocess mode).

Three layers of coverage:

* the factory itself always builds a ``SelectorEventLoop``;
* uvicorn's real ``Config.get_loop_factory`` accepts the launchers' ``--loop``
  import string and yields a selector loop on the broken code path;
* every no-reload launcher (``scripts/serve.sh``, backend ``Makefile``) pins
  the flag so the default factory can never be picked again.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import uvicorn

from app.gateway.event_loop import selector_event_loop_factory

REPO_ROOT = Path(__file__).resolve().parents[2]

LOOP_FLAG = "--loop app.gateway.event_loop:selector_event_loop_factory"


def test_selector_event_loop_factory_returns_selector_loop() -> None:
    loop = selector_event_loop_factory()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()


def test_uvicorn_custom_loop_flag_builds_a_selector_loop() -> None:
    """Resolve the flag exactly as ``uvicorn`` does for a no-subprocess server."""
    config = uvicorn.Config(app="app.gateway.app:app", loop=LOOP_FLAG.removeprefix("--loop "))

    loop = config.get_loop_factory()()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()


def test_no_reload_launchers_pin_the_selector_loop() -> None:
    serve = (REPO_ROOT / "scripts" / "serve.sh").read_text(encoding="utf-8")
    makefile = (REPO_ROOT / "backend" / "Makefile").read_text(encoding="utf-8")

    # serve.sh: the flag must sit on the gateway launch line (not the
    # process-kill or comment lines), before the optional dev --reload flags,
    # so prod/daemon mode cannot miss it.
    gateway_line = next(line for line in serve.splitlines() if "uvicorn app.gateway.app:app" in line and "--port 8001" in line)
    assert LOOP_FLAG in gateway_line

    # backend Makefile: the no-reload `gateway` target must carry the flag.
    assert f"uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001 {LOOP_FLAG}" in makefile
