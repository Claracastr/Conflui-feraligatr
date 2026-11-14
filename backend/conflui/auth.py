import hashlib, secrets
from datetime import timedelta, timezone
from fastapi import Depends, HTTPException, Request, Header
from argon2 import PasswordHasher
from sqlalchemy.orm import Session as DBSession
from .db import db
from .models import Session, Admin, now
from .config import settings

hasher = PasswordHasher()


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def admin(request: Request, session: DBSession = Depends(db)):
    token = request.cookies.get("conflui_session", "")
    stored = session.get(Session, digest(token))
    if not stored:
        raise HTTPException(401, "Sessão necessária")
    expires = stored.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now():
        raise HTTPException(401, "Sessão expirada")
    # Cross-origin browser mutations must originate from the configured frontend.
    origin = request.headers.get("origin")
    if stored.admin_id == "demo-viewer":
        if settings.data_mode != "simulator":
            raise HTTPException(403, "Demonstração indisponível")

        allowed = request.method in ("GET", "HEAD", "OPTIONS")
        allowed_assistant = (
            request.method == "POST"
            and request.url.path == "/assistant/analyze"
        )
        allowed_logout = (
            request.method == "POST"
            and request.url.path == "/auth/logout"
        )

        if not allowed and not allowed_assistant and not allowed_logout:
            raise HTTPException(
                403,
                "Modo demonstração: alterações não permitidas"
            )

    if (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and origin
        and origin not in settings.cors_origins
    ):
        raise HTTPException(403, "Origem não autorizada")
    return session.get(Admin, stored.admin_id)


def ingestion(x_ingest_key: str = Header(default="")):
    if not settings.ingest_key or not secrets.compare_digest(
        x_ingest_key, settings.ingest_key
    ):
        raise HTTPException(401, "Chave de aquisição inválida")
