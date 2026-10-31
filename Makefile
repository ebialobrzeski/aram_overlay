# ARAM overlay — developer shortcuts. Releases normally come from .github/workflows/release.yml running on the
# self-hosted runner on the NAS; `make release` is the manual fallback that builds on the NAS over SSH.
NAS ?= admin@nas.local
NAS_DIR ?= /volume2/docker
TAG ?=

.PHONY: help build test run demo debug package release

help: ## This help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

build: ## Compile main / preload / renderer into dist/
	npm run build

test: ## Unit tests (scoring, combos, optimizer)
	npm test

run: ## Start the overlay (connects to the League client)
	npm start

demo: ## Start with fake champion select data
	npm run demo

debug: ## Start with detailed logging to %APPDATA%\aram-overlay\debug.log
	npm run debug

package: ## Build the Windows installer + portable exe locally into release/
	npm run package

release: ## Fallback: build + publish TAG (default newest v* tag) on the NAS: make release TAG=v0.2.0 [NAS=user@host]
	ssh -t $(NAS) 'sudo $(NAS_DIR)/aram_overlay/deploy/nas/release.sh $(TAG)'
