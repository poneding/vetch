.PHONY: run test check lint build setup fix

run:
	pnpm run dev

test:
	pnpm run test

check:
	pnpm run check

lint:
	pnpm exec ultracite check

build:
	pnpm run build

setup:
	pnpm run setup

fix:
	pnpm run fix
