# FUMA-041 React Email compatibility decision

This record covers the isolated compatibility harness in `server/fuma/email/compatibility/`. It selects the email dependencies and records native acceptance evidence; it does not define tenant `EmailDocument` rendering.

## Decision and amended deployment scope

FUMA-041 accepts the React Email 6.9.1 unified package and matching preview UI package on **native Linux ARM64 only**:

| Direct package | Placement | Exact pin | Official registry repository | Integrity | `os` / `cpu` |
|---|---|---:|---|---|---|
| `react-email` | runtime dependency | `6.9.1` | `resend/react-email`, `packages/react-email` | `sha512-uUDRgFukMUXRlrsCNGlA0PZuUlQ44faI9hT/D7uMjozdumLBdHjfQttQswRYLjyLW8fFtg2HBrxAESbFU4ZKKA==` | none / none |
| `@react-email/ui` | preview-only dev dependency | `6.9.1` | `resend/react-email`, `packages/ui` | `sha512-zw7KvwMu3RU/fDC9TAkegg9/qNV9foJtd3QRoetdWVFe8aQC/NyXmWTrG9IrkzVLzn5otkkxu7e7B1QelcwdiQ==` | none / none |

Both are exact direct pins in `apps/studio/package.json` and exact resolved entries in the one root `bun.lock`. The focused gate also preserves FUMA-010's exact Better Auth, Drizzle, postgres.js, and `auth` CLI pins. No dependency or lockfile change was required for this closure.

The user explicitly amended deployment and acceptance to Linux ARM64 only. The historical Linux amd64 demonstration is **removed from scope**, not skipped, pending, simulated, or claimed. There is no amd64 matrix entry, CI job, receipt variant, or compatibility test skip. An amd64 host/argument is unsupported and fails closed. No Docker, QEMU, emulation, cross-build, or amd64 infrastructure is part of this decision or its evidence.

React Email 6 exports components and `render` from `react-email`, so `@react-email/components` and `@react-email/render` are deliberately not direct dependencies. `@react-email/render` remains only as an upstream transitive selected by the exact lock. `@react-email/ui` is needed by the official preview CLI and is not part of the production renderer surface.

## Verified compatibility result

The native acceptance host reported:

```text
Linux workspace 6.17.0-1016-oracle #16~24.04.1-Ubuntu SMP Tue May 26 23:06:21 UTC 2026 aarch64 aarch64 aarch64 GNU/Linux
Bun 1.3.14
react-email 6.9.1
@react-email/ui 6.9.1
React 19.2.5
React DOM 19.2.5
```

On that host, all of the following pass from the exact root lock:

- direct Bun import of the official unified components and async `render` API;
- repeated byte-identical HTML and plaintext rendering;
- official CLI HTML/plaintext export matching direct-render bytes;
- official CLI preview build and built-preview HTTP process smoke;
- exact committed output hashes and representative client markup checks;
- native host/target binding, source/lock binding, atomic receipt persistence, and hostile/tampered receipt rejection;
- fail-closed rejection of every unselected package/runtime version, non-Linux platform, and non-ARM64 architecture.

The selected `react-email` package declares Node `>=20.0.0` and React/React DOM `^18.0 || ^19.0 || ^19.0.0-rc`; it does not declare a Bun engine. Bun compatibility is therefore measured evidence for the exact tuple above, not an upstream guarantee or a claim about other Bun versions.

## Rendering and representative-client evidence

| Output | SHA-256 |
|---|---|
| HTML | `15529a7edd130c292f7818ff0b9bd8431ccf5c416672f979b0b9d6c7fd4d49b4` |
| plaintext | `74f8137974fc8ef6d0ee1f6ea056cb641b6881a3ba06bb3fff0efa8706a41935` |

The committed fixture verifies XHTML Transitional output, UTF-8 and Apple reformat metadata, hidden preheader text, presentation tables, inline styles, a 600px maximum, absolute image/link URLs, dimensions and alt text, Outlook conditional button markup, and readable plaintext containing link destinations. It rejects active script and `javascript:` output. These are representative output constraints; no screenshot, browser, inbox-provider, or universal mail-client certification is claimed.

The preview build test creates an isolated temporary workspace from the repository manifests, workspace packages/vendor, fixture, and the exact root `bun.lock`; it performs a frozen Bun install there and invokes the pinned official CLI from that isolated Studio workspace. React Email 6.9.1 then copies its preview app, uses npm internally for that generated app, and runs Next build/start. Isolation prevents the generated Turbopack root from depending on Git-worktree `node_modules` symlink topology while preserving the root lock as dependency authority. The temporary workspace, `.react-email` tree, and generated `package-lock.json` are deleted; none becomes repository content or a second committed lock authority. Production rendering uses the direct `render` API, never the preview application.

## Native ARM64 acceptance and receipt

The only declared target is:

| Target | Native command | Result |
|---|---|---|
| Linux ARM64 | `FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-arm64.json timeout 21m bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts arm64` | passed natively |

The gate performs `bun install --frozen-lockfile`, proves the root lock bytes did not change, rejects nested lock authorities, runs the focused compatibility/render/architecture tests under deadlines, and writes a TypeBox-validated schema-version 3 receipt. The receipt requires `execution: "native"`, target and host `linux/arm64`, Bun 1.3.14, the exact React Email/React tuple, zero test skips/failures, root-lock and bounded-source hashes, official API metadata, and exact output hashes. Any unsupported target, mismatched host, changed source/lock, malformed count, or tampered receipt fails closed.

CI mirrors only that contract on GitHub's native `ubuntu-24.04-arm` runner and uploads `fuma-email-compatibility-linux-arm64`. A successful CI artifact is additional native evidence, not a prerequisite for the local native receipt recorded in this work.

## Scope boundary

- No tenant-authored JSX, raw HTML, arbitrary component loading, sanitizer, variable resolver, sender, delivery job, route, worker, migration, or central composition is introduced.
- No browser acceptance was required; the preview check is a local built-process HTTP smoke only.
- No tracker, audit, ledger, migration registry/checksum, integration record, or unrelated release/deployment policy is changed.
- The system notice remains a static compatibility fixture, not a production email-template API.
