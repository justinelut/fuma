# Onlook Studio integration boundary

## Decision

Onlook replaces only the visual editing presentation mounted by Fuma's `AdminCanvasLayout`. Fuma remains the authority for authentication, organizations, workspaces, sites, editor documents, media, publishing, customer runtime, workers, scheduler, billing, admin and control surfaces.

The adapter is intentionally thin:

- `src/admin/onlook/OnlookStudioSurface.module.css` supplies Onlook's compact translucent top bar, floating rounded panels and dark canvas treatment.
- `src/admin/onlook/OnlookStudioToolDock.tsx` supplies the Onlook-style select/pan dock and writes to Fuma's existing Zustand editor store.
- `AdminCanvasLayout` mounts that presentation only for the Site visual editor.
- `useCanvas` and `CanvasRoot` consume Fuma's pre-existing `canvasMode` state so persistent pan mode works in parent and iframe canvas input paths.

## Preserved authority

| Concern | Authority after integration |
| --- | --- |
| Login/session | Fuma Better Auth hosted staff boundary |
| Organization/workspace/site selection | Fuma scoped admin routes and context catalog |
| Editor document | Fuma scoped editor repository and PostgreSQL storage |
| Draft conflict/versioning | Fuma editor session coordinator |
| Publish | Fuma publish handlers and worker pipeline |
| Customer rendering | `apps/site-runtime` |
| Admin/governance | Fuma admin and `apps/control-surfaces` |
| Public website | `apps/web` |
| Background work | Fuma worker and scheduler roles |

## Explicit exclusions

The standalone Onlook application's Better Auth setup, Drizzle schema, project/branch tables, CodeSandbox provider, Freestyle hosting, OpenRouter authority, MinIO bootstrap, Next.js routes and Kubernetes manifests are not imported. Doing so would create a second platform and violate tenant and publishing authority.

`tooling/onlook/verify-preservation.ts` compares protected platform roots with the intact base commit `86a74598e8658897a6e3bb9390f8d1c49b25fc49`. It rejects protected-root deletions and any protected change outside the individually listed visual-editor adapter files.
