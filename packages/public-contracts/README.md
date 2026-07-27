# @fuma/public-contracts

Strict, framework-free TypeBox contracts shared across Fuma public boundaries.

The package includes strict display-safe product-fact, published KES pricing, approved template/showcase/expert/reviewed-plugin projections, bounded resource filters, opaque handoff intents, safe errors, versioned read metadata, and privacy-minimized acquisition events. Every object schema is closed with `additionalProperties: false`; every exported TypeScript type is schema-derived. Stable public IDs are opaque domain-owned identifiers and must remain unchanged across dataset versions.

The contracts intentionally exclude provisional organizations, private custom offers or setup negotiations, internal grants, provider/payment/transfer data, costs and margins, tenant/internal identifiers, staff/auth/admin sessions, secrets, and PII. Platform authorities own publication and redaction; this leaf never imports application code or runtime authority.
