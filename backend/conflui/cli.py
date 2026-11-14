"""Commands run from backend: python -m conflui.cli --help."""

import argparse, getpass, json, math, random
from pathlib import Path
from datetime import date, timedelta, datetime, timezone
from uuid import uuid4
from sqlalchemy import select, delete
from .db import SessionLocal
from .models import (
    Admin,
    Floor,
    Sector,
    Camera,
    Event,
    SpecialDate,
    Observation,
    Profile,
    Passage,
    Session,
)
from .auth import hasher
from .config import settings
from .services import window, TZ, payload_digest

CATALOG = json.loads(
    Path(__file__).with_name("catalog.json").read_text(encoding="utf-8")
)


def catalog(session):
    for i, name in enumerate(CATALOG["floors"]):
        if not session.get(Floor, i):
            session.add(
                Floor(
                    id=i,
                    data={"id": i, "name": name, "map_width": 1000, "map_height": 734},
                )
            )
    session.flush()
    for s in CATALOG["sectors"]:
        if not session.get(Sector, s["id"]):
            session.add(Sector(id=s["id"], floor_id=s["floor"], data=s))
    session.flush()
    for s in CATALOG["sectors"] if settings.data_mode == "simulator" else []:
        key = "sim-" + s["id"]
        if not session.get(Camera, key):
            session.add(
                Camera(
                    id=key,
                    sector_id=s["id"],
                    data={
                        "id": key,
                        "sector_id": s["id"],
                        "calibrated": False,
                        "homography": None,
                        "coverage": "Região conceitual demonstrativa; nenhuma câmera real conectada",
                    },
                )
            )
    for e in CATALOG["events"] if settings.data_mode == "simulator" else []:
        if not session.get(Event, e["id"]):
            session.add(Event(id=e["id"], data=e))
    for d in CATALOG["specialDates"]:
        if settings.data_mode == "video" and d["id"] == "special-demo":
            continue
        if not session.get(SpecialDate, d["id"]):
            session.add(SpecialDate(id=d["id"], data=d))
    session.commit()


def inside(x, y, poly):
    yes = False
    j = len(poly) - 1
    for i, (a, b) in enumerate(poly):
        c, d = poly[j]
        if (b > y) != (d > y) and x < (c - a) * (y - b) / (d - b) + a:
            yes = not yes
        j = i
    return yes


def synthetic(s, at):
    seed = int(at.timestamp()) // 15 + sum(ord(c) for c in s["id"])
    rng = random.Random(seed)
    minute = at.astimezone(TZ).hour * 60 + at.astimezone(TZ).minute
    if minute == 0:
        minute = 1440
    n = max(
        0,
        round(
            s["base"]
            * (0.25 + 0.75 * math.sin(math.pi * max(0, min(1, (minute - 540) / 900))))
            * (0.75 + at.weekday() * 0.06)
        ),
    )
    positions = []
    xs = [p[0] for p in s["poly"]]
    ys = [p[1] for p in s["poly"]]
    while len(positions) < min(n, 60):
        x = rng.uniform(min(xs), max(xs))
        y = rng.uniform(min(ys), max(ys))
        if inside(x, y, s["poly"]):
            positions.append({"x": round(x, 2), "y": round(y, 2)})
    return dict(
        observation_id=f'sim-{s["id"]}-{at.isoformat()}',
        camera_id="sim-" + s["id"],
        sector_id=s["id"],
        captured_at=at.isoformat(),
        count=n,
        positions=positions,
        coordinate_system="map_1000x734",
        source="simulator",
        status="available",
    )


