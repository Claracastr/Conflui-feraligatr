import importlib.util
from pathlib import Path
from sqlalchemy import select, text
from alembic import command
from alembic.config import Config
from conflui.db import make_engine, ROOT
from conflui.models import Admin
from sqlalchemy.orm import Session


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_prepare_env_is_automatic_and_preserves_key(tmp_path, monkeypatch):
    setup = load_script("configurar")
    monkeypatch.setattr(setup, "ROOT", tmp_path)
    (tmp_path / ".env.example").write_text(
        "DATABASE_URL=sqlite:///conflui.db\nINGEST_KEY=\nDATA_MODE=simulator\n"
    )
    setup.prepare_env()
    first = (tmp_path / ".env").read_text()
    assert "DATABASE_URL=sqlite:///conflui.db" in first
    assert len(first.split("INGEST_KEY=")[1].splitlines()[0]) >= 32
    setup.prepare_env()
    assert first == (tmp_path / ".env").read_text()
    (tmp_path / ".env").write_text(
        "DATABASE_URL=postgresql://unused\nINGEST_KEY=existing-key\nDATA_MODE=simulator\n"
    )
    setup.prepare_env()
    assert "DATABASE_URL=sqlite:///conflui.db" in (tmp_path / ".env").read_text()
    assert "INGEST_KEY=existing-key" in (tmp_path / ".env").read_text()


def test_migration_and_persistence_in_file(tmp_path, monkeypatch):
    import conflui.db as database

    url = "sqlite:///" + str(tmp_path / "persistent.db")
    engine = make_engine(url)
    monkeypatch.setattr(database, "engine", engine)
    cfg = Config(str(ROOT / "backend" / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "backend" / "migrations"))
    command.upgrade(cfg, "head")
    with Session(engine) as session:
        session.add(
            Admin(
                id="persisted", email="persisted@test.local", password_hash="test-only"
            )
        )
        session.commit()
    engine.dispose()
    reopened = make_engine(url)
    with Session(reopened) as session:
        assert session.scalar(select(Admin.email)) == "persisted@test.local"
        assert session.scalar(text("PRAGMA foreign_keys")) == 1
        assert session.scalar(text("PRAGMA journal_mode")) == "wal"
    reopened.dispose()
    command.downgrade(cfg, "base")
    engine.dispose()


def test_launcher_stops_all_children(tmp_path, monkeypatch):
    launcher = load_script("iniciar")
    monkeypatch.setattr(launcher, "ROOT", tmp_path)
    processes = []

    class Process:
        def __init__(self, *args, **kwargs):
            self.stopped = False
            processes.append(self)

        def poll(self):
            return None if not self.stopped else 0

        def terminate(self):
            self.stopped = True

        def wait(self, timeout=None):
            return 0

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(launcher.subprocess, "Popen", Process)
    monkeypatch.setattr(launcher.urllib.request, "urlopen", lambda *a, **kw: Response())

    def interrupt(_):
        raise KeyboardInterrupt()

    monkeypatch.setattr(launcher.time, "sleep", interrupt)
    import pytest

    with pytest.raises(KeyboardInterrupt):
        launcher.launch(["api"], ["simulator"])
    assert len(processes) == 2 and all(p.stopped for p in processes)


def test_complete_first_configuration_and_reopen(tmp_path):
    import shutil, subprocess, sys, os

    project = tmp_path / "Conflui"
    project.mkdir()
    shutil.copytree(
        ROOT / "backend",
        project / "backend",
        ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"),
    )
    for file in ["configurar.py", ".env.example"]:
        shutil.copy(ROOT / file, project / file)
    program = """
import sys
from unittest.mock import patch
import configurar
sys.argv=['configurar.py']
with patch('builtins.input',return_value='qa@example.test'),patch('getpass.getpass',return_value='TemporaryTestPass123!'):
    configurar.main()
from fastapi.testclient import TestClient
from conflui.main import app
from conflui.db import SessionLocal
from conflui.models import Observation
from sqlalchemy import select,func
with SessionLocal() as s:
    count=s.scalar(select(func.count()).select_from(Observation))
    assert count>0
with TestClient(app) as c:
    assert c.post('/auth/login',json={'email':'qa@example.test','password':'TemporaryTestPass123!'}).status_code==200
    assert len(c.get('/sectors').json())==18
    assert c.get('/sectors').json()[0]['name'].find('Ã')==-1
    assert c.put('/favorites/cinema').status_code==204
with patch('builtins.input',side_effect=AssertionError('Must not ask again')):
    configurar.main()
with SessionLocal() as s:
    assert s.scalar(select(func.count()).select_from(Observation))==count
with TestClient(app) as c:
    c.post('/auth/login',json={'email':'qa@example.test','password':'TemporaryTestPass123!'})
    assert c.get('/favorites').json()==['cinema']
"""
    env = dict(os.environ)
    for key in ["DATABASE_URL", "DATA_MODE", "INGEST_KEY"]:
        env.pop(key, None)
    result = subprocess.run(
        [sys.executable, "-c", program],
        cwd=project,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (project / "conflui.db").exists()
