# Fuma isolated platform checkout

FUMA-055 implements platform-billing checkout for a current paid public plan or one exact issued private offer. It uses only the `platform_billing` Paystack credential scope. Customer-merchant credentials, the protected internal organization, and every `platform-internal` grant are denied before provider initialization.

## Trusted checkout contract

The caller sends only one source intent:

- public plan: plan ID, exact price-book version, and monthly/annual cadence;
- private offer: exact offer ID and integer version.

Organization, workspace, site, profile, staff actor, session, and payer email come from trusted hosted request/session authority. PostgreSQL derives currency, recurring amount, setup fee, cadence, availability, version, destination, and candidate state from immutable entitlement evidence. Callback origin and allowed merchant channels are runtime policy, never request fields.

The scoped API descendants are:

- `POST /billing/checkouts`
- `GET /billing/checkouts/:checkoutId`
- `POST /billing/checkouts/:checkoutId/cancel`
- `POST /billing/checkouts/:checkoutId/callback`

They mount below the exact `/api/fuma/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId` boundary. Reads require `site.settings.read`; initialization, cancellation, and callback verification require `site.settings.write` and same-origin mutation authorization. All responses are `no-store`.

## Private-offer lifecycle decision

Checkout accepts an immutable offer that was issued and is still available. Initialization first delegates to the FUMA-054 `EntitlementService.accept` transition. That transition atomically changes `issued` to `accepted` and creates exactly one immutable `awaiting-payment` entitlement candidate; repeated acceptance returns the same candidate. Checkout then binds its own generic checkout candidate to that entitlement candidate.

This preserves lifecycle ownership:

- FUMA-054 owns offer acceptance and the awaiting-payment candidate;
- FUMA-055 owns provider initialization, cancellation, and non-settling callback verification;
- FUMA-056 alone may settle exact obligations, activate a contract, enter `paid-transfer-pending`, or emit a transfer handoff.

Replacement issuance and acceptance coordinate on the replaced offer identity. Withdrawn, expired, replaced, destination-substituted, missing, or already-settled offers cannot initialize checkout.

## Durable replay and provider isolation

The additive checkout authority is finalized as `000058_platform_checkout_authority` and uses `fuma_platform_checkout_candidates_v2` and `fuma_platform_checkout_obligations_v2`; finalized migration `000027_checkout` remains untouched. A deterministic source/destination identity and PostgreSQL advisory lock produce one checkout candidate. Each setup or recurring obligation has an immutable reference plus a leased row claim. Only one replica calls provider initialization while concurrent duplicate clicks converge on the same record.

The Paystack transport accepts an optional preallocated exact reference. It still enforces the credential-scope/purpose prefix, strict purpose metadata, exact local ledger identity, amount, currency, and provider labels. Failed initialization releases the checkout claim but retains the same reference for safe retry.

`platform-setup` and `platform-recurring` have separate strict metadata and references. Purpose authorization reloads the exact durable obligation. Setup metadata cannot be used with the recurring purpose or vice versa.

## Callback and redaction boundary

Paystack redirects to the canonical scoped admin billing URL. The app reads only `checkout` and `reference`, then performs a same-origin POST to callback verification. Verification calls `ScopedPaystackTransport.verify`, checks the configured channel, and records only a callback-verification timestamp. It never calls `settle` and never activates a contract.

Wire responses expose destination, immutable source identity, KES consideration, state, references, and HTTPS authorization links. They omit payer email/hash, staff actor binding, evidence hashes, provider transaction/customer/authorization codes, credentials, private offer economics, costs, margin, and transfer state. UI links use `noopener noreferrer` and only provider authorization origins allowed by runtime policy are persisted.

## App-local UI

`PlatformCheckoutRouteContent` mounts only at the `site.settings` capability-owned `/admin/settings/billing` descendant. It has no profile-ID conditional and uses the existing app-local `Button` plus a CSS Module. Setup/import fee and recurring monthly/annual consideration are presented in distinct labelled regions. Callback status explicitly says settlement and activation remain pending.
