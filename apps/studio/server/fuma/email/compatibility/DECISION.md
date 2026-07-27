# FUMA-041 React Email compatibility decision

This record covers only the isolated spike in `server/fuma/email/compatibility/`. It selects dependencies and records compatibility evidence; it does not define or render tenant `EmailDocument` data.

---

## Decision

Accept the React Email 6.9.1 unified package and its matching preview UI package as the FUMA-042 implementation candidates:

| Direct package | Placement | Exact pin | Official registry repository | Integrity | `os` / `cpu` |
|---|---|---:|---|---|---|
| `react-email` | runtime dependency | `6.9.1` | `resend/react-email`, `packages/react-email` | `sha512-uUDRgFukMUXRlrsCNGlA0PZuUlQ44faI9hT/D7uMjozdumLBdHjfQttQswRYLjyLW8fFtg2HBrxAESbFU4ZKKA==` | none / none |
| `@react-email/ui` | preview-only dev dependency | `6.9.1` | `resend/react-email`, `packages/ui` | `sha512-zw7KvwMu3RU/fDC9TAkegg9/qNV9foJtd3QRoetdWVFe8aQC/NyXmWTrG9IrkzVLzn5otkkxu7e7B1QelcwdiQ==` | none / none |

Both are exact direct pins in `package.json` and exact resolved entries in `bun.lock`. FUMA-010's exact Better Auth, Drizzle, postgres.js, and `auth` CLI pins remain unchanged and are asserted by the focused test.

React Email's official 6.0 update guide says components previously published from `@react-email/components` and rendering utilities previously published from `@react-email/render` are exported directly by `react-email`. Those packages are therefore deliberately not added as direct dependencies. `@react-email/render` 2.1.0 remains an upstream transitive dependency selected by the exact lockfile. The official CLI requires `@react-email/ui` to build or serve its preview app, so the matching 6.9.1 package is selected as an exact dev dependency. It is not part of the future production renderer surface.

## Compatibility result

- **Bun runtime/render:** passed on Bun 1.3.14. `react-email` imports its React components and `render` utility successfully. HTML and plaintext rendering are byte-deterministic across repeated runs.
- **React 19:** passed against the repository's resolved React 19.2.5 and React DOM 19.2.5. The selected `react-email` registry peer range explicitly includes React and React DOM 19.
- **Linux ARM64:** passed on the current `Linux 6.17.0-1016-oracle aarch64` host. This is runtime evidence, not an inference from absent package platform exclusions.
- **Linux amd64:** pending. No amd64 runtime was available in this session. The same exact-lockfile probe is committed and skips on nonmatching hosts; no amd64 pass is claimed.
- **Direct render:** passed and matches committed `systemNotice.html` and `systemNotice.txt` fixtures.
- **CLI export:** `bun run email export` produces the same HTML and plaintext bytes as direct render.
- **Preview build:** `bun run email build` completes and statically generates `/preview/systemNotice`.
- **Built preview:** `bun run email start` serves the built fixture, and the focused smoke test reads the system notice from `/preview/systemNotice`.

The selected `react-email` package declares a Node engine of `>=20.0.0`, not a Bun engine. The successful Bun 1.3.14 runtime, export, and CLI invocation are therefore measured compatibility evidence rather than a package guarantee.

### Preview build limitation

React Email 6.9.1 documents `--packageManager` for `email build`, but the installed CLI reports that the option is deprecated and ignored. The CLI launched by Bun internally prepares `.react-email`, runs `npm install`, and runs the Next preview build through npm. The spike accepts this only for local preview tooling because:

1. production HTML/plaintext rendering and CLI export run directly under Bun;
2. `.react-email` is generated, temporary evidence and is removed by the test;
3. no generated `package-lock.json`, preview application, Next runtime, or npm command is committed or wired into a runtime root.

FUMA-042 must use the direct `render` utility, not the preview application, as its production rendering boundary.

## Deterministic output and client constraints

The architecture-neutral output hashes are:

| Output | SHA-256 |
|---|---|
| HTML | `15529a7edd130c292f7818ff0b9bd8431ccf5c416672f979b0b9d6c7fd4d49b4` |
| plaintext | `74f8137974fc8ef6d0ee1f6ea056cb641b6881a3ba06bb3fff0efa8706a41935` |

The representative system fixture proves the selected renderer emits:

- an XHTML Transitional email doctype and UTF-8 metadata;
- `x-apple-disable-message-reformatting` and a hidden preheader;
- nested presentation tables with zero cell padding/spacing and a 600px content maximum;
- inline styles, absolute image URLs, explicit image dimensions, and alt text;
- Outlook conditional button markup (`<!--[if mso]>`, `mso-text-raise`);
- absolute HTTPS action/fallback links with no script or `javascript:` content;
- readable plaintext with link destinations and no HTML table markup.

