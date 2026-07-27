# Fuma EmailDocument renderer

This reference defines the data-only tenant email contract and its server renderer.

`EmailDocument` is a versioned TypeBox document interpreted through a closed React Email component allowlist. Tenant input never becomes JSX, JavaScript, an import, a callback, or raw HTML.

---

## TL;DR

- The shared v1 schema and deterministic validation boundary live in `src/core/fuma/email/document.ts`.
- Tenant rendering lives in `server/fuma/email/tenantDocumentRenderer.ts`; it contains no JSX and calls the pinned `react-email` direct `render` API.
- Trusted server-authored JSX uses only `server/fuma/email/trustedSystemTemplateRenderer.tsx`; it is not a tenant template API.
- Unknown components, props, style keys, URL schemes, prototype keys, accessors, functions, executable source/markup, and resource-limit violations are rejected before rendering.
- The renderer returns byte-deterministic HTML and plaintext for equivalent documents, including documents whose object keys arrived in different orders.
- This boundary does not resolve settings/variables, persist newsletters/campaigns, send messages, or integrate OCI Email Delivery.

## The document shape

Import the public contract through `@core/fuma/email`:

```ts
import { parseEmailDocument, type EmailDocument } from '@core/fuma/email'

const document: EmailDocument = parseEmailDocument({
  version: 1,
  previewText: 'Your workspace update',
  children: [{
    type: 'container',
    children: [
      { type: 'heading', level: 1, text: 'Workspace update' },
      { type: 'text', text: 'Your workspace is ready.' },
      {
        type: 'button',
        text: 'Review workspace',
        href: 'https://app.fuma.invalid/review',
      },
    ],
  }],
})
```

The root accepts only `version`, `lang`, `direction`, `previewText`, `bodyStyle`, and `children`. Version `1` accepts these component literals:

| Component | Allowed content props |
|---|---|
| `container`, `section`, `row` | `children`, optional `style` |
| `column` | `children`, optional `width`, optional `style` |
| `text` | `text`, optional `style` |
| `heading` | `text`, `level` (`1`–`3`), optional `style` |
| `link`, `button` | `text`, `href`, optional `style` |
| `image` | HTTPS `src`, `alt`, numeric `width`/`height`, optional `style` |
| `divider` | optional `style` |
| `spacer` | `height`, optional `style` |

Every object uses `additionalProperties: false`. There is no arbitrary component name, tag name, prop bag, raw HTML, markdown, class name, event callback, render function, or source field.

## Inline style and link policy

`EmailStyleSchema` in `src/core/fuma/email/document.ts` is the complete style allowlist. It contains bounded layout, spacing, typography, border, and six-digit hex color properties. Values are closed literals or anchored length/color patterns. CSS strings, custom properties, `url()`, `calc()`, selectors, stylesheets, animation, positioning, and background images cannot enter the renderer.

Links accept absolute HTTPS URLs without credentials or custom ports, plus a single bare `mailto:` address. Image sources accept absolute HTTPS only. Relative, protocol-relative, HTTP, `data:`, `file:`, `javascript:`, `vbscript:`, credential-bearing, custom-port, and whitespace/control-character URLs are rejected.

Text is passed as a React child and therefore escaped. Active markup/source patterns such as script/iframe/object/embed/style/SVG/MathML tags, inline event attributes, JavaScript URLs, ESM/CommonJS imports, and exports are rejected rather than merely escaped.

## Validation and limits

Use `validateEmailDocument(input)` when callers need diagnostics without exceptions. Use `parseEmailDocument(input)` at a hard boundary; it throws `EmailDocumentValidationError` with the same diagnostics.

Diagnostics have stable `code`, JSON-pointer `path`, and `message` fields. They are deduplicated and sorted by path, code, then message. Canonical cloning sorts object keys and freezes the validated result, so input key insertion order and later caller mutation cannot affect output.

| Limit | Value | Constant |
|---|---:|---|
| Decoded data budget | 65,536 bytes | `EMAIL_DOCUMENT_MAX_BYTES` |
| Component depth | 12 | `EMAIL_DOCUMENT_MAX_DEPTH` |
| Aggregate components | 256 | `EMAIL_DOCUMENT_MAX_NODES` |
| Children per array | 64 | `EmailDocumentSchema` / `EmailNodeSchema` |
| Combined rendered HTML/plaintext | 524,288 bytes | `EMAIL_DOCUMENT_MAX_OUTPUT_BYTES` |

The data preflight also rejects cycles, accessors, symbols, non-finite numbers, non-plain prototypes, `__proto__`, `prototype`, and `constructor`. These checks happen before recursive TypeBox validation.

## Rendering boundaries

Tenant rendering:

```ts
import { renderEmailDocument } from '../../../server/fuma/email'

const { html, text } = await renderEmailDocument(untypedTenantInput)
```

`server/fuma/email/tenantDocumentRenderer.ts` maps each validated discriminant to a statically imported React Email component with `createElement`. It does not evaluate source, resolve an import path, accept a component/callback, compile JSX, or use the React Email preview application.

Trusted system templates are ordinary server-owned `.tsx` modules and render through `renderTrustedSystemTemplate` in `server/fuma/email/trustedSystemTemplateRenderer.tsx`. This boundary trusts the imported server code and deliberately does not accept an `EmailDocument`. Do not expose it through tenant/plugin/AI input or build a source/module-name loader around it.

## Forbidden patterns

- Tenant-authored `.tsx`, JSX strings, JavaScript strings, template modules, dynamic imports, `require`, callbacks, or component references.
- `dangerouslySetInnerHTML`, raw HTML/markdown components, arbitrary React Email exports, arbitrary DOM tags, or arbitrary prop/style bags.
- Bypassing `parseEmailDocument` and passing tenant objects directly to React or `render`.
- Sending trusted JSX through the tenant renderer or tenant data through `renderTrustedSystemTemplate`.
- Adding settings inheritance, newsletter/campaign persistence, preview/test-send APIs, provider adapters, jobs, runtime-root wiring, or OCI delivery in this module.

## Related

- `server/fuma/email/compatibility/DECISION.md` — exact React Email package and direct-render compatibility evidence.
- `docs/reference/typebox-patterns.md` — repository boundary-validation conventions.
- Source-of-truth schema: `src/core/fuma/email/document.ts`
- Tenant renderer: `server/fuma/email/tenantDocumentRenderer.ts`
- Trusted JSX renderer: `server/fuma/email/trustedSystemTemplateRenderer.tsx`
- Security and determinism tests: `src/__tests__/fuma/emailDocumentRenderer.test.ts`
