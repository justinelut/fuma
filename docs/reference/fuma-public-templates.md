# Fuma public template discovery and exact-release previews

FUMA-WEB-010 keeps template truth in the product and limits `apps/web` to strict presentation. The public projection accepts only closed TypeBox records containing a stable public ID and slug; Website/Publication profiles; capability, industry, and style tags; WCAG 2.2 AA review metadata; one bounded discovery image; and one exact retained release. Private owner, tenant, organization, workspace, site, draft, editor, artifact-key, and installation fields are not part of the public contract.

## Approval and withdrawal

`server/fuma/publicTemplates` owns approval, withdrawal, discovery, preview authorization, and install resolution. Approval compares the requested manifest SHA-256 with the current exact ready/active release, requires a retention root, verifies `/index.html`, verifies the discovery image against the release manifest, enforces the 300,000-byte image budget, and derives the only accepted preview origin:

```text
https://templates.preview.trimly.co.ke/releases/<exact-release-id>/
```

Stable IDs and canonical slugs cannot be replaced. Withdrawal is a monotonic compare-and-set mutation and leaves a minimal `{id, slug, withdrawnAt}` tombstone. Withdrawn records disappear from unfiltered discovery and sitemap material immediately, while an exact slug lookup can distinguish the tombstone from a never-existing record. A withdrawn stable ID cannot be resurrected.

The projection is `no-store`. Canonical filters are `profile`, `capability`, `industry`, and `style`; detail reads use the canonical `slug` filter rather than downloading a broad catalog. Cursor identity is bound to content-addressed public version material that includes withdrawals.

## Preview isolation and artifact ownership

The preview boundary accepts only exact Host `templates.preview.trimly.co.ke`, `GET`/`HEAD`, canonical `/releases/<id>/...` paths, and requests without cookies or authorization. Every read first rechecks current template approval, exact manifest hash, and retention, then reads and SHA-256-verifies the existing release object. It never copies release bytes into Web or a template-specific object store. Responses are no-store and carry CSP, COOP, COEP, CORP, permissions, referrer, framing, and MIME-sniffing isolation headers. Withdrawal therefore revokes future preview reads even though the underlying retained artifact is immutable.

## Product-owned install handoff

Web links to `/start` with only `kind=use_template`, `source=template`, and the stable `templateId`. The shared closed handoff schema rejects a caller-supplied release, artifact, owner, redirect, or profile override. Product consumption calls `resolveInstallIntent`, which re-reads current approval and exact retained release authority after authentication. Its resolution contains coordinates and a manifest hash, never artifact bytes. Installation and artifact application remain product-owned.

## Image, sitemap, responsive, and accessibility rules

Discovery images are exact-release assets with explicit alternative text, intrinsic width/height, supported image MIME, and at most 300,000 bytes. Only exact-host, exact-release, budget-valid, `sitemapEligible: true` records produce template sitemap rows. Withdrawal or stale preview metadata removes the row.

The Web routes use app-local Tailwind and existing app-local primitives. Discovery cards move from one to two to three columns; detail content collapses to one column and actions stack at narrow widths. Filter controls are labelled, images carry authority-supplied alternative text and dimensions, focus remains visible, preview-new-tab text is announced, and the detail page renders the authority-supplied accessibility review.

## Conductor registrations

This worker intentionally does not edit central composition, route dispatch, migration registry/checksums, tracker, audit, ledger, or integration files. Integration must:

1. allocate the final sequential hosted migration ID for `publicTemplateReleasesMigration`, register it once, and finalize its checksum;
2. replace the central fail-empty `TemplatesSource` with `ApprovedTemplatesProjectionSource`, composed from `PublicTemplateCatalogService`, `PostgresPublicTemplateCatalogRepository`, and `PostgresTemplateReleaseAuthority`;
3. mount `createTemplatePreviewBoundary` only on exact preview-host dispatch, composing `PublicTemplateCatalogService` with `PostgresTemplatePreviewReader` and the shared release object store;
4. connect the product handoff consumer for `use_template` to `resolveInstallIntent` after identity establishment and before installation;
5. use `templateSitemapRows` (or equivalent `exactTemplatePreview` eligibility) in the central discovery sitemap composition;
6. register the ticket in central tracker/audit/ledger/integration records after conductor acceptance.

No public Web route, preview boundary, or handoff consumer may import Studio app internals across application boundaries. No browser acceptance is claimed by this worker unless separately executed through `https://3002.blyss.co.ke` and the registered preview-host acceptance endpoint.