These checks are representative renderer constraints, not a claim of screenshots or certification from every mail client. Visual inbox testing belongs to later email implementation/release work.

## Executable architecture matrix

| Target | Command | Evidence in this session |
|---|---|---|
| Linux ARM64 | `FUMA_EMAIL_EXPECT_PLATFORM=linux FUMA_EMAIL_EXPECT_ARCH=arm64 bun run server/fuma/email/compatibility/architectureProbe.ts` | passed |
| Linux amd64 (`x64`) | `FUMA_EMAIL_EXPECT_PLATFORM=linux FUMA_EMAIL_EXPECT_ARCH=x64 bun run server/fuma/email/compatibility/architectureProbe.ts` | pending; executable gate committed |

Each probe rejects a host that does not match the declared target, validates the exact selected package tuple plus React 19/Bun 1.3, renders twice, and requires the committed HTML/plaintext hashes. The native target additionally performs a frozen install, rejects nested install authorities, runs the focused FUMA-041/FUMA-042 tests under hard command deadlines, and atomically writes a schema-validated receipt. Run the focused suite with:

```sh
bun test server/fuma/email/compatibility/compatibility.test.ts
```

## Scope boundary

- No tenant `EmailDocument` schema, renderer, allowlist, sanitizer, variable resolution, or tenant-authored JSX is introduced; FUMA-042 owns that work.
- No newsletter, sender, OCI delivery, authentication, durable job, or production route is introduced.
- No runtime root, docs index, migration, or historical schema source is changed.
- The system notice is a static compatibility fixture only. It is not a production email template API.

## Bounded native-run receipt contract

The repository now declares the preview lifecycle explicitly in `apps/studio/package.json`: `fuma:email:preview` invokes `email dev` with the fixture directory, `fuma:email:build` invokes `email build` with that directory, and `fuma:email:serve` invokes `email start`. Focused tests bind those declarations to the installed official CLI's `dev`, `build`, `start`, and `export` commands. These remain local compatibility tooling; production rendering continues to call the direct `render` API.

`evidence.ts` validates more than version strings. It requires the direct dependency placement, exact workspace lock declarations, one exact lock package/integrity entry per selected package, React/React DOM lock versions, upstream repository directories, Node engine and peer ranges, ESM export paths, the official CLI bin, and every unified component used by the fixture. Architecture evidence binds all of that to:

- `execution: "native"` and identical target/host `linux` plus `arm64` or `x64` values;
- Bun 1.3.14 and the exact React Email/React tuple;
- the root lock SHA-256;
- individual hashes and a stable aggregate hash for the decision, workflow, package manifests, target/matrix/probe/evidence code, fixture, snapshots, every receipt-counted focused test, and the bounded renderer/contract sources those tests exercise;
- exact output hashes and exact focused test pass/skip counts.

This source set is intentionally fail-closed: changing a counted test or its renderer/contract input invalidates an older receipt even when the numeric pass/skip totals happen to remain unchanged.

The target refuses a missing receipt path, unsupported target, nonmatching native host, changed frozen lock, nested lock authority, malformed probe result, failed/partial test count, or source/receipt tampering. It writes the JSON atomically and reparses it. The workflow runs on separate native GitHub-hosted `ubuntu-24.04` x64 and `ubuntu-24.04-arm` runners and uploads one architecture-named receipt per successful job. No container or emulation result is accepted by this contract.

A local native run is bounded to 20 minutes overall, with stricter per-command deadlines. On a clean checkout with the exact committed lockfile, use one of:

```sh
# Native Linux ARM64
FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-arm64.json \
  timeout 21m bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts arm64

# Native Linux amd64/x64 — the remaining FUMA-041 acceptance command
FUMA_EMAIL_RECEIPT_PATH=.tmp/fuma-email-compatibility-linux-amd64.json \
  timeout 21m bun run apps/studio/scripts/fuma-email-compatibility-matrix.ts amd64
```

The amd64 command must execute on a real `linux/x64` host and exit zero. Acceptance evidence is the complete stdout showing the x64 architecture gate and **9 compatibility pass / 1 deliberate ARM64 skip**, the renderer/architecture suite showing **12 pass / 0 fail**, plus `.tmp/fuma-email-compatibility-linux-amd64.json` successfully parsed against the same checkout. The CI equivalent is a successful `Linux x64` job and its `fuma-email-compatibility-linux-amd64` artifact. Until that native receipt exists, FUMA-041 remains blocked; the nonmatching-host skip is intentional and must not be removed or represented as amd64 acceptance.
