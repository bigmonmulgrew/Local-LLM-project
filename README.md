# Local LLM project Docker stack

The goal of this project is to enable a quick setup of a local LLM wrapping it into a locally hosted web interface allowing for flexible deployment or sharing without requiring installation on every machine.

The project MVP stack includesh:

- a chatbot web chat application
- FastAPI to test endpoints;
- MySQL databse;
- Ollama with persistent model storage;
- modern Python packaging through `pyproject.toml`, `uv`, and checked-in lockfiles.
- a lifecycle-aware Python AI placeholder app;
- automated setup

## Requirements

- Docker Engine and the Docker Compose plugin
- approximately 1 GB of free space before downloading an Ollama model (model sizes vary)

The project was prototyped on Windows 11 using WSL.

## Automated env Update script
This repo contains a script that will automatically sync sample.env with .env, as well as any other environment files. **Do not use this in production**

- New variables added to .env will be preserved. 
- Changed variables in .env will be preserved.
- Variables are sorted to match the sample.env ordering.
- Variables in .env that don't exist in sample.env are sorted to the end.
- Scrip log highlights any new variables as well as any that don't exist in sample.env
- It will scan for and sync any files ending in .env

## Setup instrucitons

1. Copy the sample.env file, you can do this manually or use the bundled update script
2. Build the stack
3. Check containers

```bash
./update_env.bat
# Edit the four MYSQL_* values in .env for anything beyond local development.
docker compose up --build --detach
docker compose ps
```
### Shared Ollama
The sample.env file contains a variable which allows changing the ollama models location. 

By default it is set inside the repository so that large files are not accidentally left behind when the repo is deleted.

Setting this external allows sharing models, these are not deleted when deleting the docker image or the repo which can be useful if using large model

### Test setup
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

MySQL and Ollama bind to `127.0.0.1` by default; only the web service binds to all interfaces. Change the matching `*_BIND_ADDRESS` value in `.env` only if you require remote access.

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

This is an MVP teamplate project. It is not intended for production use without significant extension.

Do not commit `.env`; it is ignored by Git.
