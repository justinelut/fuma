# @fuma/governance-launch

Phase-local production contracts and policy for FUMA-063 through FUMA-085 plus tracker task 86. It contains strict TypeBox boundaries, additive PostgreSQL migration sources, reviewed payment plugin artifacts, fixtures, all requested test categories, source-only evidence tooling, and central/external handoff manifests. `handoff/requirement-matrix.json` is the resumed completion ledger; `handoff/dry-run-plan.json` lists planned checks that remain explicitly unexecuted. The phase-local SQL filenames map to hosted migrations `000035`–`000039` to avoid the already-owned `000013`–`000034` range.

This package does not own the central router, hosted migration index/checksums, transfer/job registries, shared public contracts, root lockfile, production secrets, provider accounts, DNS or deployment execution. Those bindings are explicit in `handoff/central-integration.yaml` to avoid unsafe concurrent edits.

Intended later validation (not run in the coding-only phase):

```sh
bun --cwd=packages/fuma-governance-launch run typecheck
bun --cwd=packages/fuma-governance-launch run test
bun --cwd=packages/fuma-governance-launch run evidence:dry-run
```

The evidence command only inventories source. It does not test, build, deploy, contact providers, sign artifacts, mutate DNS/cloud/database state or handle secrets.
