import calendar, csv, io, secrets, hashlib, re
from datetime import datetime, date, timedelta, timezone
from typing import Annotated
from uuid import uuid4
from fastapi import FastAPI, Depends, HTTPException, Response, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession
from .config import settings
from .db import db
from . import models as m
from .schemas import (
    Login,
    ObservationIn,
    EventIn,
    SpecialIn,
    AnnotationIn,
    CameraIn,
    PassageIn,
    AssistantAnalyzeIn,
    ProfileIn,
)
from .auth import admin, ingestion, hasher, digest
from .services import (
    snapshot,
    window,
    source_mode,
    available_source,
    flows,
    profiles,
    profile_dates,
    TZ,
    payload_digest,
    utc_iso,
)

app = FastAPI(
    title="Conflui API",
    version="1.0.0",
    description="Ocupação, passagens e amostras independentes. Contratos em /docs.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-Ingest-Key"],
)
DB = Annotated[DBSession, Depends(db)]
User = Annotated[m.Admin, Depends(admin)]
Minute = Annotated[int, Query(ge=0, le=1440)]
FloorFilter = Annotated[int | None, Query(ge=0)]


def exists(session, model, key):
    row = session.get(model, key)
    if not row:
        raise HTTPException(404, f"{model.__tablename__}: registro não encontrado")
    return row


def sector_check(session, ids):
    for key in ids:
        exists(session, m.Sector, key)


def source_check(src):
    if src != source_mode():
        raise HTTPException(403, "Origem incompatível com DATA_MODE deste ambiente")


def store_payload(session, model, key, data, admin_id=None):
    row = session.get(model, key)
    if row:
        if model == m.Annotation and row.admin_id != admin_id:
            raise HTTPException(403, "Marcação de outro administrador")
        row.data = data
    else:
        row = model(id=key, data=data, **({"admin_id": admin_id} if admin_id else {}))
        session.add(row)
    session.commit()
    return data


def _safe_text(value):
    return str(value or "").strip().lower()


def _iso_date(value):
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
        except ValueError:
            try:
                return datetime.fromisoformat(value).date().isoformat()
            except ValueError:
                return None
    return None


def _extract_minute(value):
    if value is None:
        return None
    if isinstance(value, int):
        return max(0, min(1440, value))
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if ":" in text:
            try:
                h, m = map(int, text.split(":", 1))
                return h * 60 + m
            except ValueError:
                pass
        match = __import__("re").search(r"(\d{1,2})h", text)
        if match:
            return int(match.group(1)) * 60
    return None


