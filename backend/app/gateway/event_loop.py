"""Event-loop factory for the Gateway's uvicorn launchers.

psycopg's async support only works on selector-based event loops, while
uvicorn's default asyncio factory picks ``ProactorEventLoop`` on Windows when
the server runs without ``--reload``/workers (``make gateway``, root
``make start``, daemon mode). Under Proactor every pooled Postgres connection
fails, so Gateway startup dies with
``psycopg_pool.PoolTimeout: couldn't get a connection after 30.00 sec``.

Launchers therefore pass ``--loop app.gateway.event_loop:selector_event_loop``
so every platform and mode runs a ``SelectorEventLoop`` — identical to
uvicorn's own default everywhere except the broken
Windows-without-subprocess branch.
"""

from __future__ import annotations

import asyncio


def selector_event_loop_factory() -> asyncio.AbstractEventLoop:
    """Build a ``SelectorEventLoop`` (psycopg-async compatible on all platforms)."""
    return asyncio.SelectorEventLoop()
