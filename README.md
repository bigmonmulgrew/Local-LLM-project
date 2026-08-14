# Local LLM project Docker stack

A small Linux-friendly MVP stack with:

- a FastAPI “Hello, world” website;
- a lifecycle-aware Python AI placeholder;
- MySQL 8.4 LTS;
- Ollama with persistent model storage;
- modern Python packaging through `pyproject.toml`, `uv`, and checked-in lockfiles.

## Requirements

- Linux with Docker Engine and the Docker Compose plugin
- approximately 1 GB of free space before downloading an Ollama model (model sizes vary)

## Start it

```bash
cp sample.env .env
# Edit the four MYSQL_* values in .env for anything beyond local development.
docker compose up --build --detach
docker compose ps
```

Open <http://localhost:8000>. The homepage reports whether MySQL and Ollama are reachable.

The AI placeholder stays alive, handles `SIGTERM`/`SIGINT`, and writes `helllo world` once during startup:

```bash
docker compose logs ai
```

Ollama starts without downloading a model. Pull the sample model when you are ready:

```bash
docker compose exec ollama sh -c 'ollama pull "$OLLAMA_MODEL"'
```

Or, if `make` is installed:

```bash
make up
make pull-model
make logs
```

## Useful endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /` | Friendly MVP homepage and dependency status |
| `GET /healthz` | Web process liveness |
| `GET /readyz` | MySQL and Ollama readiness; returns HTTP 503 if either is unavailable |
| `GET /docs` | Interactive OpenAPI documentation |

MySQL and Ollama bind to `127.0.0.1` by default; only the web service binds to all interfaces. Change the matching `*_BIND_ADDRESS` value in `.env` only if remote access is intentional and protected.

## Lifecycle and data

- Compose waits for MySQL and Ollama health checks before starting the Python services.
- The web app creates its MySQL connection pool on startup and closes it on shutdown.
- The AI placeholder creates its readiness marker at startup and removes it on shutdown.
- `restart: unless-stopped` restarts failed services after Docker is running again.
- MySQL data and Ollama models live in named volumes.

Stop without deleting data:

```bash
docker compose down
```

Delete containers **and all database/model data**:

```bash
docker compose down --volumes
```

## Development checks

Run tests in disposable build stages:

```bash
docker build --target test web
docker build --target test ai
```

Validate the Compose file after creating `.env`:

```bash
docker compose config --quiet
```

## Production notes

This is an MVP baseline. Before production use, put the web app behind TLS/reverse proxying, use a secrets manager instead of a checked-in `.env`, pin the Ollama image by version or digest, add backups, and review host/GPU resource limits. Do not commit `.env`; it is ignored by Git.
