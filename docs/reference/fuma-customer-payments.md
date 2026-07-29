# Customer-merchant Publication payments (FUMA-058)

FUMA-058 owns paid Publication membership revenue and remains the sole `customer_merchant` credential, transport, provider-verification, webhook, ledger, and transfer authority. FUMA-069 adds reviewed plugin payment obligations and paid blocks over those shared primitives; it does not create a second provider or merchant authority. Neither boundary processes Instatic platform billing, SITE plans, or live provider operations.

## Authority and money boundaries

`customer_merchant` Paystack credentials, transport, webhook route, purpose, and ledger are disjoint from `platform_billing`. Merchant scope contains exact platform, organization, workspace, site, stable owner key, and owner generation. Credential plaintext is accepted only by the trusted scoped admin route, encrypted with scope/version AAD, zeroed after use, and never returned by route views. Member routes derive host/site/member/session/email authority outside request bodies.

Every membership obligation is strict TypeBox data and KES-only. Paystack reconciliation revalidates the exact local purchase, reference, amount, currency, channel, labels, credential version, and provider transaction identity before activation. Provider transaction/reference reuse across obligations fails closed. Unknown/tampered labels never grant access.

## Renewal policy

- A card is recurring only when the exact Kenyan merchant/currency capability reports support and verified provider evidence includes a reusable authorization. Stored authorization codes are separately encrypted and bound to the source purchase metadata.
- Safaricom and Airtel are prepaid `mobile_money` periods. Every period requires a new explicit `renewalConfirmationId`; confirmation reuse is denied durably. Mobile money never enters the automatic card-renewal service.
- Daraja has no adapter or route and fails as unsupported.
- Verified activation and every active/grace/expired transition synchronize through `PaidPublicationAccessProjector`, the isolated seam into FUMA-039 access authority.
- Lifecycle batches emit idempotent renewal-due, grace-started, and expired reminders.

## Routes and transfer

Ticket-owned isolated boundaries are:

- scoped staff `POST /publication/payments/merchant-credentials`;
- member `POST /__fuma/publication/payments/initialize` and `/reconcile`;
- ticket-owned per-merchant raw webhook `POST /_fuma/paystack/webhooks/customer-merchant/:credentialId`, mounted before the shared Paystack prefix boundary.

The `customer-merchant-credentials` transfer step requires a durable explicit `rekey` or `detach` choice. It snapshots the exact source credential/version, revalidates current owner and saga fence for apply/verify/compensate, revokes recurring authority during movement, persists receipts, and restores source authority only with the exact compensation receipt.

## Finalized migration and conductor integration

The old finalized `000030_customer_payments` schema cannot represent exact owner generations, purchase initialization, recurring authorization, reminders, idempotent transactions, or recoverable transfer choices. The additive replacement is finalized and centrally registered as `000061_customer_merchant_payments_v2` with SHA-256 checksum `1c481f0670054f4510e54db03f24da3d9648778d74d289245c1fd9a3f2e401e7`. It fails closed if legacy customer-payment rows exist so conversion still requires explicit reviewed migration rather than silent abandonment.

`createHostedCustomerPaymentRuntime` composes the PostgreSQL payment and transfer repositories, customer Paystack purpose registration, production AES-256-GCM credential cipher seam, payment/card-renewal/lifecycle services, capability-authorized scoped routes, member boundary, per-merchant raw webhook boundary, and `customer-merchant-credentials` transfer step. It returns those declarations and boundaries without importing an app-global router; the owning Bun route, job, and transfer roots consume them. The commercial-edge phase inventory now records both lifecycle/card-renewal job kinds, the `publication-membership` customer purpose, and the transfer choice contract.

The finalized migration was applied with `000062` and `000063` to a blank disposable native PostgreSQL 16 schema. The FUMA-058 and FUMA-063 live repository acceptances then passed together: 2 tests, 14 expectations, 0 failures. No provider mutation, customer charge, purchase, or production migration occurred.

## Focused evidence

- `customerPayments.test.ts`: card/mobile demo, exact reconciliation, channel/country/currency gates, label distrust, retry/idempotency, recurrence, reminders/grace/expiry, paid-access projection, platform-scope denial.
- `customerPaymentRoutes.test.ts`: trusted scope/member derivation, strict bodies, non-enumeration, secret/ciphertext redaction.
- `customerPaymentTransfer.test.ts`: rekey/detach apply, replay, verification, fencing, compensation, owner drift.
- `customerPaymentsPostgresAcceptance.test.ts`: optional disposable-schema production-repository concurrency, settlement, recurrence, confirmation uniqueness, lifecycle, and transfer recovery.
- `architecture/fuma-customer-payments.test.ts`: TypeBox-only/server-local boundaries, no real provider/Daraja path, schema/route/ledger separation, profile-neutral capability authorization, finalized registered migration policy, and source ceilings.
