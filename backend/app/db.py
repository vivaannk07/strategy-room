"""Postgres connection helpers.

Deliberately synchronous. The ingest path is a lazy, one-off cache fill rather than
something on the hot request path, and psycopg's async mode needs a non-default
event loop policy on Windows. FastAPI routes should call into ingest via
`fastapi.concurrency.run_in_threadpool` rather than awaiting it directly.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg

from app.config import database_url

# Tables the cache owns, in dependency order (parents first).
CACHE_TABLES = ("drivers", "races", "race_results", "laps", "pit_stops")


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Open a connection, committing on clean exit and rolling back on error."""
    with psycopg.connect(database_url()) as conn:
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
