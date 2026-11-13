# >>> probe (generated - do not edit, run `probe sync`)
PROBE ?= $(shell command -v probe >/dev/null 2>&1 && echo probe || echo "npx -y @ninhache/probe@latest")
.PHONY: help check status check-api check-front
help: ## List available targets
	@awk -F':.*## ' '/^[a-zA-Z0-9_-]+:.*## /{printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
check: ## Check that every service responds
	@$(PROBE) check
status: ## Show probe status
	@$(PROBE) status
check-api: ## Check api
	@$(PROBE) check api
check-front: ## Check front
	@$(PROBE) check front
# <<< probe

dev: ## Start the demo services
	node server.mjs
