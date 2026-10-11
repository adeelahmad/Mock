# Mock — shortcuts for the npm scripts and the Go binary. `make help` lists them.
# NODE_ENV=production would make npm skip devDependencies, so install always includes them.
#
# The binary (bin/mock) is the whole app: the built web app embedded with go:embed, the sign-in
# and sync server, and the Google Meet bridge. Pure Go (CGO_ENABLED=0), so it cross-compiles.

PORT ?= 5173
GO ?= go
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64
EMBED := internal/web/dist

.DEFAULT_GOAL := help

.PHONY: server serve start token bridge binary binaries embed go-test help install dev typecheck test test-watch build preview e2e check verify refs shots media icons docs docs-build clean

help: ## List the targets
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-11s %s\n", $$1, $$2}'

node_modules: package.json package-lock.json
	npm install --include=dev --no-audit --no-fund
	@touch node_modules

install: ## Install dependencies (dev included)
	npm install --include=dev --no-audit --no-fund

dev: node_modules ## Run the dev server (PORT=5173)
	npx vite --port $(PORT)

server: ## Run the Mock server API on :8787 (sign-in + sync; `make dev` proxies /api, /auth to it)
	MOCK_STATIC=- $(GO) run ./cmd/mock

serve: binary ## Build the binary, then serve the app + API on :8787
	./bin/mock

start: serve

token: ## Print the setup token the sign-in wizard asks for
	@$(GO) run ./cmd/mock token

bridge: ## Run only the Google Meet bridge on 127.0.0.1:8788 (needs Chrome or Chromium)
	$(GO) run ./cmd/mock bridge

embed: build ## Copy the built app into the Go embed directory
	find $(EMBED) -mindepth 1 ! -name .gitkeep -delete
	cp -a dist/. $(EMBED)/

binary: embed ## Build bin/mock: one self-contained binary for this machine
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags "$(LDFLAGS)" -o bin/mock ./cmd/mock
	@ls -lh bin/mock

binaries: embed ## Cross-compile bin/mock-<os>-<arch> for linux and darwin, amd64 and arm64
	@for p in $(PLATFORMS); do \
		os=$${p%/*}; arch=$${p#*/}; \
		echo "bin/mock-$$os-$$arch"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch $(GO) build -trimpath -ldflags "$(LDFLAGS)" -o bin/mock-$$os-$$arch ./cmd/mock || exit 1; \
	done

go-test: ## Go vet + tests (the Meet bot test runs when Chrome or Chromium is found)
	$(GO) vet ./...
	$(GO) test ./...

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

e2e: node_modules binary ## Playwright tests, the production build served by bin/mock (PW_CHROMIUM=/path/to/chromium)
	npm run e2e

check: node_modules ## Typecheck + unit tests + build, then Go vet + tests
	npm run check
	$(MAKE) go-test

verify: check e2e ## Everything: check, then Playwright

docs: node_modules ## This docs site, live on :5174
	npm run docs

docs-build: node_modules ## Build the docs site with the app at /app/ (site/.vitepress/dist)
	npm run pages

refs: node_modules ## Design artboards -> tests/design-refs (needs network)
	npm run refs

shots: node_modules ## App screenshots -> tests/screenshots (dev server running)
	npm run shots

media: node_modules ## README screenshots + demo GIF -> docs/media (dev server running, needs ffmpeg)
	npm run media

icons: node_modules ## Re-render public/icons/*.png
	npm run icons

clean: ## Remove build output and test results
	rm -rf dist bin test-results playwright-report site/.vitepress/dist site/.vitepress/cache
	find $(EMBED) -mindepth 1 ! -name .gitkeep -delete
