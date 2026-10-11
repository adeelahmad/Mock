# Mock — shortcuts for the npm scripts. `make help` lists them.
# NODE_ENV=production would make npm skip devDependencies, so install always includes them.

PORT ?= 5173

.DEFAULT_GOAL := help

.PHONY: server start token help install dev typecheck test test-watch build preview e2e check verify refs shots icons docs docs-build clean

help: ## List the targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-11s %s\n", $$1, $$2}'

node_modules: package.json package-lock.json
	npm install --include=dev --no-audit --no-fund
	@touch node_modules

install: ## Install dependencies (dev included)
	npm install --include=dev --no-audit --no-fund

dev: node_modules ## Run the dev server (PORT=5173)
	npx vite --port $(PORT)

server: node_modules ## Run the Mock server on :8787 (sign-in + sync; dev proxies /api, /auth to it)
	npm run server

start: node_modules ## Build, then serve the app + API from the Mock server
	npm start

token: node_modules ## Print the setup token the sign-in wizard asks for
	@npm run --silent server -- token

typecheck: node_modules ## Type-check
	npm run typecheck

test: node_modules ## Unit tests (Vitest)
	npm test

test-watch: node_modules ## Unit tests in watch mode
	npm run test:watch

build: node_modules ## Build the static site into dist/
	npm run build

preview: build ## Serve the built site
	npm run preview

e2e: node_modules ## Playwright tests (PW_CHROMIUM=/path/to/chromium for a local browser)
	npm run e2e

check: node_modules ## Typecheck + unit tests + build
	npm run check

verify: check e2e ## Everything: check, then Playwright

docs: node_modules ## This docs site, live on :5174
	npm run docs

docs-build: node_modules ## Build the docs site with the app at /app/ (site/.vitepress/dist)
	npm run pages

refs: node_modules ## Design artboards -> tests/design-refs (needs network)
	npm run refs

shots: node_modules ## App screenshots -> tests/screenshots (dev server running)
	npm run shots

icons: node_modules ## Re-render public/icons/*.png
	npm run icons

clean: ## Remove build output and test results
	rm -rf dist test-results playwright-report site/.vitepress/dist site/.vitepress/cache