def _parse_time_range(message, context):
    text = _safe_text(message)
    context_value = None
    for key in ["time", "start", "interval", "end"]:
        value = context.get(key)
        if value is not None:
            context_value = value
            break
    if context_value is not None:
        minute = _extract_minute(context_value)
        if minute is not None:
            return {"start": minute, "end": minute}
    patterns = [
        r"(\d{1,2})h\s*(?:às|as|até|a)\s*(\d{1,2})h",
        r"(\d{1,2})h\s*(?:e|até|a)\s*(\d{1,2})h",
        r"(?:entre|de)\s*(\d{1,2})h\s*(?:e|até|a)\s*(\d{1,2})h",
        r"(?:as|às)\s*(\d{1,2})h",
        r"(\d{1,2})h",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        values = [int(value) for value in match.groups() if value is not None]
        if len(values) == 2:
            start, end = sorted([values[0] * 60, values[1] * 60])
            return {"start": start, "end": end}
        if len(values) == 1:
            minute = values[0] * 60
            return {"start": minute, "end": minute}
    return {"start": None, "end": None}


def _weekday_name(date_value):
    return [
        "segunda-feira",
        "terça-feira",
        "quarta-feira",
        "quinta-feira",
        "sexta-feira",
        "sábado",
        "domingo",
    ][date_value.weekday()]


def _last_weekday(day_index):
    today = datetime.now(TZ).date()
    diff = (today.weekday() - day_index) % 7
    return (today - timedelta(days=diff + 7)).isoformat()


def _resolve_sector(session, message, context_sector=None):
    if context_sector:
        sector_id = str(context_sector)
        if session.get(m.Sector, sector_id):
            return sector_id
    text = _safe_text(message)
    tokens = {
        "eventos-central": ["praça central", "praça de eventos central", "praça central do shopping", "evento central", "praça de eventos"],
        "eventos-oeste": ["praça de eventos oeste", "praça oeste", "evento oeste"],
        "eventos-norte": ["praça de eventos norte", "evento norte"],
        "cinema": ["cinemark", "cinema", "circulação cinema", "cinema do shopping"],
        "mesas-leste": ["mesas leste", "alimentação leste", "mesa leste"],
        "mesas-oeste": ["mesas oeste", "alimentação oeste", "mesa oeste"],
        "entrada-central": ["entrada central", "acesso central"],
    }
    for sector_id, aliases in tokens.items():
        if any(alias in text for alias in aliases):
            return sector_id
    if session.get(m.Sector, "eventos-central"):
        return "eventos-central"
    return None


def _event_lookup(session, message, context_event=None):
    if context_event:
        event_id = str(context_event)
        if session.get(m.Event, event_id):
            return event_id
    text = _safe_text(message)
    for row in session.scalars(select(m.Event)):
        data = row.data
        if data.get("name", "").lower() in text or data.get("category", "").lower() in text:
            return row.id
    return None


def _historical_reference(session, sector_id, date_value, start, end):
    if not sector_id:
        return {"valid": 0, "mean": None, "period": None}
    if start is None or end is None:
        start = settings.open_minute
        end = settings.close_minute
    target_day = date_value.weekday()
    candidates = []
    for offset in [7, 14, 21, 28, 35, 42]:
        ref_date = date_value - timedelta(days=offset)
        if ref_date.weekday() != target_day:
            continue
        for minute in range(start, min(end, settings.close_minute) + 1, 15):
            try:
                snap = snapshot(session, window(ref_date, minute), sector=sector_id)
            except HTTPException:
                continue
            count = next((r["count"] for r in snap["sectors"] if r["sector_id"] == sector_id), None)
            if count is not None:
                candidates.append(count)
    if len(candidates) < 3:
        return {"valid": len(candidates), "mean": None, "period": "Não há histórico suficiente"}
    return {"valid": len(candidates), "mean": round(sum(candidates) / len(candidates), 2), "period": f"mesmo setor · mesmo horário e dia da semana · {len(candidates)} registros válidos"}


def _assistant_intent(message):
    text = _safe_text(message)
    if any(token in text for token in ["menor ocupação", "menor ocupacao", "quais setores", "setores tiveram"]):
        return "lowest_occupancy"
    if any(token in text for token in ["baixa utilização", "baixa utilizacao", "períodos de baixa", "períodos de baixa utilização", "houve baixo"]):
        return "low_usage_period"
    if any(token in text for token in ["o que podemos testar", "testar para aproveitar", "ação", "sugestão"]):
        return "recommendation"
    if any(token in text for token in ["durante o", "evento", "parque infantil", "programação", "ocupação do evento"]):
        return "event_context"
    return "occupancy_snapshot"


@app.get("/health")
def health(session: DB):
    session.execute(text("SELECT 1"))
    return {"status": "ok", "data_mode": source_mode()}


@app.post("/auth/login")
def login(body: Login, response: Response, request: Request, session: DB):
    if (
        request.headers.get("origin")
        and request.headers["origin"] not in settings.cors_origins
    ):
        raise HTTPException(403, "Origem não autorizada")
    user = session.scalar(
        select(m.Admin).where(m.Admin.email == body.email.strip().lower())
    )
    try:
        # Dummy hash verification also on unknown account, reducing timing disclosure.
        hasher.verify(user.password_hash if user else DUMMY_HASH, body.password)
        if not user:
            raise ValueError()
    except Exception:
        raise HTTPException(401, "E-mail ou senha inválidos")
    token = secrets.token_urlsafe(32)
    session.add(
        m.Session(
            token_hash=digest(token),
            admin_id=user.id,
            expires_at=m.now() + timedelta(hours=settings.session_hours),
        )
    )
    session.commit()
    response.set_cookie(
        "conflui_session",
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_hours * 3600,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"id": user.id, "email": user.email, "data_mode": source_mode()}


DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))


