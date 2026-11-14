"""Primeira execução: ambiente local, migrations, dados e administrador."""

from pathlib import Path
import argparse
import getpass
import secrets
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))


def prepare_env():
    path = ROOT / ".env"
    text = (
        path.read_text(encoding="utf-8")
        if path.exists()
        else (ROOT / ".env.example").read_text(encoding="utf-8")
    )
    lines = text.splitlines()
    values = dict(
        line.split("=", 1)
        for line in lines
        if "=" in line and not line.lstrip().startswith("#")
    )
    replacements = {}
    if not values.get("DATABASE_URL", "").startswith("sqlite:"):
        replacements["DATABASE_URL"] = "sqlite:///conflui.db"
    if not values.get("INGEST_KEY", "").strip():
        replacements["INGEST_KEY"] = secrets.token_urlsafe(32)
    if not values.get("DATA_MODE"):
        replacements["DATA_MODE"] = "simulator"
    for key, value in replacements.items():
        lines = [line for line in lines if not line.startswith(key + "=")]
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(
        description="Configura o MVP sem servidor de banco."
    )
    parser.add_argument("--sem-historico", action="store_true")
    args = parser.parse_args()
    prepare_env()
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import select
    from datetime import datetime, timedelta
    from uuid import uuid4
    from conflui.db import SessionLocal, engine
    from conflui.models import Admin, Observation
    from conflui.cli import catalog, seed_history
    from conflui.auth import hasher
    from conflui.config import settings
    from conflui.services import TZ

    migration = Config(str(ROOT / "backend" / "alembic.ini"))
    migration.set_main_option("script_location", str(ROOT / "backend" / "migrations"))
    migration.set_main_option("prepend_sys_path", str(ROOT / "backend"))
    command.upgrade(migration, "head")
    print("Banco local pronto:", engine.url.database)
    with SessionLocal() as session:
        catalog(session)
        if (
            settings.data_mode == "simulator"
            and not args.sem_historico
            and not session.scalar(select(Observation.id).limit(1))
        ):
            today = datetime.now(TZ).date()
            seed_history(session, today - timedelta(days=2), today)
        if not session.scalar(select(Admin.id).limit(1)):
            print("Crie sua conta administrativa (não existe senha padrão).")
            while True:
                email = input("E-mail: ").strip().lower()
                if "@" in email and len(email) <= 254:
                    break
                print("Informe um e-mail válido.")
            while True:
                password = getpass.getpass("Senha (mínimo 12 caracteres): ")
                confirmation = getpass.getpass("Repita a senha: ")
                if len(password) >= 12 and password == confirmation:
                    break
                print(
                    "A senha precisa ter pelo menos 12 caracteres e as duas entradas devem ser iguais."
                )
            session.add(
                Admin(id=str(uuid4()), email=email, password_hash=hasher.hash(password))
            )
            session.commit()
        else:
            print("Conta existente preservada.")
    print("Configuração concluída. Execute: python iniciar.py")


if __name__ == "__main__":
    main()
