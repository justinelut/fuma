# Immutable campaign delivery

FUMA-046 consumes a locked FUMA-045 newsletter version and resolves the final audience, rendered HTML/plaintext, inherited sender settings, schedule, and recipient deliveries once.

## Snapshot authority

Campaign snapshots record separate SHA-256 hashes for the normalized audience and rendered content/settings, a hash of the complete immutable snapshot, and maximum initial message bytes. Source newsletter, segment, member, or settings edits after snapshot creation do not alter queued deliveries. Mutable lifecycle status is separate from the hashed fields.

The configured launch ceiling is 2 MiB. Snapshot creation checks the maximum recipient envelope and submission checks the final provider envelope again after an unsubscribe URL is issued. Oversized messages fail closed before provider submission.

## Delivery and retry

Only the narrow `OciEmailDeliveryProvider` port is selectable. The production adapter uses OCI Email Delivery, signs requests through a private server-owned signer, and sends the recipient-stable key `campaign:<snapshot-sha256>:<member-id>` as OCI's `opc-retry-token`. Provider credentials never enter campaign contracts, tenant routes, Studio, plugins, or AI.

Each recipient result is persisted immediately. A partial provider outage therefore retries only failed/deferred recipients; accepted and terminal recipients are skipped. OCI retry-token semantics protect the provider-success/database-failure boundary. Suppression is checked immediately before every attempt, so an unsubscribe after snapshot but before submission wins.

## Scheduling, cancellation, and progress

Scheduled campaigns enqueue `publication.newsletter-send` with only campaign ID and immutable snapshot hash under trusted site-job authority. Durable effect keys include both values. Cancellation uses an exact status compare-and-set and is allowed only before sending; a queued job that later observes `cancelled` submits nothing. Read-authorized progress reports recipient counts, lifecycle state, hashes, and message bytes. Sending and cancellation retain `publication.newsletters.send` authority.

The Studio Newsletters surface uses the existing app-local Button primitive and CSS Module. It supports optional scheduling, progress refresh, hash/size evidence, and pre-send cancellation with labelled status output.
