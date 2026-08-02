# Self-Host PostgreSQL Smoke Harness

This guide defines the PostgreSQL release-candidate smoke expectations for the production image and release bundle.

The production acceptance target is `compose.prod.yml` with PostgreSQL. A smoke run must use isolated project-scoped resources and must never point at operator databases, uploads, or existing containers.

---

## Required evidence

A release-candidate smoke must prove:

1. The release bundle contains `compose.prod.yml`, deployment documentation, and the expected static/runtime assets.
2. The app and PostgreSQL services become healthy.
3. `/health`, `/admin`, and representative static assets respond from the candidate image.
4. PostgreSQL migrations are non-empty, unique, and additive across replacement.
5. A database marker and upload/published artefact markers survive application restart and forced image replacement.
6. Cleanup targets only the run's exact project-scoped resources.

## Safety rules

- Use a unique run ID and disposable PostgreSQL database/volume.
- Bind the app only to an ephemeral loopback port during local smoke work.
- Never reuse production credentials or mounted paths.
- Inspect a dry-run/resource plan before any executable smoke.
- Preserve failure logs, then clean only the exact disposable project.
- Do not treat a source-only or dry-run check as deployed production evidence.

## Current tooling note

`tooling/selfHostSmoke.ts` may contain legacy compatibility branches. PostgreSQL is the supported acceptance branch; legacy database branches are not production, development, test, or release acceptance targets. Tooling changes are outside this documentation-only task and should be handled separately before relying on the harness as a hard release gate.

The focused plan test remains:

```sh
bun test tooling/selfHostSmoke.test.ts
```

That test validates command planning only and does not constitute a live deployment smoke.

## Related

- [release-workflow.md](release-workflow.md) — release process
- [vps.md](vps.md) — `compose.prod.yml` production stack
- [backup-restore.md](backup-restore.md) — operator data handling
- `tooling/selfHostSmoke.ts` — implementation requiring PostgreSQL-only follow-up
- `compose.prod.yml` — supported production stack
