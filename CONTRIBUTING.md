# Contributing To Instatic

Thanks for helping improve Instatic. The project is pre-1.0, self-hosted, and intentionally moving quickly, so contributions should favor clean architecture over compatibility shims.

## Start Here

1. Read [README.md](README.md) for product context and local setup.
2. Read [docs/README.md](docs/README.md) for the documentation map.
3. Read [docs/architecture.md](docs/architecture.md) before changing cross-cutting code.
4. For deployment changes, read [docs/deployment/README.md](docs/deployment/README.md).

## Local Development

Use Bun for all project commands:

```sh
bun install
bun run dev
```

Local development requires PostgreSQL. Use `DATABASE_URL=postgres://instatic:instatic@127.0.0.1:5433/instatic`; tests must use a dedicated database or isolated schemas and must never target production.

Useful checks:

```sh
bun run build
bun test
bun run lint
```

For Docker changes:

```sh
docker build -t instatic:local .
docker compose -f compose.prod.yml -f compose.build.yml config
```

## Pull Requests

- Keep PRs focused on one problem.
- Include tests for behavior changes.
- Update docs in the same PR when behavior, configuration, public APIs, or deployment instructions change.
- Use TypeBox at untyped boundaries.
- Use existing UI primitives in `src/ui/components/` for admin UI controls.
- Do not add provider SDKs, `zod`, `react-router-dom`, or third-party icon packages to existing Studio code. Preserve Studio's CSS Modules and primitives; use exact-pinned Tailwind CSS plus app-local shadcn/ui source components for new Fuma React/Next.js surfaces.

## Project Conventions

Instatic is pre-release. Do not add deprecation shims or backwards-compatibility wrappers for old internal APIs. If a shape is wrong, update the source of truth and all callers in the same change.

Important rules live in:

- [docs/reference/typebox-patterns.md](docs/reference/typebox-patterns.md)
- [docs/reference/database-dialects.md](docs/reference/database-dialects.md)
- [docs/reference/page-tree.md](docs/reference/page-tree.md)
- [docs/reference/react-compiler.md](docs/reference/react-compiler.md)
- [docs/reference/ui-primitives.md](docs/reference/ui-primitives.md)

## Reporting Security Issues

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).
