"""FastAPI entrypoint. Dev base URL is http://localhost:8000/api (see api-contract.md)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import close_pool
from app.routers import races, simulate


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The connection pool opens lazily on the first query, not here, so a database
    # that's briefly unreachable doesn't stop the server from starting.
    yield
    close_pool()


app = FastAPI(
    title="Strategy Room API",
    description="Re-simulates F1 pit strategies against real past races.",
    version="0.1.0",
    lifespan=lifespan,
)

# The Vite dev server runs on 5173.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(races.router)
app.include_router(simulate.router)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
