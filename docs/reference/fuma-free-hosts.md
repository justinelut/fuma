# Fuma free-host authority and public routing

FUMA-050 owns allocation and public serving for free `<tenant>.trimly.co.ke` hosts. Production code is isolated under `apps/studio/server/fuma/freeHosts/`; the central server only constructs the production graph and invokes its boundary before legacy self-host routes.

## Host policy

Labels are lowercase ASCII DNS labels between 3 and 63 characters. Input normalization accepts case, an optional numeric port, and exactly one terminal dot, but rejects repeated terminal dots, whitespace, user info, paths, comma-joined authorities, invalid ports, empty labels, IDN Unicode, and `xn--` punycode. `fuma` and `fuma-*` are reserved.

The permanent reserved set includes `auth`, `app`, `admin`, `www`, `api`, `status`, `support`, and `mail`, plus reviewed operational names: `assets`, `billing`, `cdn`, `checkout`, `console`, `dashboard`, `docs`, `edge`, `help`, `hooks`, `mcp`, `media`, `objects`, `preview`, `scheduler`, `static`, `uploads`, `webhook`, `webhooks`, and `worker`. The service enforces this before persistence; migration `000043_free_host_authority` adds the matching forward-only PostgreSQL constraint for new writes.

## Durable authority

`PostgresFreeHostRepository` is the production repository. Allocation serializes by exact host and exact site, then requires one current owner row matching platform, organization, workspace, site, stable owner key, and owner generation with active state and null transfer IDs/lock/fence. Host and site uniqueness make retries or collisions fail without replacing an allocation.

Each allocation stores the owner generation and a monotonic allocation version. Suspension/reactivation requires the same exact authority and expected version. Stale generations, stale versions, and transfer-fenced owners cannot mutate state.

Resolution uses the exact normalized Host and repeats all allocation coordinates while joining the current unfenced owner, exact active release pointer, and exact active immutable release manifest. A stale owner generation, transfer fence, missing pointer, non-active release, malformed manifest, or coordinate mismatch returns no release.

## Public boundary

`FreeHostPublicRouter` owns every non-control Host when hosted mode is active. Only the configured product Host bypasses it for staff/admin/API routing. `/health` remains a process-level probe and does not select a tenant.

For an allocated active Host, the router maps `/` to `/index.html`, extensionless paths to their exact path or `.html`, and assets to exact manifest logical paths. It fetches only the manifest's content-addressed object key from the allocation's exact organization/workspace/site object scope, then rechecks byte length and SHA-256 before responding. Responses carry `X-Fuma-Release-Id` for operational evidence and currently use `Cache-Control: no-store`; FUMA-051 owns edge caching policy.

Noncanonical free authorities and configured canonical custom hosts use `308` HTTPS redirects while preserving path and query. Unknown, malformed, reserved, suspended, stale, fenced, and inactive-release Hosts return `404` or `421` with no default tenant and no release header.

## Migration

`000022_free_hosts` remains byte-stable. Additive migration `000043_free_host_authority` adds `owner_generation`, `allocation_version`, `state_updated_at`, the reviewed reservation constraint, and an active exact-authority index. Its authored SQL SHA-256 is:

```text
d41fda99a82a0e260d386c3feababfda65cb67b4972f88a24c33f3e555bb375b
```

The canonical migration registry keeps `000043` after concurrently reserved `000041` and `000042`. While an earlier migration remains sentinel/unapplied, `000043` must also remain in that unapplied suffix; hosted migration policy forbids finalizing a later checksum ahead of it.

## Focused validation

```sh
bun test src/__tests__/fuma/freeHostRouter.test.ts \
  src/__tests__/fuma/freeHostCentralRouter.test.ts \
  src/__tests__/fuma/freeHostMigration.test.ts \
  src/__tests__/fuma/freeHostPostgresAcceptance.test.ts \
  src/__tests__/architecture/fuma-free-host-router.test.ts

bun test src/__tests__/fuma/releaseManifest.test.ts \
  src/__tests__/fuma/releaseService.test.ts \
  src/__tests__/fuma/releaseRepository.test.ts
```

The deterministic Host-header demo serves `tenant-alpha.trimly.co.ke` from `release-alpha`, `tenant-bravo.trimly.co.ke` from `release-bravo`, and proves an unknown Host returns 404 with no fallback. The PostgreSQL acceptance additionally proves suspension, transfer-fence denial, and stale-generation denial against the production repository and real migration SQL.
