"""Jolpica API client.

Jolpica is the actively maintained successor to Ergast and speaks the same shape:
everything is wrapped in `MRData.RaceTable.Races[]`, and *every scalar is a string*.
All casting to int/float/date happens here so nothing downstream has to think about it.

Two upstream behaviours drive most of this module:

- A season/round that doesn't exist returns **HTTP 200 with an empty `Races` array**,
  not a 404. `RaceNotFoundError` translates that into something callers can catch.
- Collection endpoints are paginated with a default `limit` of 30. `/laps.json` pages
  by *individual driver timing* rather than by lap - the 2024 Italian GP is
  `total: 1008` - so a lap's `Timings` can straddle a page boundary and must be
  merged, not just concatenated. `/pitstops.json` for that same race reports
  `total: 30` against a default limit of 30, i.e. exactly at the boundary, so every
  collection endpoint here is paged rather than just the one the docs call out.
"""

from __future__ import annotations

import datetime
import time
from dataclasses import dataclass, field, replace
from typing import Any, Iterator

import httpx

from app.config import jolpica_base

# Jolpica allows a modest anonymous burst rate. 100 keeps a full lap set for one
# race to ~11 requests while staying inside the per-request cap.
PAGE_SIZE = 100
MAX_PAGES = 200
REQUEST_TIMEOUT = 30.0
RETRY_STATUSES = (429, 500, 502, 503, 504)
MAX_RETRIES = 4


class JolpicaError(RuntimeError):
    """Upstream returned something we can't use."""


class RaceNotFoundError(JolpicaError):
    """Jolpica returned HTTP 200 with an empty `Races` array for this season/round."""

    def __init__(self, season: int, round_: int, endpoint: str) -> None:
        super().__init__(
            f"Jolpica has no data for season={season} round={round_} at {endpoint} "
            "(HTTP 200 with an empty Races array)."
        )
        self.season = season
        self.round = round_
        self.endpoint = endpoint


# ---------------------------------------------------------------------------
# Casting helpers - Jolpica hands back strings for everything, including numbers,
# and omits keys entirely rather than sending null.
# ---------------------------------------------------------------------------


