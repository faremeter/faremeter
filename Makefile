export PATH			:=		$(PWD)/bin:$(PATH)
export INSIDE_STAGING_DIR	:=		false

all: lint build doc test

pre-build: FORCE
	rm -f .eslintcache .build-finished

build: pre-build packages/logs packages/types packages/info packages/wallet-solana packages/wallet-evm packages/middleware packages/middleware-openapi packages/gateway-nginx $(wildcard packages/*) packages/test-harness apps/facilitator apps/sidecar scripts tests
	touch .build-finished

lint:
	pnpm prettier -c .
	pnpm eslint --cache .

test:
	@[[ -d .tap/plugins ]] || pnpm tap build
	pnpm tap --disable-coverage

format:
	pnpm prettier -w .

doc: FORCE
	bin/generate-readme
	pnpm prettier -w packages/*/README.md
	pnpm typedoc
	bin/strip-link-extensions docs
	pnpm prettier -w docs/

sync-docs: doc
	@test -n "$(DEST)" || (echo "Usage: make sync-docs DEST=<dir>" && exit 1)
	cp docs/*.md "$(DEST)/"
	@echo "Synced $$(ls docs/*.md | wc -l | tr -d ' ') files to $(DEST)"
	@echo "Remember to commit in the destination repo."

packages/gateway-nginx: FORCE
	cd $@ && rm -rf dist && pnpm tsc && pnpm tsc-esm-fix
	find $@/src/lua -name '*.lua' ! -name '*.test.lua' -exec cp {} $@/dist/src/lua/ \;

packages/%: FORCE
	cd $@ && rm -rf dist && pnpm tsc && pnpm tsc-esm-fix

apps/%: FORCE
	cd $@ && rm -rf dist && pnpm tsc && pnpm tsc-esm-fix

scripts: FORCE
	cd scripts && rm -rf dist && pnpm tsc
	cd scripts/nestjs-example && rm -rf dist && pnpm tsc -p nestjs-example/tsconfig.json

tests: FORCE
	cd tests && pnpm tsc

clean:
	rm -f .env-checked .eslintcache .build-finished
	rm -rf .tap docs
	find . -type d -name "dist" -a ! -path '*/node_modules/*' | xargs rm -rf

.env-checked: bin/check-env
	./bin/check-env
	touch .env-checked

include .env-checked

.PHONY: all lint test
FORCE:
