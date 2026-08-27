"""Environment-backed settings.

Reads the project-root .env (one level above backend/), so the same file serves
the API server, the ingest CLI and any ad-hoc script.
"""

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(PROJECT_ROOT / ".env")

DEFAULT_JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1"


@lru_cache
def database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError(
            f"DATABASE_URL is not set. Copy .env.example to .env in {PROJECT_ROOT} "
            "and fill in the Postgres connection string."
        )
    return url


@lru_cache
def jolpica_base() -> str:
    return os.getenv("JOLPICA_API_BASE", DEFAULT_JOLPICA_BASE).rstrip("/")
