all: lint test

lint:
	pnpm prettier -c .

test:

format:
	pnpm prettier -w .

.PHONY: all lint test

