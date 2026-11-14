from datetime import datetime, date
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Login(Strict):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class Point(Strict):
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=1000)


class ObservationIn(Strict):
    observation_id: str = Field(min_length=1, max_length=160)
    camera_id: str
    sector_id: str
    captured_at: datetime
    count: int | None = Field(default=None, ge=0, le=100000)
    positions: list[Point] = Field(default_factory=list, max_length=2000)
    coordinate_system: Literal["map_1000x734", "video_pixels", "none"] = "none"
    source: Literal["simulator", "video"]
    status: Literal["available", "unavailable"] = "available"

    @model_validator(mode="after")
    def check(self):
        if self.captured_at.tzinfo is None:
            raise ValueError("captured_at exige fuso horário")
        if self.status == "available" and self.count is None:
            raise ValueError("count obrigatório para medição disponível")
        if self.status == "unavailable" and (self.count is not None or self.positions):
            raise ValueError("Indisponibilidade não é zero")
        if self.coordinate_system != "map_1000x734" and self.positions:
            raise ValueError("Envie posições apenas após calibração para a planta")
        if any(p.y > 734 for p in self.positions):
            raise ValueError("y deve estar entre 0 e 734")
        if len(self.positions) > (self.count or 0):
            raise ValueError("Amostra espacial maior que contagem")
        return self


class EventIn(Strict):
    id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=100)
    startDate: date
    endDate: date
    start: int = Field(ge=0, lt=1440)
    end: int = Field(gt=0, le=1440)
    sectors: list[str] = Field(min_length=1, max_length=100)
    audience: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    source: str = "Cadastro administrativo"

    @model_validator(mode="after")
    def check(self):
        if self.endDate < self.startDate or self.end <= self.start:
            raise ValueError("Período inválido")
        if len(set(self.sectors)) != len(self.sectors):
            raise ValueError("Setores duplicados")
        return self


class SpecialIn(Strict):
    id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    date: date
    type: str = Field(min_length=1, max_length=100)
    scope: str = Field(min_length=1, max_length=100)
    source: str = Field(min_length=1, max_length=500)
    status: str = "Cadastro manual; verificação pendente"


class AnnotationIn(Strict):
    id: str | None = None
    date: date
    minute: int = Field(ge=0, le=1440)
    sector: str | None = None
    text: str = Field(min_length=1, max_length=500)


class CameraIn(Strict):
    id: str = Field(min_length=1, max_length=100)
    sector_id: str
    calibrated: bool = False
    homography: list[list[float]] | None = None
    coverage: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def check(self):
        if self.calibrated and (
            not self.homography
            or len(self.homography) != 3
            or any(len(r) != 3 for r in self.homography)
        ):
            raise ValueError("Calibração exige homografia 3x3")
        if self.homography:
            a, b, c = self.homography[0]
            d, e, f = self.homography[1]
            g, h, i = self.homography[2]
            if (
                abs(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g))
                < 1e-9
            ):
                raise ValueError("Homografia singular")
        return self


class PassageIn(Strict):
    id: str
    source: Literal["simulator", "video"]
    start_at: datetime
    end_at: datetime
    origin: str
    destination: str
    count: int = Field(ge=0)

    @model_validator(mode="after")
    def check(self):
        if (
            not self.start_at.tzinfo
            or not self.end_at.tzinfo
            or self.end_at <= self.start_at
            or self.origin == self.destination
        ):
            raise ValueError("Intervalo ou setores inválidos")
        return self


class AssistantAnalyzeIn(Strict):
    message: str = Field(min_length=1, max_length=2000)
    context: dict[str, object] = Field(default_factory=dict)


class ProfileIn(Strict):
    id: str
    date: date
    eventId: str | None = None
    sectors: list[str] = Field(min_length=1)
    n: int = Field(gt=0)
    gender: dict[str, int]
    age: dict[str, int]
    source: Literal["simulator", "survey"]
    provenance: str = Field(min_length=1, max_length=500)
    from_minute: int = Field(ge=0, le=1440, alias="from")
    to: int = Field(ge=0, le=1440)

    @model_validator(mode="after")
    def check(self):
        expected = [
            {"Mulheres", "Homens", "Outra identificação", "Não informado"},
            {
                "Crianças · 0–11",
                "Adolescentes · 12–17",
                "Adultos · 18–59",
                "Pessoas idosas · 60+",
                "Não informado",
            },
        ]
        for dimension, keys in zip([self.gender, self.age], expected):
            if (
                set(dimension) != keys
                or any(n < 0 for n in dimension.values())
                or sum(dimension.values()) != self.n
            ):
                raise ValueError("Dimensão deve conter todas as categorias e somar n")
        if self.to <= self.from_minute:
            raise ValueError("Período inválido")
        return self