def seed_history(session, start, end):
    if settings.data_mode != "simulator":
        raise SystemExit("Histórico sintético exige DATA_MODE=simulator")
    from .schemas import ProfileIn

    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        for minute in range(settings.open_minute, settings.close_minute + 1, 15):
            at = window(day, minute)
            for s in CATALOG["sectors"]:
                p = synthetic(s, at)
                if not session.get(Observation, p["observation_id"]):
                    session.add(
                        Observation(
                            id=p["observation_id"],
                            camera_id=p["camera_id"],
                            sector_id=s["id"],
                            captured_at=at,
                            source="simulator",
                            count=p["count"],
                            data={**p, "_hash": payload_digest(p)},
                        )
                    )
            for i, s in enumerate(CATALOG["sectors"]):
                if minute == settings.close_minute:
                    continue
                dst = CATALOG["sectors"][(i + 1) % len(CATALOG["sectors"])]
                if s["floor"] != dst["floor"]:
                    continue
                key = f'flow-{day}-{minute}-{s["id"]}'
                if not session.get(Passage, key):
                    data = {
                        "id": key,
                        "origin": s["id"],
                        "destination": dst["id"],
                        "count": 5 + (minute // 15 + i) % 20,
                        "source": "simulator",
                        "start_at": at.isoformat(),
                        "end_at": (at + timedelta(minutes=15)).isoformat(),
                    }
                    session.add(
                        Passage(
                            id=key,
                            source="simulator",
                            start_at=at,
                            end_at=at + timedelta(minutes=15),
                            data=data,
                        )
                    )
        for i, s in enumerate(CATALOG["sectors"]):
            key = f'profile-{day}-{s["id"]}'
            n = 20 + (day.day + i) % 30
            if session.get(Profile, key):
                continue
            g = {
                "Mulheres": n // 3,
                "Homens": n // 3,
                "Outra identificação": 1,
                "Não informado": n - 2 * (n // 3) - 1,
            }
            a = {
                "Crianças · 0–11": n // 5,
                "Adolescentes · 12–17": n // 5,
                "Adultos · 18–59": n // 3,
                "Pessoas idosas · 60+": 2,
                "Não informado": n - 2 * (n // 5) - n // 3 - 2,
            }
            p = ProfileIn.model_validate(
                {
                    "id": key,
                    "date": day.isoformat(),
                    "sectors": [s["id"]],
                    "n": n,
                    "gender": g,
                    "age": a,
                    "source": "simulator",
                    "provenance": "Pesquisa sintética independente por setor e data; sem pessoas reais",
                    "from": 540,
                    "to": 1440,
                }
            )
            session.add(
                Profile(
                    id=key,
                    source="simulator",
                    data=p.model_dump(mode="json", by_alias=True),
                )
            )
        for event in session.scalars(select(Event)):
            e = event.data
            if not e["startDate"] <= day.isoformat() <= e["endDate"]:
                continue
            for sector in e["sectors"]:
                key = f'profile-event-{e["id"]}-{day}-{sector}'
                if session.get(Profile, key):
                    continue
                n = 24 + (day.day % 15)
                p = ProfileIn.model_validate(
                    {
                        "id": key,
                        "date": day.isoformat(),
                        "eventId": e["id"],
                        "sectors": [sector],
                        "n": n,
                        "gender": {
                            "Mulheres": n // 3,
                            "Homens": n // 3,
                            "Outra identificação": 1,
                            "Não informado": n - 2 * (n // 3) - 1,
                        },
                        "age": {
                            "Crianças · 0–11": n // 3,
                            "Adolescentes · 12–17": 2,
                            "Adultos · 18–59": n // 3,
                            "Pessoas idosas · 60+": 1,
                            "Não informado": n - 2 * (n // 3) - 3,
                        },
                        "source": "simulator",
                        "provenance": "Pesquisa sintética do evento; coorte separada da pesquisa diária",
                        "from": e["start"],
                        "to": e["end"],
                    }
                )
                session.add(
                    Profile(
                        id=key,
                        source="simulator",
                        data=p.model_dump(mode="json", by_alias=True),
                    )
                )
        session.commit()
        print("Histórico persistido:", day)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-catalog")
    a = sub.add_parser("create-admin")
    a.add_argument("--email", required=True)
    s = sub.add_parser("seed-history")
    s.add_argument("--start", type=date.fromisoformat)
    s.add_argument("--end", type=date.fromisoformat)
    sub.add_parser("purge")
    args = p.parse_args()
    with SessionLocal() as session:
        if args.command == "seed-catalog":
            catalog(session)
            print("Plantas e regiões conceituais cadastradas.")
        elif args.command == "create-admin":
            password = getpass.getpass("Senha (mínimo 12 caracteres): ")
            if len(password) < 12 or password != getpass.getpass("Repita a senha: "):
                raise SystemExit("Senha inválida ou confirmação divergente")
            if session.scalar(
                select(Admin).where(Admin.email == args.email.lower().strip())
            ):
                raise SystemExit("Administrador já existe")
            session.add(
                Admin(
                    id=str(uuid4()),
                    email=args.email.lower().strip(),
                    password_hash=hasher.hash(password),
                )
            )
            session.commit()
            print("Administrador criado.")
        elif args.command == "seed-history":
            today = datetime.now(TZ).date()
            start = args.start or today - timedelta(days=7)
            end = args.end or today
            if end < start or (end - start).days > 366:
                raise SystemExit("Use no máximo 367 dias e início <= fim")
            catalog(session)
            seed_history(session, start, end)
        elif args.command == "purge":
            now = datetime.now(timezone.utc)
            for o in session.scalars(
                select(Observation).where(
                    Observation.captured_at
                    < now - timedelta(days=settings.spatial_retention_days)
                )
            ):
                if o.data.get("positions"):
                    o.data = {**o.data, "positions": [], "spatial_expired": True}
            session.execute(
                delete(Observation).where(
                    Observation.captured_at
                    < now - timedelta(days=settings.history_retention_days)
                )
            )
            session.execute(
                delete(Passage).where(
                    Passage.end_at
                    < now - timedelta(days=settings.history_retention_days)
                )
            )
            session.execute(delete(Session).where(Session.expires_at < now))
            session.commit()
            print("Retenção aplicada.")


if __name__ == "__main__":
    main()
