# Fuma unified canary, rollback, and launch handoff

The repository gate at `packages/fuma-governance-launch/handoff/launch-gate.json` defaults to `abort`. Placeholder hashes, false checks, zero margin and empty approvals are deliberate. Production declaration is an external incident-command decision; this phase did not deploy, alter DNS/TLS/indexation, create secrets, contact providers or sign evidence.

## Mandatory signed inputs

1. Every FUMA-001–084 and FUMA-WEB-018 acceptance owner supplies current evidence; root build/test/lint and all targeted suites pass in the authorized validation phase.
2. One paired source SHA binds lock hash, migration high-water mark, immutable runtime/public web digests, SBOM, provenance and public HTTPS smoke. Control/ops artifacts are bound in the deployment overlay.
3. Oracle/OCI/Cloudflare quotes and invoices allocate all material fixed/shared/variable cost. Customer variable COGS is at most 30% and customer gross margin at least 70%; internal shadow work is cost, never revenue.
4. OCI email quota, SPF/DKIM, bounce/complaint routing and deliverability pass. Cloudflare origin/DNS/TLS/apex review passes. GHCR/signing/base-image evidence is current.
5. Public content, claims, legal/privacy/cookies/acceptable-use, SEO/indexation, consent and WCAG 2.2 AA are approved.
6. One protected non-transferable metered internal grant has no billing path. A managed-client custom annual offer proves separate setup fee, exact quota/cost/margin review, acceptance, provider-verified payment, `paid-transfer-pending`, successful transfer and recoverable failed transfer without moving the grant.
7. Lawyer migration/pilot proves complete route/page/member/membership/access parity, provider-verified paid state, OCI email, immutable grandfathered contract and signed rollback restoration.
8. Named on-call owners acknowledge every page alert/runbook and communications owner.

## Canary sequence

- Bootstrap protected internal authority through the approved one-time process; verify no ordinary API can grant/recover it.
- Deploy suspended migration candidate, backup, migrate, and run public HTTPS host/cookie smoke.
- Runtime cohort: staff/internal grant, then named beta organizations, then bounded customer percentage. Public web: independent 10% edge cohort after projection compatibility.
- Exercise public→app→auth→app resume, separate admin login, standard pricing, custom offer/payment/transfer, Website, Publication, email, payment, domain, AI/MCP/plugin and two tenant/custom hosts.
- Hold each stage for its approved observation window. Compare RED/USE, Web Vitals/conversion, queue, provider, domain, backup and cost signals to baseline.

## Objective rollback

Rollback immediately for severity-one isolation/data loss, unknown/default tenant serving, parent/shared cookie, auth/admin realm leakage, payment ledger divergence, irreversible transfer failure, migration mismatch, stale/unrecoverable backup, public contract private-data leak, critical plugin/sandbox issue, SLO fast burn, gross-margin threshold breach, or missing on-call ownership. Public-web-only contract/performance failures roll back its digest independently. Forward schema is not reversed; runtime rollback requires declared compatibility, otherwise restore under incident command.

## Declare or abort

`decideLaunch` can return `declare` only when migration, restore, host isolation, public web, security, accessibility and current provider evidence are true; economics pass; and all six independent roles—platform, security, finance, public-web, legal/accessibility, and incident command—sign current evidence. Any unknown is false. Record decision, evidence hash, exact cohort, timestamps and communications. An abort is a successful safety result, not an exception to bypass.

## Post-launch ownership

Platform owns runtime/migrations/DR; public-web owns acquisition/SEO/Web Vitals/independent rollback; security owns incidents/moderation/signing; commerce owns ledger/provider/refunds/economics; messaging owns OCI deliverability; domains owns Cloudflare/TLS; customer success owns Lawyer and transfer recovery. Review at 24 hours, 7 days and 30 days with incidents, SLOs, costs, support load and rollback readiness.
