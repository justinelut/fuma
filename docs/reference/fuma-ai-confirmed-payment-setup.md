# AI-confirmed payment setup (FUMA-070)

FUMA-070 lets the existing native site AI propose one fixed reviewed payment integration while keeping installation consent, browser challenge material, merchant credentials, and customer charge amounts outside AI. It reuses the FUMA-065 site-AI scope, FUMA-067 installations, FUMA-068 review/signature authority, FUMA-058 merchant credentials, and FUMA-069 customer-payment plugin and ledger.

## Fixed proposal surface

The registered server tool is `site_propose_payment_setup`. Its canonical TypeBox input is exactly:

```ts
{ purpose: 'deposit' | 'donation' | 'checkout' }
```

The schema is the exact `SiteProposePaymentSetupInputSchema` object exported from `@core/ai`; the registry does not redeclare it. Server policy fixes all other choices:

- package `fuma.customer-payments@1.0.0`;
- grants `cms.routes`, `modules.register`, `payments.customer.create`, and `payments.customer.refund`;
- matching reviewed block `fuma.customer-payments.<purpose>`;
- Fuma platform fee `KES 0`;
- test preview `KES 1.00` (`100` minor units).

The AI receives a public proposal view, `/secure-payment`, and next-action guidance. It never receives or selects tenant scope, artifact/review/install IDs, grants, code/JSX, browser nonce, handoff token, credentials, or a customer charge amount.

## Authority and state flow

`AiPaymentSetupService` is the single state-machine authority. It derives actor and exact tenant ownership from the durable FUMA-065 conversation binding and accepts proposal identity from the durable tool-call ID. It locates only the exact currently approved FUMA-068 artifact and delegates installation to `ArtifactReviewService.install`.

Proposal states are append-only and compare-and-set:

```text
proposed -> confirmed -> credential-stored -> tested
```

The user flow is:

1. AI creates or reuses the idempotent fixed proposal.
2. Control loads only the strict public proposal view.
3. The browser generates 32 random bytes and registers only their SHA-256 hash.
4. The current user reviews artifact version/hash, four grants, fee disclosure, purpose, and block, then checks seven explicit acceptance controls.
5. A fresh direct non-impersonated hosted staff session submits the raw nonce and exact immutable acceptance. The service revalidates current review, signature, revocation, scope, and actor before the exact installation.
6. Confirmation returns a 256-bit one-time handoff token only in `__Host-fuma_ai_payment_setup`, with `Secure`, `HttpOnly`, `SameSite=Strict`, an exact credential-route path, and a five-minute lifetime.
7. Control reads merchant credentials directly from `FormData`, immediately clears the form, and posts them only to the exact credential endpoint. The service delegates storage to `CustomerMerchantPaymentService.attachCredential`.
8. The shared FUMA-069 service executes the fixed KES 1.00 preview and persists only purpose, amount/currency policy evidence, and a receipt fingerprint.

A failed external credential write leaves the claimed handoff fail-closed. No raw nonce, token, public key, secret key, or provider credential is stored in proposal/handoff tables.

## Scoped HTTP boundary

The feature contributes only to the existing hosted scoped route boundary:

```text
GET  /ai/payment-setup/proposals/:proposalId                     plugins.read
POST /ai/payment-setup/proposals/:proposalId/challenge           plugins.install
POST /ai/payment-setup/proposals/:proposalId/confirm             plugins.install
POST /ai/payment-setup/proposals/:proposalId/credentials         plugins.configure
```

Organization, workspace, site, owner generation, and product profile come from trusted `FumaScopedRouteHandlerInput`; request bodies cannot choose scope. The Control BFF allows only exact marketplace/payment-setup route shapes, validates the product origin, forwards cookies, and forwards `Set-Cookie` only from a successful exact confirmation response. The retired `/api/secure-payment-settings` placeholder returns `410` and owns no credential authority.

## Durable storage

Canonical migration `000074_ai_payment_setup` creates:

- `fuma_ai_payment_setup_proposals_v1`;
- `fuma_ai_payment_setup_handoffs_v1`.

Checksum:

```text
29cc495c97c6bb78f915a9ab5116c2ca997294d4f483c6af8f9433f07b483615
```

Database triggers and constraints enforce immutable proposal identity/review evidence, legal state transitions, exact review/install/credential scope at transition time, one handoff, and absence of top-level secret/nonce/token JSON fields. Artifact ownership transfer remains possible; it invalidates the old immutable setup scope rather than being blocked by a foreign key.

## Acceptance evidence

- Focused service and architecture gates cover fixed artifact/grants/fees, current review and direct confirmation, cross-scope/expired handoffs, secret redaction, one hosted route boundary, schema identity, and absence of parallel authority.
- Native PostgreSQL 16 on Linux ARM64 passes eight-way challenge, confirmation, handoff-claim, credential-completion, and preview-completion contention with one winning transition each; append-only and transfer-invalidating behavior pass; cleanup is `0|0` schemas/roles.
- Browser acceptance navigates only `https://5174.blyss.co.ke` using native ARM64 Chromium and completes proposal review, seven acceptances, nonce/hash proof, direct credential entry, and fixed KES 1.00 preview with zero browser errors. Transcript SHA-256: `bca83004790f9935780ebe526ef7b8de7c42d29946e0292050f23a55fc44bebb`.
- The final root aggregate passes `8,120` tests with `35` expected optional skips, `0` failures, and `152,496` assertions. Web passes `95/557`, Control `5/33`, and Governance `55/340`; combined suites pass `8,275` tests and `153,426` assertions.
- Frozen install, strict Studio TypeScript, repository lint, complete production build, generated QuickJS bootstrap, migration `74/74`, lock, diff, native-architecture, and PostgreSQL cleanup audits pass.

No live provider charge, refund, credential mutation, production migration/deployment, DNS/TLS change, purchase, protected signing/scanning, Docker/buildx, emulation, or push is part of this acceptance.
