import pytest
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from conflui.main import app
from conflui.db import Base, db
from conflui.config import settings
from conflui.cli import catalog
from conflui.models import Admin
from conflui.auth import hasher


@pytest.fixture()
def client(tmp_path):
    # One disposable SQLite file per test; never uses the application database.
    from conflui.db import make_engine

    engine = make_engine("sqlite:///" + str(tmp_path / "test.db"))
    Base.metadata.create_all(engine)
    maker = sessionmaker(engine, expire_on_commit=False)
    old = (settings.ingest_key, settings.data_mode)
    settings.ingest_key = "test-ingestion-key"
    settings.data_mode = "simulator"
    with maker() as s:
        catalog(s)
        s.add(
            Admin(
                id="test-admin",
                email="admin@test.local",
                password_hash=hasher.hash("SomenteParaTestes123!"),
            )
        )
        s.commit()

    def override():
        with maker() as s:
            yield s

    app.dependency_overrides[db] = override
    with TestClient(app) as c:
        c.session_factory = maker
        yield c
    settings.ingest_key, settings.data_mode = old
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def logged(client):
    assert (
        client.post(
            "/auth/login",
            json={"email": "admin@test.local", "password": "SomenteParaTestes123!"},
        ).status_code
        == 200
    )
    return client
