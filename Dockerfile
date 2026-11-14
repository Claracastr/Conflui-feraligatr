FROM node:22-bookworm-slim AS frontend-build
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY deploy.py production.py /app/
COPY --from=frontend-build /ui/dist/ /app/static/
ENV PYTHONPATH=/app/backend DATABASE_URL=sqlite:////data/conflui.db DATA_MODE=simulator COOKIE_SECURE=true
EXPOSE 8000
CMD ["python", "deploy.py"]
