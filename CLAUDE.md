# Agent execution rules

Read `CLAUDE.md` before changing code. Its repository, architecture, data-safety, and validation rules remain authoritative.

## Browser and E2E host policy

Browser tests, Playwright tests, hydration checks, screenshots, and any claimed user-facing acceptance **must use the public Blyss HTTPS endpoint for the service port**:

```text
https://<port>.blyss.co.ke
```

Current required Fuma endpoints:

```text
Studio/admin (Vite preview): https://5174.blyss.co.ke
Public Next.js Web:          https://3002.blyss.co.ke
```

For Studio E2E, use:

```sh
E2E_ADMIN_BASE_URL=https://5174.blyss.co.ke
E2E_PUBLIC_BASE_URL=https://3002.blyss.co.ke
```

Do not use `localhost`, `127.0.0.1`, or direct container addresses for browser/E2E acceptance. A loopback request may be used only as a low-level process or container liveness diagnostic; it must never be reported as browser, routing, hydration, TLS, proxy, or public-host acceptance evidence. Final acceptance evidence must come from the matching `https://<port>.blyss.co.ke` host.

## Production architecture policy

Fuma production and deployment acceptance targets native Linux ARM64 only. Do not run or claim amd64, Docker/buildx, QEMU, or emulated compatibility evidence unless the user explicitly changes this scope. Repository-only image work must not be represented as protected publication, signing, scanning, deployment, or promotion evidence.

## Four-agent delegation policy

When the user asks to spin four agents, every subagent invocation must start **exactly four stages in parallel**:

- all four stages have no `depends_on` edges;
- each stage owns at least one complete backlog ticket or a complete multi-ticket phase, including implementation, focused tests, architecture gates, and documentation;
- never split one ticket into four planning, research, audit, frontend/backend, or other subtasks;
- select four dependency-ready tickets with non-overlapping primary file ownership so parallel edits are safe;
- route heavy backend, data, migration, compatibility, and concurrency coding stages to `claude-opus-5`; route content-heavy, public-web, visual, accessibility, and design stages to `gpt-5.6-sol`, unless the user explicitly changes that routing;
- subagents do not run unfiltered `bun test`, the root full build, or the root full lint; the primary agent owns aggregate validation and tracker closure;
- browser/E2E evidence from every stage still follows the Blyss HTTPS host policy above.

A batch is not considered a four-agent batch if dependency edges cause only one stage to start. If four sequential tickets depend on one another, choose other dependency-ready full tickets for the remaining parallel stages rather than serializing the agents or reducing them to subtasks.
