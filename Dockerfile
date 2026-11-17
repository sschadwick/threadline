FROM node:22-alpine AS frontend

WORKDIR /source/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-alpine

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN addgroup -g 10001 threadline \
    && adduser -D -u 10001 -G threadline threadline \
    && install -d -o threadline -g threadline /data

COPY --chown=threadline:threadline LICENSE .
COPY --chown=threadline:threadline threadline/ threadline/
COPY --from=frontend --chown=threadline:threadline /source/threadline/web/ threadline/web/

USER threadline
EXPOSE 8765
ENTRYPOINT ["python", "-m", "threadline", "--data", "/data/state.json", "--codex-dir", "/history/codex", "--claude-dir", "/history/claude"]
