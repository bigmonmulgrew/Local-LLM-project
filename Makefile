.DEFAULT_GOAL := help

.PHONY: help init up down logs ps pull-model check reset

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

init: ## Create .env from sample.env if it does not exist
	@test -f .env || cp sample.env .env

up: init ## Build and start the stack
	docker compose up --build --detach

down: ## Stop the stack and preserve data
	docker compose down

logs: ## Follow service logs
	docker compose logs --follow

ps: ## Show container and health status
	docker compose ps

pull-model: ## Download OLLAMA_MODEL into the Ollama volume
	docker compose exec ollama sh -c 'ollama pull "$$OLLAMA_MODEL"'

check: ## Validate the rendered Compose configuration
	docker compose config --quiet

reset: ## Stop the stack and delete its persistent data (destructive)
	docker compose down --volumes
