export PATH		:=		$(PWD)/bin:$(PATH)

all: lint build test

build: packages/types $(wildcard packages/*) scripts apps/facilitator

lint:
	pnpm prettier -c .
	pnpm eslint .

test:

format:
	pnpm prettier -w .

packages/%: FORCE
	cd $@ && rm -rf dist && pnpm tsc && pnpm tsc-esm-fix

apps/%: FORCE
	cd $@ && rm -rf dist && pnpm tsc

scripts: FORCE
	cd scripts && rm -rf dist && pnpm tsc
	cd scripts/nestjs-example && rm -rf dist && pnpm tsc -p nestjs-example/tsconfig.json

clean:
	rm -f .env-checked

.env-checked: bin/check-env
	./bin/check-env
	touch .env-checked

include .env-checked

.PHONY: all lint test
FORCE:
