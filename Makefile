all: lint build test

build: packages/types $(wildcard packages/*) scripts

lint:
	pnpm prettier -c .
	pnpm eslint .

test:

format:
	pnpm prettier -w .

packages/%: FORCE
	cd $@ && rm -rf dist && tsc

scripts: FORCE
	cd scripts && rm -rf dist && tsc

.PHONY: all lint test
FORCE:
