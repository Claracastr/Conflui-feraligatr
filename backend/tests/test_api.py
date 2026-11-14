from datetime import date, timedelta, timezone
from sqlalchemy import select
from conflui.models import Observation, Session, now, Admin
from conflui.auth import hasher
from conflui.services import window
from conflui.config import settings

KEY = {"X-Ingest-Key": "test-ingestion-key"}


def observation(id="obs-1", sector="cinema", minute=1080, **changes):
    result = {
        "observation_id": id,
        "camera_id": "sim-" + sector,
        "sector_id": sector,
        "captured_at": window(date(2026, 1, 2), minute).isoformat(),
        "count": 12,
        "positions": [{"x": 700, "y": 500}],
        "coordinate_system": "map_1000x734",
        "source": "simulator",
        "status": "available",
    }
    return dict(result, **changes)


def event():
    return {
        "id": "test-event",
        "name": "Teste",
        "category": "Parque",
        "startDate": "2026-01-02",
        "endDate": "2026-01-03",
        "start": 840,
        "end": 1200,
        "sectors": ["cinema"],
        "audience": "Famílias",
        "description": "Teste",
    }


def test_auth_permissions_logout(client):
    assert client.get("/sectors").status_code == 401
    assert (
        client.post(
            "/auth/login", json={"email": "admin@test.local", "password": "wrong"}
        ).status_code
        == 401
    )
    r = client.post(
        "/auth/login",
        json={"email": "admin@test.local", "password": "SomenteParaTestes123!"},
    )
    assert r.status_code == 200 and "HttpOnly" in r.headers["set-cookie"]
    assert client.get("/auth/me").json()["demo"] is False
    assert client.post("/events", json=event()).status_code == 201
    assert client.get("/auth/me").json()["data_mode"] == "simulator"
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_demo_session_reads_and_assistant(client):
    response = client.post("/auth/demo")
    assert response.status_code == 200
    assert response.json()["demo"] is True
    assert response.json()["id"] == "demo-viewer"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert client.get("/auth/me").json()["demo"] is True

    assert client.get("/auth/logout").status_code == 405
    assert client.get("/occupancy/live").status_code == 200
    assert (
        client.get("/occupancy/history?date=2026-01-02&minute=1080").status_code
        == 200
    )
    assert client.get("/events").status_code == 200
    assert client.get("/calendar?year=2026&month=1").status_code == 200
    assert client.get("/profiles?date=2026-01-02").status_code == 200
    assert (
        client.get(
            "/reports/occupancy?date=2026-01-02&minute=1080&format=csv"
        ).status_code
        == 200
    )
    assistant = client.post(
        "/assistant/analyze",
        json={
            "message": "Como estava a praça central no dia 02/01/2026 às 16h?",
            "context": {"date": "2026-01-02", "time": "16:00"},
        },
    )
    assert assistant.status_code == 200
    assert assistant.json()["mode"] == "demonstrativo"


def test_demo_cannot_write_and_logout_invalidates_session(client):
    admin_login = client.post(
        "/auth/login",
        json={"email": "admin@test.local", "password": "SomenteParaTestes123!"},
    )
    assert admin_login.status_code == 200
    assert client.post("/events", json=event()).status_code == 201
    assert client.post("/auth/logout").status_code == 204
    assert client.post("/auth/demo").status_code == 200

    assert client.post("/events", json=dict(event(), id="blocked-event")).status_code == 403
    assert client.delete("/events/test-event").status_code == 403
    assert client.put(
        "/special-dates/blocked",
        json={
            "name": "Teste",
            "date": "2026-01-02",
            "type": "Teste",
            "scope": "Palmas",
            "source": "teste",
        },
    ).status_code == 403
    assert client.put("/favorites/cinema").status_code == 403
    assert client.delete("/favorites/cinema").status_code == 403
    assert client.put(
        "/cameras/sim-cinema",
        json={
            "id": "sim-cinema",
            "sector_id": "cinema",
            "coverage": "Teste",
        },
    ).status_code == 403
    assert client.put(
        "/annotations/blocked",
        json={"date": "2026-01-02", "minute": 900, "text": "Teste"},
    ).status_code == 403
    assert client.delete("/annotations/blocked").status_code == 403
    assert client.post(
        "/profiles",
        json={
            "id": "blocked-profile",
            "date": "2026-01-02",
            "sectors": ["cinema"],
            "n": 10,
            "gender": {
                "Mulheres": 4,
                "Homens": 3,
                "Outra identificação": 1,
                "Não informado": 2,
            },
            "age": {
                "Crianças · 0–11": 2,
                "Adolescentes · 12–17": 1,
                "Adultos · 18–59": 4,
                "Pessoas idosas · 60+": 1,
                "Não informado": 2,
            },
            "source": "simulator",
            "provenance": "Teste",
            "from": 540,
            "to": 1440,
        },
    ).status_code == 403

    assert client.post("/observations", json=observation()).status_code == 401
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401
    assert client.get("/sectors").status_code == 401


def test_demo_only_available_in_simulator(client):
    settings.data_mode = "video"
    assert client.post("/auth/demo").status_code == 403


def test_demo_preserves_origin_check(client):
    assert (
        client.post(
            "/auth/demo",
            headers={"Origin": "https://untrusted.example"},
        ).status_code
        == 403
    )


def test_expired_session(logged):
    with logged.session_factory() as s:
        stored = s.scalar(select(Session))
        stored.expires_at = now() - timedelta(hours=1)
        s.commit()
    assert logged.get("/auth/me").status_code == 401


def test_assistant_analysis_rule_based(logged):
    payload = {
        "message": "Como estava a praça central no dia 02/01/2026 às 16h?",
        "context": {"date": "2026-01-02", "time": "16:00"},
    }
    r = logged.post("/assistant/analyze", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "demonstrativo"
    assert body["intention"] == "occupancy_snapshot"
    assert body["interpreted"]["sector_id"] == "eventos-central"
    assert body["interpreted"]["date"] == "2026-01-02"
    assert body["response"]["observations"]


def test_cross_origin_mutation_rejected(logged):
    assert (
        logged.post(
            "/events", json=event(), headers={"Origin": "https://untrusted.example"}
        ).status_code
        == 403
    )


def test_ingestion_idempotence_and_conflict(logged):
    body = observation()
    assert logged.post("/observations", json=body).status_code == 401
    assert (
        logged.post("/observations", json=body, headers=KEY).json()["duplicate"]
        is False
    )
    assert (
        logged.post("/observations", json=body, headers=KEY).json()["duplicate"] is True
    )
    assert (
        logged.post("/observations", json=dict(body, count=13), headers=KEY).status_code
        == 409
    )
    with logged.session_factory() as s:
        assert len(s.scalars(select(Observation)).all()) == 1


def test_validation_coordinates_and_camera(logged):
    assert (
        logged.post(
            "/observations", json=observation(count=-1), headers=KEY
        ).status_code
        == 422
    )
    assert (
        logged.post(
            "/observations",
            json=observation(coordinate_system="video_pixels"),
            headers=KEY,
        ).status_code
        == 422
    )
    assert (
        logged.post(
            "/observations", json=observation(camera_id="sim-oeste"), headers=KEY
        ).status_code
        == 422
    )
    assert (
        logged.post(
            "/observations",
            json=observation(captured_at="2026-01-02T18:00:00"),
            headers=KEY,
        ).status_code
        == 422
    )
    assert (
        logged.put(
            "/cameras/second",
            json={"id": "second", "sector_id": "cinema", "coverage": "sobreposição"},
        ).status_code
        == 409
    )


def test_global_history_and_midnight(logged):
    for i, s in enumerate(["cinema", "oeste"]):
        assert (
            logged.post(
                "/observations", json=observation(str(i), s, 1440), headers=KEY
            ).status_code
            == 200
        )
    snap = logged.get("/occupancy/history?date=2026-01-02&minute=1440").json()
    assert len(snap["sectors"]) == 18 and snap["total"] == 24
    assert snap["at"].startswith("2026-01-03T03:00:00")
    assert sum(r["count"] is not None for r in snap["sectors"]) == 2
    # Opening on the next day cannot reuse last night's measurement.
    assert (
        logged.get("/occupancy/history?date=2026-01-03&minute=540").json()["total"]
        is None
    )
    assert logged.get("/occupancy/history?date=2026-01-02&minute=10").status_code == 422


def test_missing_not_zero_and_stale(logged):
    assert logged.get("/occupancy/live").json()["total"] is None
    p = observation(
        captured_at=(now() - timedelta(seconds=60)).isoformat(), count=0, positions=[]
    )
    logged.post("/observations", json=p, headers=KEY)
    r = next(
        r
        for r in logged.get("/occupancy/live").json()["sectors"]
        if r["sector_id"] == "cinema"
    )
    assert r["status"] == "stale" and r["count"] == 0
    logged.post(
        "/observations",
        json=observation("none", status="unavailable", count=None, positions=[]),
        headers=KEY,
    )
    row = next(
        r
        for r in logged.get("/occupancy/history?date=2026-01-02&minute=1080").json()[
            "sectors"
        ]
        if r["sector_id"] == "cinema"
    )
    assert row["count"] is None


def test_real_and_simulated_separation(logged):
    assert (
        logged.post(
            "/observations", json=observation(source="video"), headers=KEY
        ).status_code
        == 403
    )
    assert logged.get("/occupancy/live?source=video").status_code == 403
    logged.post("/observations", json=observation(), headers=KEY)
    settings.data_mode = "video"
    assert (
        logged.get("/occupancy/history?date=2026-01-02&minute=1080").json()["total"]
        is None
    )


def test_events_favorites_annotations_persist(logged):
    assert logged.post("/events", json=event()).status_code == 201
    assert any(e["id"] == "test-event" for e in logged.get("/events").json())
    assert logged.put("/favorites/cinema").status_code == 204
    assert logged.put("/favorites/cinema").status_code == 204
    assert logged.get("/favorites").json() == ["cinema"]
    ann = {"date": "2026-01-02", "minute": 900, "text": "Início", "sector": "cinema"}
    assert logged.put("/annotations/a", json=ann).status_code == 200
    assert logged.get("/annotations").json()[0]["text"] == "Início"
    with logged.session_factory() as s:
        s.add(
            Admin(
                id="other",
                email="other@test.local",
                password_hash=hasher.hash("AnotherAdminPass!"),
            )
        )
        s.commit()
    logged.post("/auth/logout")
    logged.post(
        "/auth/login",
        json={"email": "other@test.local", "password": "AnotherAdminPass!"},
    )
    assert (
        logged.get("/favorites").json() == []
        and logged.get("/annotations").json() == []
    )
    assert logged.delete("/annotations/a").status_code == 403
    assert logged.delete("/events/test-event").status_code == 204


def test_event_validation_and_analysis(logged):
    assert logged.post("/events", json=dict(event(), end=800)).status_code == 422
    logged.post("/events", json=event())
    logged.post("/observations", json=observation(minute=900), headers=KEY)
    r = logged.get("/events/test-event/analysis?date=2026-01-02").json()
    assert r["intervals"]["during"]["mean_per_observed_sector"] == 12
    assert r["intervals"]["before"]["mean_per_observed_sector"] is None
    assert logged.get("/events/test-event/analysis?date=2026-01-10").status_code == 422


def test_calendar_leap_and_missing_days(logged):
    r = logged.get("/calendar?year=2024&month=2").json()
    assert len(r["days"]) == 29 and not any(d["has_data"] for d in r["days"])
    logged.post("/observations", json=observation(minute=1440), headers=KEY)
    r = logged.get("/calendar?year=2026&month=1").json()["days"]
    assert r[1]["has_data"] and not r[2]["has_data"]
    assert logged.get("/calendar?year=2026&month=13").status_code == 422


def test_profile_denominators_and_unknowns(logged):
    assert logged.get("/profiles?date=2026-01-02").json()["status"] == "unavailable"
    p = {
        "id": "sample",
        "date": "2026-01-02",
        "sectors": ["cinema"],
        "n": 10,
        "gender": {
            "Mulheres": 4,
            "Homens": 3,
            "Outra identificação": 1,
            "Não informado": 2,
        },
        "age": {
            "Crianças · 0–11": 2,
            "Adolescentes · 12–17": 1,
            "Adultos · 18–59": 4,
            "Pessoas idosas · 60+": 1,
            "Não informado": 2,
        },
        "source": "simulator",
        "provenance": "Pesquisa sintética independente",
        "from": 540,
        "to": 1440,
    }
    assert logged.post("/profiles", json=dict(p, n=11)).status_code == 422
    assert logged.post("/profiles", json=p).status_code == 201
    r = logged.get("/profiles?date=2026-01-02").json()
    assert r["n"] == 10
    dates = {
        x["date"]: x
        for x in logged.get("/profiles/available").json()["dates"]
    }
    assert dates["2026-01-02"]["n"] == 10
    for dim in r["dimensions"].values():
        assert sum(x["count"] for x in dim) == 10
        assert all(x["denominator"] == 10 for x in dim)
    assert (
        logged.get("/profiles?date=2026-01-02&sector=oeste").json()["status"]
        == "unavailable"
    )


def test_passages_and_csv(logged):
    payload = {
        "id": "p1",
        "source": "simulator",
        "start_at": window(date(2026, 1, 2), 900).isoformat(),
        "end_at": window(date(2026, 1, 2), 915).isoformat(),
        "origin": "cinema",
        "destination": "oeste",
        "count": 7,
    }
    assert logged.post("/passages", json=payload, headers=KEY).status_code == 200
    assert logged.post("/passages", json=payload, headers=KEY).json()["duplicate"]
    r = logged.get("/flows?date=2026-01-02&start=900&end=915").json()
    assert r["items"][0]["denominator"] == 7 and r["items"][0]["percent"] == 100
    r = logged.get("/reports/occupancy?date=2026-01-02&minute=1080&format=csv")
    assert r.status_code == 200 and "sector_id;count;status" in r.text


def test_idempotence_after_spatial_retention(logged):
    payload = observation()
    logged.post("/observations", json=payload, headers=KEY)
    with logged.session_factory() as s:
        row = s.get(Observation, payload["observation_id"])
        row.data = {**row.data, "positions": [], "spatial_expired": True}
        s.commit()
    assert (
        logged.post("/observations", json=payload, headers=KEY).json()["duplicate"]
        is True
    )


def test_seeded_history_is_stable_and_event_profile_is_separate(logged):
    from conflui.cli import seed_history

    d = date(2026, 11, 14)
    with logged.session_factory() as session:
        seed_history(session, d, d)
    first = logged.get("/occupancy/history?date=2026-11-14&minute=1080").json()
    with logged.session_factory() as session:
        seed_history(session, d, d)
    second = logged.get("/occupancy/history?date=2026-11-14&minute=1080").json()
    assert first == second and first["available_sectors"] == 18
    daily = logged.get("/profiles?date=2026-11-14").json()
    event = logged.get("/profiles?date=2026-11-14&event_id=demo-park").json()
    assert daily["n"] > 0 and event["n"] > 0
    assert all(not s.get("eventId") for s in daily["samples"])
    assert all(s["eventId"] == "demo-park" for s in event["samples"])
    replay = logged.get("/occupancy/timeline?date=2026-11-14").json()
    assert len(replay["items"]) == 61