def _to_int(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _to_float(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def parse_lap_time(raw: str | None) -> float | None:
    """Turn a "1:27.623" lap time into 87.623 seconds.

    Also handles bare seconds and h:mm:ss.SSS. Lap times and pit durations come back
    in different formats from the same API: `Timings[].time` is mm:ss.SSS, while
    `PitStops[].duration` is already plain seconds.
    """
    if not raw:
        return None
    parts = str(raw).strip().split(":")
    try:
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60.0 + float(part)
    except ValueError:
        return None
    return round(seconds, 3)


def _parse_date(raw: str | None) -> datetime.date | None:
    if not raw:
        return None
    try:
        return datetime.date.fromisoformat(raw)
    except ValueError:
        return None


def _parse_time_of_day(raw: str | None) -> datetime.time | None:
    """Turn a "15:10:58" stamp into a time. Local clock at the circuit, not elapsed."""
    if not raw:
        return None
    try:
        return datetime.time.fromisoformat(raw)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Typed rows - one per destination table in schema.sql.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Driver:
    id: str
    given_name: str
    family_name: str
    code: str | None
    permanent_number: int | None
    nationality: str | None


@dataclass(frozen=True)
class RaceInfo:
    season: int
    round: int
    race_name: str
    circuit_id: str
    circuit_name: str
    date: datetime.date | None
    total_laps: int | None = None


@dataclass(frozen=True)
class RaceResult:
    driver: Driver
    constructor_id: str
    constructor_name: str
    grid: int | None
    position: int
    position_text: str
    points: float | None
    laps_completed: int | None
    status: str | None
    # Time.millis - absent entirely for non-classified drivers, so nullable.
    finish_time_ms: int | None


@dataclass(frozen=True)
class Lap:
    driver_id: str
    lap_number: int
    position: int | None
    lap_time_seconds: float | None


@dataclass(frozen=True)
class PitStop:
    driver_id: str
    stop: int
    lap: int
    duration_seconds: float | None
    time_of_day: datetime.time | None


@dataclass
class RaceBundle:
    """Everything one race needs, ready to insert."""

    race: RaceInfo
    results: list[RaceResult] = field(default_factory=list)
    laps: list[Lap] = field(default_factory=list)
    pit_stops: list[PitStop] = field(default_factory=list)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def new_client() -> httpx.Client:
    return httpx.Client(
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": "strategy-room/0.1"},
    )


def _request(client: httpx.Client, path: str, params: dict[str, Any] | None = None) -> dict:
    """GET one page, retrying the transient statuses with a linear backoff."""
    url = f"{jolpica_base()}{path}"
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            response = client.get(url, params=params)
        except httpx.RequestError as exc:  # DNS, connection reset, read timeout...
            last_error = exc
            time.sleep(1.0 * (attempt + 1))
            continue

        if response.status_code in RETRY_STATUSES:
            # Jolpica sends Retry-After on 429; fall back to a linear backoff.
            wait = _to_float(response.headers.get("Retry-After")) or 1.0 * (attempt + 1)
            last_error = JolpicaError(f"{response.status_code} from {url}")
            time.sleep(wait)
            continue

        response.raise_for_status()
        payload = response.json()
        if "MRData" not in payload:
            raise JolpicaError(f"Unexpected payload from {url}: missing MRData")
        return payload["MRData"]

    raise JolpicaError(f"Gave up on {url} after {MAX_RETRIES} attempts") from last_error


def _paginate(client: httpx.Client, path: str) -> Iterator[dict]:
    """Yield successive `MRData` pages until the reported `total` is covered.

    Guards against a `total` that never terminates the walk, which would otherwise
    spin forever.
    """
    offset = 0
    for _ in range(MAX_PAGES):
        data = _request(client, path, {"limit": PAGE_SIZE, "offset": offset})
        yield data

        total = _to_int(data.get("total")) or 0
        limit = _to_int(data.get("limit")) or PAGE_SIZE
        offset += limit
        if offset >= total:
            return
    raise JolpicaError(f"{path} exceeded {MAX_PAGES} pages - refusing to keep paging")


def _races_of(data: dict) -> list[dict]:
    return data.get("RaceTable", {}).get("Races", []) or []


def _require_race(data: dict, season: int, round_: int, endpoint: str) -> dict:
    """Unwrap `Races[0]`, turning the empty-array case into `RaceNotFoundError`."""
    races = _races_of(data)
    if not races:
        raise RaceNotFoundError(season, round_, endpoint)
    return races[0]


# ---------------------------------------------------------------------------
# Endpoint wrappers
# ---------------------------------------------------------------------------


def _parse_driver(raw: dict) -> Driver:
    return Driver(
        id=raw["driverId"],
        given_name=raw.get("givenName", ""),
        family_name=raw.get("familyName", ""),
        # Nullable: older seasons have no Driver.code.
        code=raw.get("code"),
        permanent_number=_to_int(raw.get("permanentNumber")),
        nationality=raw.get("nationality"),
    )


def fetch_race_info(client: httpx.Client, season: int, round_: int) -> RaceInfo:
    """Race metadata from `/{season}/{round}.json` - name, circuit, date.

    `total_laps` is not in this payload (Jolpica has no such field); it's derived
    from the results and filled in by `fetch_race_bundle`.
    """
    endpoint = f"/{season}/{round_}.json"
    race = _require_race(_request(client, endpoint), season, round_, endpoint)
    circuit = race.get("Circuit", {})
    return RaceInfo(
        season=_to_int(race.get("season")) or season,
        round=_to_int(race.get("round")) or round_,
        race_name=race.get("raceName", ""),
        circuit_id=circuit.get("circuitId", ""),
        circuit_name=circuit.get("circuitName", ""),
        date=_parse_date(race.get("date")),
    )


def fetch_results(client: httpx.Client, season: int, round_: int) -> list[RaceResult]:
    """Final classification from `/results.json`."""
    endpoint = f"/{season}/{round_}/results.json"
    results: list[RaceResult] = []
    seen_race = False

    for page in _paginate(client, endpoint):
        races = _races_of(page)
        if not races:
            break
        seen_race = True
        for raw in races[0].get("Results", []):
            constructor = raw.get("Constructor", {})
            # `Time` is missing entirely on retirements - never assume the key exists.
            finish_time = raw.get("Time") or {}
            results.append(
                RaceResult(
                    driver=_parse_driver(raw["Driver"]),
                    constructor_id=constructor.get("constructorId", ""),
                    constructor_name=constructor.get("name", ""),
                    # grid 0 is a real value: it means a pit-lane start.
                    grid=_to_int(raw.get("grid")),
                    position=_to_int(raw.get("position")) or 0,
                    position_text=raw.get("positionText", ""),
                    points=_to_float(raw.get("points")),
                    laps_completed=_to_int(raw.get("laps")),
                    status=raw.get("status"),
                    finish_time_ms=_to_int(finish_time.get("millis")),
                )
            )

    if not seen_race:
        raise RaceNotFoundError(season, round_, endpoint)
    return results


def fetch_laps(client: httpx.Client, season: int, round_: int) -> list[Lap]:
    """Lap-by-lap timings from `/laps.json`, paginated.

    This endpoint pages by individual driver timing rather than by lap, so one lap's
    `Timings` list can be split across two pages. Timings are therefore accumulated
    per lap number and only flattened at the end - concatenating each page's `Laps`
    array would produce duplicate lap entries for the laps that straddle a boundary.
    """
    endpoint = f"/{season}/{round_}/laps.json"
    timings_by_lap: dict[int, list[dict]] = {}
    seen_race = False

    for page in _paginate(client, endpoint):
        races = _races_of(page)
        if not races:
            break
        seen_race = True
        for raw_lap in races[0].get("Laps", []):
            lap_number = _to_int(raw_lap.get("number"))
            if lap_number is None:
                continue
            timings_by_lap.setdefault(lap_number, []).extend(raw_lap.get("Timings", []))

    if not seen_race:
        raise RaceNotFoundError(season, round_, endpoint)

    laps: list[Lap] = []
    for lap_number in sorted(timings_by_lap):
        for timing in timings_by_lap[lap_number]:
            laps.append(
                Lap(
                    driver_id=timing["driverId"],
                    lap_number=lap_number,
                    position=_to_int(timing.get("position")),
                    lap_time_seconds=parse_lap_time(timing.get("time")),
                )
            )
    return laps


def fetch_pit_stops(client: httpx.Client, season: int, round_: int) -> list[PitStop]:
    """Actual pit stops from `/pitstops.json`, paginated.

    Carries no tire compound - Jolpica publishes none on any endpoint. `duration` is
    the whole pit-lane pass (entry to exit), not stationary time.
    """
    endpoint = f"/{season}/{round_}/pitstops.json"
    stops: list[PitStop] = []
    seen_race = False

    for page in _paginate(client, endpoint):
        races = _races_of(page)
        if not races:
            break
        seen_race = True
        for raw in races[0].get("PitStops", []):
            stop_number = _to_int(raw.get("stop"))
            lap = _to_int(raw.get("lap"))
            if stop_number is None or lap is None:
                continue
            stops.append(
                PitStop(
                    driver_id=raw["driverId"],
                    stop=stop_number,
                    lap=lap,
                    duration_seconds=_to_float(raw.get("duration")),
                    time_of_day=_parse_time_of_day(raw.get("time")),
                )
            )

    if not seen_race:
        raise RaceNotFoundError(season, round_, endpoint)
    return stops


def fetch_race_bundle(season: int, round_: int, client: httpx.Client | None = None) -> RaceBundle:
    """Fetch race info + results + laps + pit stops for one season/round.

    Raises `RaceNotFoundError` if the race itself doesn't exist upstream. A race that
    exists but has no laps or pit stops recorded (older seasons, cancelled events) is
    not an error - those lists just come back empty.
    """
    owns_client = client is None
    client = client or new_client()
    try:
        race = fetch_race_info(client, season, round_)
        results = fetch_results(client, season, round_)
        laps = fetch_laps(client, season, round_)
        pit_stops = fetch_pit_stops(client, season, round_)
    finally:
        if owns_client:
            client.close()

    # total_laps is derived - Jolpica has no such field. The winner's lap count is the
    # race distance; max() over all results is the same number and survives an
    # unsorted payload.
    lap_counts = [r.laps_completed for r in results if r.laps_completed is not None]
    race = replace(race, total_laps=max(lap_counts) if lap_counts else None)

    return RaceBundle(race=race, results=results, laps=laps, pit_stops=pit_stops)
