all: lint build test

build: $(wildcard packages/*)

lint:
	pnpm prettier -c .
	pnpm eslint .

test:

format:
	pnpm prettier -w .

packages/%: FORCE
	cd $@ && rm -rf dist && tsc

.PHONY: all lint test
FORCE:
