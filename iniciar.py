"""API e simulador em um único terminal, mantendo processos separados."""

from pathlib import Path
import argparse
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))


def launch(api_command, simulator_command=None):
    processes = []
    try:
        processes.append(subprocess.Popen(api_command, cwd=ROOT / "backend"))
        for _ in range(100):
            if processes[0].poll() is not None:
                raise RuntimeError("A API encerrou. Confira a mensagem de erro acima.")
            try:
                with urllib.request.urlopen(
                    "http://127.0.0.1:8000/health", timeout=1
                ) as response:
                    if response.status == 200:
                        break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.2)
        else:
            raise RuntimeError(
                "A API não respondeu em 20 segundos. Confira se a porta 8000 está disponível."
            )
        if simulator_command:
            processes.append(subprocess.Popen(simulator_command, cwd=ROOT / "backend"))
        print(
            "Backend pronto em http://127.0.0.1:8000 — Ctrl+C encerra os processos.",
            flush=True,
        )
        while True:
            for process in processes:
                if process.poll() is not None:
                    raise RuntimeError(
                        "Um dos processos encerrou. Confira o erro acima e reinicie."
                    )
            time.sleep(0.5)
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for process in reversed(processes):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def main():
    parser = argparse.ArgumentParser(
        description="Inicia o backend e, no modo simulado, o simulador."
    )
    parser.add_argument("--sem-simulador", action="store_true")
    args = parser.parse_args()
    if not (ROOT / ".env").exists():
        raise SystemExit("Primeiro execute: python configurar.py")
    from sqlalchemy import select
    from sqlalchemy.exc import OperationalError
    from conflui.db import SessionLocal
    from conflui.models import Admin
    from conflui.config import settings

    try:
        with SessionLocal() as session:
            if not session.scalar(select(Admin.id).limit(1)):
                raise SystemExit(
                    "Crie o administrador executando: python configurar.py"
                )
    except OperationalError:
        raise SystemExit("Banco ainda não configurado. Execute: python configurar.py")
    worker = None
    if settings.data_mode == "simulator" and not args.sem_simulador:
        worker = [sys.executable, "-m", "conflui.simulator"]
    try:
        launch(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "conflui.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            worker,
        )
    except KeyboardInterrupt:
        print("\nConflui encerrado. Os dados continuam salvos.")
    except RuntimeError as error:
        raise SystemExit(str(error))


if __name__ == "__main__":
    main()
