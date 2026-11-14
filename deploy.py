"""Inicializa o banco persistentemente e executa API + simulador no Railway."""
import os
import secrets
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))


def prepare():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import select
    from conflui.db import SessionLocal
    from conflui.models import Admin, Observation
    from conflui.cli import catalog, seed_history
    from conflui.auth import hasher
    from conflui.services import TZ
    from datetime import datetime, timedelta
    from uuid import uuid4

    if not os.getenv("INGEST_KEY"):
        raise SystemExit("Configure INGEST_KEY nas variáveis do Railway (segredo aleatório forte).")
    if not os.getenv("DATABASE_URL", "").startswith("sqlite:////data/"):
        raise SystemExit("Defina DATABASE_URL=sqlite:////data/conflui.db e monte o volume em /data")
    migration = Config(str(ROOT / "backend/alembic.ini"))
    migration.set_main_option("script_location", str(ROOT / "backend/migrations"))
    migration.set_main_option("prepend_sys_path", str(ROOT / "backend"))
    command.upgrade(migration, "head")

    from conflui.config import settings
    with SessionLocal() as session:
        catalog(session)
        email = os.getenv("ADMIN_EMAIL", "").strip().lower()
        password = os.getenv("ADMIN_PASSWORD", "")
        if not session.scalar(select(Admin.id).limit(1)):
            if "@" not in email or len(password) < 12:
                raise SystemExit("Primeira execução: configure ADMIN_EMAIL e ADMIN_PASSWORD (12+ caracteres) no Railway.")
            session.add(Admin(id=str(uuid4()), email=email, password_hash=hasher.hash(password)))
            session.commit()
            print("Administrador inicial criado.", flush=True)
        if settings.data_mode == "simulator" and not session.scalar(select(Observation.id).limit(1)):
            today = datetime.now(TZ).date()
            seed_history(session, today - timedelta(days=2), today)


def main():
    prepare()
    port = int(os.environ.get("PORT", "8000"))
    url = f"http://127.0.0.1:{port}"
    api = subprocess.Popen([
        sys.executable, "-m", "uvicorn", "production:app",
        "--host", "0.0.0.0", "--port", str(port), "--proxy-headers",
    ], cwd=ROOT)
    simulator = None
    try:
        for _ in range(120):
            if api.poll() is not None:
                raise RuntimeError("API encerrou durante inicialização")
            try:
                with urllib.request.urlopen(url + "/api/health", timeout=1) as r:
                    if r.status == 200:
                        break
            except Exception:
                time.sleep(.5)
        else:
            raise RuntimeError("API não ficou saudável após 60s")
        if os.environ.get("DATA_MODE", "simulator") == "simulator":
            simulator = subprocess.Popen([
                sys.executable, "-m", "conflui.simulator", "--url", url,
            ], cwd=ROOT / "backend")
        print("Conflui online em /, API em /api/health", flush=True)
        while api.poll() is None and (simulator is None or simulator.poll() is None):
            time.sleep(1)
        raise RuntimeError("API ou simulador encerrou inesperadamente")
    finally:
        for process in (simulator, api):
            if process is not None and process.poll() is None:
                process.terminate()
        for process in (simulator, api):
            if process is not None:
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill()


if __name__ == "__main__":
    main()
