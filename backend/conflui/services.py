import json, hashlib
from datetime import datetime, date, time, timedelta, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select, func
from fastapi import HTTPException
from .models import Observation, Sector, Passage, Profile
from .config import settings

TZ = ZoneInfo(settings.shop_timezone)


def utc_iso(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def source_mode():
    return "simulator" if settings.data_mode == "simulator" else "video"


def window(day: date, minute: int):
    if not settings.open_minute <= minute <= settings.close_minute:
        raise HTTPException(422, "Horário fora da janela operacional")
    return (datetime.combine(day, time(), TZ) + timedelta(minutes=minute)).astimezone(
        timezone.utc
    )


def available_source(source):
    if source and source != source_mode():
        raise HTTPException(403, "Origem não pertence a este ambiente")
    return source_mode()


def snapshot(session, at, floor=None, sector=None, live=False):
    # One ranked query instead of one query per sector; never sums overlapping cameras.
    src = source_mode()
    ranked = (
        select(
            Observation.id,
            func.row_number()
            .over(
                partition_by=Observation.sector_id,
                order_by=(Observation.captured_at.desc(), Observation.id.desc()),
            )
            .label("rn"),
        )
        .where(
            Observation.source == src,
            Observation.captured_at <= at,
            Observation.captured_at >= at - timedelta(minutes=15),
        )
        .subquery()
    )
    observations = {
        o.sector_id: o
        for o in session.scalars(
            select(Observation)
            .join(ranked, Observation.id == ranked.c.id)
            .where(ranked.c.rn == 1)
        )
    }
    sectors = session.scalars(select(Sector).order_by(Sector.id)).all()
    rows = []
    for s in sectors:
        if floor is not None and s.floor_id != floor or sector and s.id != sector:
            continue
        o = observations.get(s.id)
        age = (
            None
            if not o
            else (
                at
                - (
                    o.captured_at.replace(tzinfo=timezone.utc)
                    if not o.captured_at.tzinfo
                    else o.captured_at
                )
            ).total_seconds()
        )
        status = (
            "unavailable"
            if not o or o.data["status"] == "unavailable"
            else ("stale" if live and age > settings.stale_seconds else "available")
        )
        rows.append(
            dict(
                sector_id=s.id,
                count=o.count if o and status != "unavailable" else None,
                positions=(
                    o.data.get("positions", []) if o and status != "unavailable" else []
                ),
                captured_at=utc_iso(o.captured_at) if o else None,
                received_at=utc_iso(o.received_at) if o else None,
                status=status,
                source=src,
                coordinate_system=o.data.get("coordinate_system") if o else None,
                coverage="single_authoritative_camera" if o else "no_measurement",
            )
        )
    return dict(
        at=at.isoformat(),
        timezone=settings.shop_timezone,
        source=src,
        sectors=rows,
        total=(
            sum(r["count"] for r in rows if r["count"] is not None)
            if any(r["count"] is not None for r in rows)
            else None
        ),
        available_sectors=sum(r["count"] is not None for r in rows),
        total_sectors=len(rows),
        metric="occupancy",
        positions_note="Amostras espaciais; ausência de posições não permite desenhar calor",
    )


def flows(session, start, end, origin=None):
    rows = session.scalars(
        select(Passage).where(
            Passage.source == source_mode(),
            Passage.start_at >= start,
            Passage.end_at <= end,
        )
    ).all()
    sums = {}
    for row in rows:
        d = row.data
        if origin and d["origin"] != origin:
            continue
        key = (d["origin"], d["destination"])
        sums[key] = sums.get(key, 0) + d["count"]
    denominators = {a: sum(n for (x, y), n in sums.items() if x == a) for a, b in sums}
    return dict(
        start=start.isoformat(),
        end=end.isoformat(),
        source=source_mode(),
        metric="passages",
        coverage="Somente conexões e intervalos medidos integralmente dentro do filtro; não visitantes únicos",
        items=[
            dict(
                origin=a,
                destination=b,
                count=n,
                denominator=denominators[a],
                percent=(
                    round(100 * n / denominators[a], 2) if denominators[a] else None
                ),
            )
            for (a, b), n in sums.items()
        ],
    )


def profiles(session, day, event_id=None, sector=None):
    src = "simulator" if source_mode() == "simulator" else "survey"
    rows = [
        p.data
        for p in session.scalars(select(Profile).where(Profile.source == src))
        if p.data["date"] == day.isoformat()
        and (not event_id or p.data.get("eventId") == event_id)
        and (not sector or sector in p.data["sectors"])
    ]
    # Daily rows and event-specific rows are distinct cohorts. Never sum both.
    if not event_id:
        rows = [r for r in rows if not r.get("eventId")]
    n = sum(r["n"] for r in rows)
    dimensions = {
        dim: [
            dict(
                label=k,
                count=sum(r[dim].get(k, 0) for r in rows),
                denominator=n,
                percent=(
                    round(100 * sum(r[dim].get(k, 0) for r in rows) / n, 2)
                    if n
                    else None
                ),
            )
            for k in dict.fromkeys(k for r in rows for k in r[dim])
        ]
        for dim in ["gender", "age"]
    }
    return dict(
        timezone=settings.shop_timezone,
        status="available" if n else "unavailable",
        n=n,
        source=src,
        samples=rows,
        dimensions=dimensions,
        note="Amostra independente; sem extrapolação para ocupação e sem somar as dimensões",
    )


def profile_dates(session):
    """Datas com pesquisa disponível, para orientar o recorte sem inventar dado."""
    src = "simulator" if source_mode() == "simulator" else "survey"
    dates = {}
    for row in session.scalars(select(Profile).where(Profile.source == src)):
        d = row.data
        item = dates.setdefault(
            d["date"], {"date": d["date"], "n": 0, "events": set()}
        )
        if d.get("eventId"):
            item["events"].add(d["eventId"])
        else:
            item["n"] += d["n"]
    return {
        "source": src,
        "dates": [
            {**item, "events": sorted(item["events"])}
            for item in sorted(dates.values(), key=lambda x: x["date"], reverse=True)
        ],
    }


def payload_digest(payload):
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
