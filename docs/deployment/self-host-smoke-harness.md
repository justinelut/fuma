# Self-Host Docker Smoke Harness

This guide covers the disposable FUMA-WEB-003 harness for proving the moved Studio Docker image and release bundle against SQLite and PostgreSQL.

The source of truth is `tooling/selfHostSmoke.ts`. It consumes an already-built image and release bundle, creates uniquely named Docker Compose projects, and removes their containers, networks, and named volumes in `finally` on success or failure. It never points at host database files, existing containers, or operator volumes.

---

## TL;DR

- Run `--dry-run` first; it validates CLI input and prints the complete command/resource plan without invoking Docker or reading the bundle.
- Execution requires `--image` and `--release-bundle`. `--replacement-image` is optional and defaults to `--image`.
- Each run creates separate `instatic-fuma-web-003-<run-id>-sqlite` and `instatic-fuma-web-003-<run-id>-postgres` Compose projects.
- The app binds an ephemeral port on `127.0.0.1`; it never claims the operator's normal port 3001.
- Cleanup uses only the two exact project names and `docker compose down --volumes --remove-orphans`. The harness never prunes global Docker resources.
- Focused plan tests run without Docker: `bun test tooling/selfHostSmoke.test.ts`.

## Build inputs

Build the image and release bundle before executing the harness:

```sh
docker build -t instatic:fuma-web-003 .
bun run release:bundle -- 0.0.11-smoke
```

The harness does not build or pull images. This keeps the proof tied to the exact local candidate supplied by the maintainer and prevents an unexpected network operation.

## Inspect the command plan

```sh
bun tooling/selfHostSmoke.ts \
  --dry-run \
  --run-id local-check \
  --image instatic:fuma-web-003 \
  --release-bundle .tmp/release/instatic-0.0.11-smoke-release-bundle.tar.gz
```

`--run-id` accepts only lower-case ASCII letters, digits, and hyphens. Before startup, the harness checks Docker's Compose project labels and fails if matching containers, volumes, or networks already exist; collision checks occur outside cleanup ownership, so an existing project is never adopted or deleted. The plan names every project and volume, includes both database modes, recreates the app container for the replacement phase, and includes unconditional project-volume cleanup.

## Execute the smoke

```sh
bun tooling/selfHostSmoke.ts \
  --run-id local-check \
  --image instatic:fuma-web-003 \
  --release-bundle .tmp/release/instatic-0.0.11-smoke-release-bundle.tar.gz
```

To prove a real upgrade, provide two locally available images:

```sh
bun tooling/selfHostSmoke.ts \
  --run-id upgrade-check \
  --image instatic:previous \
  --replacement-image instatic:candidate \
  --release-bundle .tmp/release/instatic-0.0.11-smoke-release-bundle.tar.gz
```

The same-image form still proves persistence across container replacement. The two-image form additionally proves that every migration ID applied by the previous image remains present after the candidate starts.

## Evidence produced

For both SQLite and PostgreSQL, `tooling/selfHostSmoke.ts` verifies:

1. The release archive has one safe top-level directory and includes `Caddyfile`, `INSTALL.md`, both production/SQLite Compose files, and deployment docs.
2. `compose.prod.yml` uses `STATIC_DIR=/app/dist`, and `INSTALL.md` contains both documented startup commands.
3. Docker image metadata has `WORKDIR /app/apps/studio`, `STATIC_DIR=/app/dist`, and `CMD ["bun", "run", "server/index.ts"]`.
4. The app reaches `/health` with the TypeBox-validated `{ "status": "ok", "ts": number }` response.
5. `/admin` and `/favicon.svg` come from the built Studio static directory.
6. A disposable database marker, `/app/uploads/fuma-web-003/proof.txt`, and `/app/uploads/published/fuma-web-003/proof.txt` survive an app restart and forced container recreation.
7. `schema_migrations` is non-empty and unique; replacement is additive (no prior ID disappears); final SQLite/PostgreSQL migration ID lists are equal.
8. `/uploads/fuma-web-003/proof.txt` remains HTTP-readable after restart and replacement.

Docker inspect JSON, container probe JSON, health JSON, CLI values, port output, and archive entry lists are validated with TypeBox in `tooling/selfHostSmoke.ts`.

## Isolation and failure behavior

The PostgreSQL password and marker values are fixed disposable test values used only inside the unique project network and volumes. PostgreSQL is not published to a host port. The app is published only to an ephemeral loopback port.

When a phase fails, the harness prints logs for that disposable project's app/PostgreSQL services, runs project-scoped cleanup, removes its temporary extracted bundle, and exits non-zero. It has no keep-volumes option by design. Never replace its generated project names or volume mounts with paths from a live installation.

## Related

- [`docker-image.md`](docker-image.md) — production image runtime contract.
- [`release-workflow.md`](release-workflow.md) — image and release-bundle production.
- [`backup-restore.md`](backup-restore.md) — live operator data handling; the smoke harness never consumes those backups.
- `tooling/selfHostSmoke.ts` — harness and TypeBox boundaries.
- `tooling/selfHostSmoke.test.ts` — Docker-free command-plan tests.
- `Dockerfile` — moved Studio image workdir, static directory, healthcheck, and startup command.
- `compose.prod.yml`, `compose.sqlite.yml` — release-bundle Compose inputs.