@app.post("/auth/demo")
def demo_login(
    response: Response,
    request: Request,
    session: DB
):
    # Nunca permitir demo em ambiente de dados reais.
    if settings.data_mode != "simulator":
        raise HTTPException(
            403,
            "Demonstração disponível apenas com dados simulados"
        )

    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise HTTPException(403, "Origem não autorizada")

    demo = session.get(m.Admin, "demo-viewer")

    if not demo:
        demo = m.Admin(
            id="demo-viewer",
            email="demo@conflui.invalid",
            password_hash=hasher.hash(
                secrets.token_urlsafe(48)
            )
        )
        session.add(demo)
        session.flush()

    token = secrets.token_urlsafe(32)

    session.add(
        m.Session(
            token_hash=digest(token),
            admin_id=demo.id,
            expires_at=m.now() + timedelta(
                hours=settings.session_hours
            )
        )
    )

    session.commit()

    response.set_cookie(
        "conflui_session",
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_hours * 3600,
        path="/",
    )

    response.headers["Cache-Control"] = "no-store"

    return {
        "id": demo.id,
        "email": demo.email,
        "demo": True,
        "data_mode": source_mode()
    }

@app.get("/auth/me")
def me(user: User):
    return {
        "id": user.id,
        "email": user.email,
        "demo": user.id == "demo-viewer",
        "data_mode": source_mode(),
    }

@app.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, user: User, session: DB):
    session.execute(
        delete(m.Session).where(
            m.Session.token_hash == digest(request.cookies.get("conflui_session", ""))
        )
    )
    session.commit()
    response.delete_cookie("conflui_session", path="/")


@app.get("/config")
def config(user: User):
    return {
        "open_minute": settings.open_minute,
        "close_minute": settings.close_minute,
        "timezone": settings.shop_timezone,
        "poll_interval_ms": 5000,
    }


@app.get("/floors")
def floors(user: User, session: DB):
    return [x.data for x in session.scalars(select(m.Floor).order_by(m.Floor.id))]


@app.get("/sectors")
def sectors(user: User, session: DB, floor: FloorFilter = None):
    return [
        x.data
        for x in session.scalars(select(m.Sector).order_by(m.Sector.id))
        if floor is None or x.floor_id == floor
    ]


@app.get("/cameras")
def cameras(user: User, session: DB):
    rows = []
    for x in session.scalars(select(m.Camera)):
        latest = session.scalar(
            select(m.Observation)
            .where(
                m.Observation.camera_id == x.id, m.Observation.source == source_mode()
            )
            .order_by(m.Observation.captured_at.desc())
            .limit(1)
        )
        rows.append(
            dict(
                x.data,
                last_capture=utc_iso(latest.captured_at) if latest else None,
                source=source_mode(),
            )
        )
    return rows


@app.put("/cameras/{camera_id}")
def camera(camera_id: str, body: CameraIn, user: User, session: DB):
    if camera_id != body.id:
        raise HTTPException(422, "ID divergente")
    sector_check(session, [body.sector_id])
    other = session.scalar(
        select(m.Camera).where(
            m.Camera.sector_id == body.sector_id, m.Camera.id != camera_id
        )
    )
    if other:
        raise HTTPException(
            409,
            "Setor já possui câmera autoritativa; subdivida a cobertura para evitar dupla contagem",
        )
    row = session.get(m.Camera, camera_id)
    if row:
        row.sector_id = body.sector_id
        row.data = body.model_dump()
    else:
        session.add(
            m.Camera(id=camera_id, sector_id=body.sector_id, data=body.model_dump())
        )
    session.commit()
    return body


