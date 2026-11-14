"""Site e API na mesma origem: / para Vite e /api para FastAPI."""
from pathlib import Path
from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles
from conflui.main import app as api

STATIC_DIR = Path(__file__).resolve().parent / "static"
app = Starlette(routes=[
    Mount("/api", app=api),
    Mount("/", app=StaticFiles(directory=STATIC_DIR, html=True)),
])
