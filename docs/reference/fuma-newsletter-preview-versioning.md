# Newsletter preview, test send, and versioning

FUMA-045 builds on the allowlisted EmailDocument renderer, hierarchical email settings, and newsletter composer.

## Immutable versions

Newsletter send versions are append-only. Each newsletter accepts only the next contiguous ordinal; an existing ID or ordinal cannot be overwritten. Comparison loads two locked versions through exact Publication scope, requires both to belong to the selected newsletter, and reports deterministic changes to subject, preview text, and document.

## Server-owned preview fixtures

Preview accepts only `public`, `free-member`, or `paid-member`. The server owns all fixture values, uses reserved `example.invalid` addresses and preview-only HTTPS unsubscribe URLs, and accepts no caller-provided variable map. Both responsive HTML and plaintext are produced by the FUMA-042 data-only renderer. Fixture substitution occurs before validation/rendering and cannot expose provider secrets.

## Test sends

Test sends require `publication.newsletters.send`, use only the OCI Email Delivery port, prefix subjects with the selected fixture label, and set explicit test/fixture headers. A scoped recipient may create five distinct idempotency keys per ten-minute window; replaying one key does not consume another slot. Production campaigns remain FUMA-046 authority.

## UI and errors

The Studio Newsletter surface uses app-local primitives and CSS Modules. It exposes fixture selection, HTML and plaintext previews, immutable comparison, and separately permissioned test-send controls. Plaintext and comparison outputs are labelled for assistive technology; failures are reported through the existing status surface.