@app.post("/observations", dependencies=[Depends(ingestion)])
def observe(body: ObservationIn, session: DB):
    source_check(body.source)
    if body.captured_at > m.now() + timedelta(minutes=2):
        raise HTTPException(422, "Captura no futuro")
    c = exists(session, m.Camera, body.camera_id)
    if c.sector_id != body.sector_id:
        raise HTTPException(422, "Câmera não é responsável por este setor")
    if body.source == "video" and body.positions and not c.data.get("calibrated"):
        raise HTTPException(422, "Câmera sem calibração")
    payload = body.model_dump(mode="json")
    fingerprint = payload_digest(payload)
    row = session.get(m.Observation, body.observation_id)
    if row:
        if row.data.get("_hash", payload_digest(row.data)) != fingerprint:
            raise HTTPException(409, "ID já utilizado com outro conteúdo")
        return {"id": row.id, "duplicate": True}
    session.add(
        m.Observation(
            id=body.observation_id,
            camera_id=body.camera_id,
            sector_id=body.sector_id,
            captured_at=body.captured_at,
            count=body.count,
            source=body.source,
            data={**payload, "_hash": fingerprint},
        )
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        row = session.get(m.Observation, body.observation_id)
        if not row or row.data.get("_hash", payload_digest(row.data)) != fingerprint:
            raise HTTPException(409, "Conflito de medição")
        return {"id": row.id, "duplicate": True}
    return {"id": body.observation_id, "duplicate": False}


@app.post("/assistant/analyze")
def assistant_analyze(body: AssistantAnalyzeIn, user: User, session: DB):
    context = dict(body.context or {})
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Mensagem vazia")
    intent = _assistant_intent(message)
    date_value = _iso_date(context.get("date"))
    if not date_value:
        match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", message)
        if match:
            dd, mm, yyyy = match.groups()
            date_value = datetime.strptime(f"{dd}/{mm}/{yyyy}", "%d/%m/%Y").date().isoformat()
    if not date_value:
        date_value = datetime.now(TZ).date().isoformat()
    parsed_time = _parse_time_range(message, context)
    start = parsed_time["start"]
    end = parsed_time["end"]
    if start is None:
        start = _extract_minute(context.get("start") or context.get("time"))
    if end is None:
        end = _extract_minute(context.get("end") or context.get("time"))
    if start is None:
        start = 540
    if end is None:
        end = start
    if end < start:
        end = start
    sector_id = _resolve_sector(session, message, context.get("sector"))
    event_id = _event_lookup(session, message, context.get("event"))
    date_obj = datetime.strptime(date_value, "%Y-%m-%d").date()
    explicit_weekday = None
    for weekday_name in [
        "segunda-feira",
        "terça-feira",
        "quarta-feira",
        "quinta-feira",
        "sexta-feira",
        "sábado",
        "domingo",
    ]:
        if weekday_name in _safe_text(message):
            explicit_weekday = weekday_name
            break
    clarification = None
    if explicit_weekday and explicit_weekday != _weekday_name(date_obj):
        clarification = (
            f"Você mencionou {explicit_weekday}; a data interpretada é {date_obj.strftime('%d/%m/%Y')} "
            f"({_weekday_name(date_obj)}). Qual referência você deseja considerar?"
        )
    sector_name = (
        session.get(m.Sector, sector_id).data.get("name", sector_id)
        if sector_id and session.get(m.Sector, sector_id)
        else "todos os setores observados"
    )
    period_name = f"{start // 60:02d}h" if start == end else f"{start // 60:02d}h–{end // 60:02d}h"

    if intent in {"lowest_occupancy", "occupancy_snapshot"}:
        samples = []
        for minute in range(start, end + 1, 15):
            try:
                snap = snapshot(session, window(date_obj, minute), sector=sector_id)
            except HTTPException:
                continue
            sector_rows = [r for r in snap["sectors"] if r["sector_id"] == sector_id] if sector_id else snap["sectors"]
            for row in sector_rows:
                if row["count"] is not None:
                    samples.append(row["count"])
        mean = round(sum(samples) / len(samples), 2) if samples else None
        peak = max(samples) if samples else None
        coverage = len(samples) if samples else 0
        reference = _historical_reference(session, sector_id, date_obj, start, end)
        below_pattern = reference["mean"] is not None and mean is not None and mean < reference["mean"] * 0.8
        observation = [
            f"Nos registros disponíveis, {sector_name} apresentou média de {mean if mean is not None else 'sem registro'} pessoas no recorte {period_name}.",
            f"Cobertura da análise: {coverage} medições válidas para {date_obj.strftime('%d/%m/%Y')}.",
        ]
        if reference["mean"] is not None:
            observation.append(f"Referência histórica do mesmo setor e intervalo: {reference['mean']} pessoas em {reference['period']}.")
        else:
            observation.append("Não há histórico suficiente para afirmar que esse espaço ficou abaixo do padrão.")
        interpretation = []
        if mean is not None:
            if sector_id and reference["mean"] is not None:
                if below_pattern:
                    interpretation.append("Essa região ficou abaixo da referência histórica utilizada para o mesmo setor, no mesmo horário e em dias equivalentes.")
                else:
                    interpretation.append("A ocupação observada está dentro do intervalo histórico do mesmo setor e horário; o padrão não indica anormalidade clara.")
            else:
                interpretation.append("A ocupação observada indica a distribuição do shopping naquele recorte, mas não prova que o espaço tenha sido insuficiente ou vazio.")
        if peak is not None:
            interpretation.append(f"O pico registrado nesse período foi de {peak} pessoas, útil para entender a intensidade do uso do espaço.")
        suggestion = [
            "Testar uma atividade temporária neste horário e acompanhar a ocupação em dias equivalentes antes de decidir uma mudança permanente.",
            "Avaliar se o espaço precisa de programação complementar em horários próximos à faixa identificada.",
        ]
        if sector_id and reference["mean"] is not None and below_pattern:
            suggestion.insert(0, f"Considerar uma ação de ativação para {sector_name} nesse período, com acompanhamento do uso nos próximos dias equivalentes.")
        metrics = {
            "mean": mean,
            "peak": peak,
            "valid_measurements": coverage,
            "reference_mean": reference["mean"],
            "reference_valid": reference["valid"],
            "source": source_mode(),
            "simulated": source_mode() == "simulator",
            "period": {"start": start, "end": end, "date": date_value},
            "sector_id": sector_id,
            "event_id": event_id,
        }
        response = {
            "observations": observation,
            "interpretations": interpretation,
            "suggestions": suggestion,
        }
    elif intent == "low_usage_period":
        candidates = []
        for minute in range(start, end + 1, 15):
            try:
                snap = snapshot(session, window(date_obj, minute), sector=sector_id)
            except HTTPException:
                continue
            for row in snap["sectors"]:
                if sector_id and row["sector_id"] != sector_id:
                    continue
                if row["count"] is not None:
                    candidates.append({"minute": minute, "count": row["count"], "sector_id": row["sector_id"]})
        if not candidates:
            response = {
                "observations": ["Não há registros disponíveis para esse recorte; a ausência de dados não indica ocupação zero."],
                "interpretations": ["Sem dados, não é possível afirmar baixa utilização ou ocioso."],
                "suggestions": ["Validar a disponibilidade do período antes de decidir ações de programação ou redistribuição de espaço."],
            }
            metrics = {"valid_measurements": 0, "source": source_mode(), "simulated": source_mode() == "simulator"}
        else:
            low_minutes = sorted(candidates, key=lambda x: x["count"])[:3]
            labels = ", ".join(f"{item['sector_id']} ({item['count']} pessoas)" for item in low_minutes)
            response = {
                "observations": [f"Os menores registros encontrados neste período foram em {labels}."] ,
                "interpretations": ["Esses valores indicam momentos de menor uso, mas não permitem concluir que o espaço esteja ocioso sem contexto histórico ou limite administrativo."],
                "suggestions": ["Avaliar uma ação de ativação no horário de menor uso e aprofundar a análise com referência histórica do mesmo setor."],
            }
            metrics = {"low_minutes": low_minutes[:3], "source": source_mode(), "simulated": source_mode() == "simulator"}
    elif intent == "recommendation":
        response = {
            "observations": [f"No recorte {period_name} de {date_obj.strftime('%d/%m/%Y')}, o conjunto de registros disponíveis mostra o comportamento do espaço em análise."],
            "interpretations": ["A decisão deve considerar não apenas a contagem, mas a programação do shopping, o uso do entorno e a duração do padrão observado."],
            "suggestions": ["Testar uma atividade de curta duração neste espaço, acompanhar a ocupação nos dias equivalentes e registrar o resultado antes de ampliar a ação."],
        }
        metrics = {"source": source_mode(), "simulated": source_mode() == "simulator", "sector_id": sector_id, "period": {"start": start, "end": end, "date": date_value}}
    else:
        response = {
            "observations": ["O protótipo analisa apenas os recortes e padrões com base no banco existente."],
            "interpretations": ["O assistente demonstrativo consegue comparar ocupação, identificar períodos de menor uso e sugerir ações, mas não substitui uma avaliação humana dos dados."],
            "suggestions": ["Pergunte por um setor, uma data ou um horário específico para receber uma análise mais precisa."],
        }
        metrics = {"source": source_mode(), "simulated": source_mode() == "simulator"}
    if clarification:
        response["clarification"] = clarification
    result = {
        "mode": "demonstrativo",
        "mode_note": "Assistente demonstrativo — análise por regras, sem modelo de linguagem conectado.",
        "intention": intent,
        "interpreted": {
            "date": date_value,
            "period": {"start": start, "end": end},
            "sector_id": sector_id,
            "event_id": event_id,
            "sector_name": sector_name,
            "weekday": _weekday_name(date_obj),
        },
        "needs_clarification": bool(clarification),
        "clarification": clarification,
        "response": response,
        "metrics": metrics,
        "data_source": {
            "source": source_mode(),
            "simulated": source_mode() == "simulator",
            "availability": "dados disponíveis" if metrics.get("valid_measurements", 0) or metrics.get("source") else "sem dados",
            "note": "Todos os registros do assistente provêm do banco da aplicação; nenhum dado foi inventado.",
        },
        "historical_reference": _historical_reference(session, sector_id, date_obj, start, end) if sector_id else {"valid": 0, "mean": None, "period": "Sem setor informado"},
        "map_params": {
            "date": date_value,
            "minute": start,
            "sector_id": sector_id,
            "event_id": event_id,
            "floor": session.get(m.Sector, sector_id).floor_id if sector_id and session.get(m.Sector, sector_id) else None,
        },
    }
    return result


@app.get("/occupancy/live")
def live(
    user: User,
    session: DB,
    floor: FloorFilter = None,
    sector: str | None = None,
    source: str | None = None,
):
    available_source(source)
    if sector:
        exists(session, m.Sector, sector)
    return snapshot(session, m.now(), floor, sector, True)


@app.get("/occupancy/history")
def history(
    user: User,
    session: DB,
    date: date,
    minute: Minute = 540,
    floor: FloorFilter = None,
    sector: str | None = None,
    source: str | None = None,
):
    available_source(source)
    if sector:
        exists(session, m.Sector, sector)
    return snapshot(session, window(date, minute), floor, sector)


@app.get("/occupancy/timeline")
def timeline(
    user: User,
    session: DB,
    date: date,
    start: Annotated[int | None, Query(ge=0, le=1440)] = None,
    end: Annotated[int | None, Query(ge=0, le=1440)] = None,
    step: Annotated[int, Query(ge=15, le=60)] = 15,
    floor: FloorFilter = None,
    sector: str | None = None,
):
    start = settings.open_minute if start is None else start
    end = settings.close_minute if end is None else end
    if end < start:
        raise HTTPException(422, "Intervalo inválido")
    return {
        "date": date,
        "interval_minutes": step,
        "items": [
            dict(minute=i, **snapshot(session, window(date, i), floor, sector))
            for i in range(start, end + 1, step)
        ],
    }


@app.get("/occupancy/compare")
def compare(
    user: User,
    session: DB,
    date_a: date,
    date_b: date,
    minute: Minute = 1080,
    floor: FloorFilter = None,
):
    return {
        "a": snapshot(session, window(date_a, minute), floor),
        "b": snapshot(session, window(date_b, minute), floor),
        "scale": "same_map_and_color_scale",
    }


@app.get("/calendar")
def cal(
    user: User,
    session: DB,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
):
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    start = window(first, settings.open_minute)
    end = window(last, settings.close_minute)
    times = session.scalars(
        select(m.Observation.captured_at).where(
            m.Observation.source == source_mode(),
            m.Observation.captured_at >= start,
            m.Observation.captured_at <= end,
        )
    )
    available = set()
    for t in times:
        if not t.tzinfo:
            t = t.replace(tzinfo=timezone.utc)
        local = t.astimezone(TZ)
        # Midnight closes the previous operational day.
        available.add(
            (
                local.date() - timedelta(days=1)
                if local.hour == 0 and local.minute == 0
                else local.date()
            ).isoformat()
        )
    events = [r.data for r in session.scalars(select(m.Event))]
    special = [r.data for r in session.scalars(select(m.SpecialDate))]
    return {
        "year": year,
        "month": month,
        "first_weekday": first.weekday(),
        "days": [
            dict(
                date=(d := date(year, month, i)).isoformat(),
                has_data=d.isoformat() in available,
                events=[
                    e["id"]
                    for e in events
                    if e["startDate"] <= d.isoformat() <= e["endDate"]
                ],
                special=[s for s in special if s["date"] == d.isoformat()],
            )
            for i in range(1, last.day + 1)
        ],
    }


@app.post("/passages", dependencies=[Depends(ingestion)])
def passage(body: PassageIn, session: DB):
    source_check(body.source)
    sector_check(session, [body.origin, body.destination])
    payload = body.model_dump(mode="json")
    row = session.get(m.Passage, body.id)
    if row:
        if row.data != payload:
            raise HTTPException(409, "ID de passagem já utilizado")
        return {"id": row.id, "duplicate": True}
    session.add(
        m.Passage(
            id=body.id,
            source=body.source,
            start_at=body.start_at,
            end_at=body.end_at,
            data=payload,
        )
    )
    session.commit()
    return {"id": body.id, "duplicate": False}


@app.get("/flows")
def flow(
    user: User,
    session: DB,
    date: date,
    start: Minute = 540,
    end: Minute = 1440,
    origin: str | None = None,
):
    if end <= start:
        raise HTTPException(422, "Intervalo inválido")
    return flows(session, window(date, start), window(date, end), origin)


@app.get("/events")
def events(
    user: User,
    session: DB,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    return [
        r.data
        for r in session.scalars(
            select(m.Event).order_by(m.Event.id).offset(offset).limit(limit)
        )
    ]


@app.post("/events", status_code=201)
def event_create(body: EventIn, user: User, session: DB):
    key = body.id or str(uuid4())
    if session.get(m.Event, key):
        raise HTTPException(409, "Evento já existe")
    return event_put(key, body, user, session)


@app.put("/events/{key}")
def event_put(key: str, body: EventIn, user: User, session: DB):
    if body.id and body.id != key:
        raise HTTPException(422, "ID divergente")
    if body.start < settings.open_minute or body.end > settings.close_minute:
        raise HTTPException(422, "Evento fora da janela operacional")
    sector_check(session, body.sectors)
    return store_payload(
        session, m.Event, key, dict(body.model_dump(mode="json"), id=key)
    )


@app.delete("/events/{key}", status_code=204)
def event_delete(key: str, user: User, session: DB):
    session.delete(exists(session, m.Event, key))
    session.commit()


@app.get("/events/{key}/analysis")
def event_analysis(
    key: str, user: User, session: DB, date: date, compare_date: date | None = None
):
    e = exists(session, m.Event, key).data
    if not e["startDate"] <= date.isoformat() <= e["endDate"]:
        raise HTTPException(422, "Data fora do evento")
    result = {}
    for name, a, b in [
        ("before", max(settings.open_minute, e["start"] - 60), e["start"] - 1),
        ("during", e["start"], e["end"]),
        ("after", e["end"] + 1, min(settings.close_minute, e["end"] + 60)),
    ]:
        samples = []
        for minute in range(a, b + 1, 15):
            snap = snapshot(session, window(date, minute))
            samples.extend(
                (minute, r["count"])
                for r in snap["sectors"]
                if r["sector_id"] in e["sectors"] and r["count"] is not None
            )
        result[name] = {
            "start": a,
            "end": b,
            "observed_sector_samples": len(samples),
            "mean_per_observed_sector": (
                round(sum(n for t, n in samples) / len(samples), 2) if samples else None
            ),
            "peak_sector_count": max((n for t, n in samples), default=None),
            "peak_minute": max(samples, key=lambda x: x[1])[0] if samples else None,
        }
    result["passages"] = flows(
        session, window(date, e["start"]), window(date, e["end"])
    )
    result["passages"]["items"] = [
        r
        for r in result["passages"]["items"]
        if r["origin"] in e["sectors"] or r["destination"] in e["sectors"]
    ]
    result["comparison"] = (
        snapshot(session, window(compare_date, e["start"])) if compare_date else None
    )
    return {
        "event": e,
        "date": date,
        "source": source_mode(),
        "calculation": "Média das ocupações de cada setor observado em recortes de 15 minutos; valores não são participantes nem efeito causal. Comparação: instantâneo na hora inicial. Sem dados não entra no denominador.",
        "intervals": result,
    }


@app.get("/special-dates")
def specials(user: User, session: DB):
    return [r.data for r in session.scalars(select(m.SpecialDate))]


@app.put("/special-dates/{key}")
def special(key: str, body: SpecialIn, user: User, session: DB):
    return store_payload(
        session,
        m.SpecialDate,
        key,
        dict(
            body.model_dump(mode="json"),
            id=key,
            status="Cadastro manual; verificação pendente",
        ),
    )


@app.delete("/special-dates/{key}", status_code=204)
def special_del(key: str, user: User, session: DB):
    session.delete(exists(session, m.SpecialDate, key))
    session.commit()


@app.get("/favorites")
def favorites(user: User, session: DB):
    return list(
        session.scalars(
            select(m.Favorite.sector_id).where(m.Favorite.admin_id == user.id)
        )
    )


@app.put("/favorites/{sector_id}", status_code=204)
def favorite(sector_id: str, user: User, session: DB):
    sector_check(session, [sector_id])
    if not session.get(m.Favorite, (user.id, sector_id)):
        session.add(m.Favorite(admin_id=user.id, sector_id=sector_id))
        session.commit()


@app.delete("/favorites/{sector_id}", status_code=204)
def favorite_del(sector_id: str, user: User, session: DB):
    session.execute(
        delete(m.Favorite).where(
            m.Favorite.admin_id == user.id, m.Favorite.sector_id == sector_id
        )
    )
    session.commit()


@app.get("/annotations")
def annotations(user: User, session: DB):
    return [
        r.data
        for r in session.scalars(
            select(m.Annotation).where(m.Annotation.admin_id == user.id)
        )
    ]


@app.put("/annotations/{key}")
def annotation(key: str, body: AnnotationIn, user: User, session: DB):
    if body.sector:
        sector_check(session, [body.sector])
    return store_payload(
        session, m.Annotation, key, dict(body.model_dump(mode="json"), id=key), user.id
    )


@app.delete("/annotations/{key}", status_code=204)
def annotation_del(key: str, user: User, session: DB):
    row = exists(session, m.Annotation, key)
    if row.admin_id != user.id:
        raise HTTPException(403, "Marcação de outro administrador")
    session.delete(row)
    session.commit()


@app.get("/profiles")
def profile(
    user: User,
    session: DB,
    date: date,
    event_id: str | None = None,
    sector: str | None = None,
):
    return profiles(session, date, event_id, sector)


@app.get("/profiles/available")
def profile_available(user: User, session: DB):
    return profile_dates(session)


@app.post("/profiles", status_code=201)
def profile_create(body: ProfileIn, user: User, session: DB):
    if body.source != ("simulator" if source_mode() == "simulator" else "survey"):
        raise HTTPException(403, "Fonte incompatível com ambiente")
    sector_check(session, body.sectors)
    if body.eventId:
        exists(session, m.Event, body.eventId)
    if session.get(m.Profile, body.id):
        raise HTTPException(409, "Amostra já existe")
    session.add(
        m.Profile(
            id=body.id,
            source=body.source,
            data=body.model_dump(mode="json", by_alias=True),
        )
    )
    session.commit()
    return body


@app.get("/reports/occupancy")
def report(
    user: User,
    session: DB,
    date: date,
    minute: Minute = 1080,
    floor: FloorFilter = None,
    format: str = "json",
):
    snap = snapshot(session, window(date, minute), floor)
    if format == "json":
        return snap
    if format != "csv":
        raise HTTPException(422, "Formato deve ser json ou csv")
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow(["sector_id", "count", "status", "source", "captured_at", "metric"])
    for r in snap["sectors"]:
        writer.writerow(
            [
                r["sector_id"],
                r["count"],
                r["status"],
                r["source"],
                r["captured_at"],
                "occupancy",
            ]
        )
    return Response(
        "\ufeff" + out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="conflui-occupancy.csv"'},
    )
