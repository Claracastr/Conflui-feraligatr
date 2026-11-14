from datetime import datetime, timezone
from sqlalchemy import (
    String,
    Integer,
    DateTime,
    JSON,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def now():
    return datetime.now(timezone.utc)


class Admin(Base):
    __tablename__ = "admins"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(String)


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    admin_id: Mapped[str] = mapped_column(ForeignKey("admins.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Floor(Base):
    __tablename__ = "floors"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class Sector(Base):
    __tablename__ = "sectors"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    floor_id: Mapped[int] = mapped_column(ForeignKey("floors.id"))
    data: Mapped[dict] = mapped_column(JSON)


class Camera(Base):
    __tablename__ = "cameras"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    sector_id: Mapped[str] = mapped_column(ForeignKey("sectors.id"), unique=True)
    data: Mapped[dict] = mapped_column(JSON)


class Observation(Base):
    __tablename__ = "observations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id"))
    sector_id: Mapped[str] = mapped_column(ForeignKey("sectors.id"))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    source: Mapped[str] = mapped_column(String)
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (
        Index("ix_obs_sector_source_time", "sector_id", "source", "captured_at"),
    )


class Passage(Base):
    __tablename__ = "passages"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    source: Mapped[str] = mapped_column(String)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    data: Mapped[dict] = mapped_column(JSON)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class SpecialDate(Base):
    __tablename__ = "special_dates"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    admin_id: Mapped[str] = mapped_column(ForeignKey("admins.id"))
    data: Mapped[dict] = mapped_column(JSON)


class Favorite(Base):
    __tablename__ = "favorites"
    admin_id: Mapped[str] = mapped_column(ForeignKey("admins.id"), primary_key=True)
    sector_id: Mapped[str] = mapped_column(ForeignKey("sectors.id"), primary_key=True)


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    source: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSON)
