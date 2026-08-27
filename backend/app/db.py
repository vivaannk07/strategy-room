"""Postgres connection helpers.

Deliberately synchronous. The ingest path is a lazy, one-off cache fill rather than
something on the hot request path, and psycopg's async mode needs a non-default
event loop policy on Windows. FastAPI routes should call into ingest via
`fastapi.concurrency.run_in_threadpool` rather than awaiting it directly.

Connections come from a pool. The database is remote (Neon, us-east-2), where opening
a fresh connection costs ~1.4s against ~0.4s for a query - so on a read path that is
otherwise a handful of indexed lookups, connection setup was the entire response time.
The pool is created lazily so importing this module never touches the network, which
keeps the CLI scripts and tests cheap.
"""

from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

import psycopg
from psycopg_pool import ConnectionPool

from app.config import database_url

# Tables the cache owns, in dependency order (parents first).
CACHE_TABLES = ("drivers", "races", "race_results", "laps", "pit_stops")

# Sized for uvicorn's default threadpool rather than for load: every DB call runs in a
# worker thread, so the pool only needs to cover the threads that can be busy at once.
POOL_MIN_SIZE = 1
POOL_MAX_SIZE = 8
# Retire idle connections well before the server hangs up on them. This replaces a
# per-checkout liveness ping, which would be free on a local database but costs a full
# round trip (~0.4s here) on every single request against a remote one.
POOL_MAX_IDLE_SECONDS = 120.0


@lru_cache
def pool() -> ConnectionPool:
    """The process-wide connection pool, opened on first use."""
    return ConnectionPool(
        database_url(),
        min_size=POOL_MIN_SIZE,
        max_size=POOL_MAX_SIZE,
        max_idle=POOL_MAX_IDLE_SECONDS,
        # Don't block startup on the first connection; the first caller waits instead.
        open=True,
    )


def close_pool() -> None:
    """Shut the pool down. Called from the FastAPI lifespan; a no-op if never opened."""
    if pool.cache_info().currsize:
        pool().close()
        pool.cache_clear()


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Check out a pooled connection, committing on clean exit and rolling back on error."""
    with pool().connection() as conn:
        yield conn


def missing_tables(conn: psycopg.Connection) -> list[str]:
    """Which of the cache tables don't exist yet - i.e. schema.sql hasn't been run."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = current_schema() AND table_name = ANY(%s)",
            (list(CACHE_TABLES),),
        )
        present = {row[0] for row in cur.fetchall()}
    return [name for name in CACHE_TABLES if name not in present]
