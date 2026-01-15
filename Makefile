# Montana Helper Bot - Makefile

.PHONY: help install build test dev prod logs clean

help: ## Show this help message
	@echo "Montana Helper Bot - Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

build: ## Build TypeScript code
	npm run build

test: ## Run tests
	npm test

test-coverage: ## Run tests with coverage
	npm run test:coverage

lint: ## Run ESLint
	npm run lint

dev: ## Start development environment
	docker-compose -f docker-compose.dev.yml up -d
	npm run dev

dev-stop: ## Stop development environment
	docker-compose -f docker-compose.dev.yml down

prod: ## Start production environment
	docker-compose up -d --build

prod-stop: ## Stop production environment
	docker-compose down

logs: ## Show production logs
	docker-compose logs -f bot

logs-db: ## Show database logs
	docker-compose logs -f postgres

db-shell: ## Connect to database shell
	docker-compose exec postgres psql -U montana -d montana_bot

restart: ## Restart bot in production
	docker-compose restart bot

rebuild: ## Rebuild and restart bot
	docker-compose up -d --build bot

status: ## Show container status
	docker-compose ps

clean: ## Clean build artifacts and logs
	rm -rf dist coverage logs/*.log node_modules

reset-db: ## Reset database (CAUTION: deletes all data)
	docker-compose exec postgres psql -U montana -c "DROP DATABASE IF EXISTS montana_bot;"
	docker-compose exec postgres psql -U montana -c "CREATE DATABASE montana_bot;"
	docker-compose restart bot

backup-db: ## Backup database
	@mkdir -p backups
	docker-compose exec -T postgres pg_dump -U montana montana_bot > backups/montana_bot_$$(date +%Y%m%d_%H%M%S).sql
	@echo "Database backed up to backups/"

restore-db: ## Restore database from latest backup
	@latest=$$(ls -t backups/*.sql | head -1); \
	if [ -z "$$latest" ]; then \
		echo "No backup found in backups/"; \
	else \
		echo "Restoring from $$latest"; \
		docker-compose exec -T postgres psql -U montana montana_bot < $$latest; \
		echo "Database restored"; \
	fi