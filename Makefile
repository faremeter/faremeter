all: lint test

lint:
	pnpm prettier -c .
	pnpm eslint .

test:

format:
	pnpm prettier -w .

.PHONY: all lint test

