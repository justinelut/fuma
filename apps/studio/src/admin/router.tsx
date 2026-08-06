import { Suspense } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Navigate, Route, Routes } from './lib/routing'
import { useLocation } from './lib/routing'
import { ErrorBoundary } from '@ui/components/ErrorBoundary'
import { AppLoadingScreen } from './AppLoadingScreen'
import AdminEntry from './AdminEntry'
import { hostedStaffAuthSelected } from './preauth/hostedStaffAuth'

export const FUMA_SCOPED_ADMIN_ROUTE = '/admin/organizations/:organizationId/workspaces/:workspaceId/sites/:siteId'
export const FUMA_SCOPED_ADMIN_SUBPATH_ROUTE = `${FUMA_SCOPED_ADMIN_ROUTE}/*`
export const FUMA_INVITATION_ADMIN_ROUTE = '/admin/invitations/:invitationId'

// AdminEntry is eager-imported (not behind `React.lazy`) so the cold load
// path does not require Suspense resolution before the first contentful
// commit. Cold-load measurements showed React 19's concurrent scheduler
// taking ~280 ms between the lazy chunk resolving and the commit being
// painted, which is what flushSync(root.render(...)) cannot bypass —
// flushSync only synchronises the FIRST render, and the lazy resolution
// produces a SECOND render that goes through the concurrent scheduler.
// Eager import folds AdminEntry's tiny chunk (10 KB gz) into the main
// entry; the heavy `AuthenticatedAdmin` chunk is still lazy and only
// loads post-login.
//
// Net effect on cold /admin: useEffect fires ~290 ms earlier, LCP drops
// proportionally. See `.tmp/benchmarks/REPORT.md` for the measurements.
function withSuspense(element: ReactElement): ReactElement {
  // Suspense still wraps the route so any downstream `lazy()` boundaries
  // (e.g. AuthenticatedAdmin) have a fallback.
  return <Suspense fallback={<AppLoadingScreen />}>{element}</Suspense>
}

/**
 * Per-route error boundary. Resets when the pathname changes so navigating
 * away from a broken route automatically clears the failure state — the user
 * never gets "stuck" on an error page just because they tried to come back.
 *
 * Location tag intentionally collapses to "admin-route" rather than embedding
 * the path: the architecture gate requires unique location strings per
 * placement, and we want a single boundary tag that covers every section.
 * The active pathname is surfaced via the toast body and the dev fallback.
 */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary location="admin-route" resetKeys={[pathname]}>
      {children}
    </ErrorBoundary>
  )
}

function withRouteBoundary(element: ReactElement): ReactElement {
  return <RouteBoundary>{withSuspense(element)}</RouteBoundary>
}

export interface AdminRoutesProps {
  /** Test/composition seam until FUMA-021 supplies trusted server context. */
  hostedContextCatalog?: unknown
}

export function AdminRoutes({ hostedContextCatalog }: AdminRoutesProps = {}) {
  const hosted = hostedStaffAuthSelected()

  return (
    <Routes>
      {/* Hosted staff land on the platform, whose home resolves their scope.
          Self-hosted installs have no platform layer, so `/admin` is Instatic's
          own dashboard. Instatic keeps every `/admin/<section>` path in both
          modes, which is what makes its internal navigation work unchanged
          after the hosted product hands over the viewport. */}
      <Route path="/" element={<Navigate to={hosted ? '/admin' : '/admin/dashboard'} replace />} />
      <Route
        path="/admin"
        element={hosted
          ? withRouteBoundary(<AdminEntry hostedContextCatalog={hostedContextCatalog} />)
          : <Navigate to="/admin/dashboard" replace />}
      />
      {hosted ? (
        <Route path="/admin/internal/*" element={withRouteBoundary(<AdminEntry platformAdmin hostedContextCatalog={hostedContextCatalog} />)} />
      ) : null}
      {hosted ? (
        <Route
          path={FUMA_SCOPED_ADMIN_ROUTE}
          element={withRouteBoundary(
            <AdminEntry hostedContextCatalog={hostedContextCatalog} />,
          )}
        />
      ) : null}
      {hosted ? (
        <Route
          path={FUMA_SCOPED_ADMIN_SUBPATH_ROUTE}
          element={withRouteBoundary(
            <AdminEntry hostedContextCatalog={hostedContextCatalog} />,
          )}
        />
      ) : null}
      {hosted ? (
        <Route
          path={FUMA_INVITATION_ADMIN_ROUTE}
          element={withRouteBoundary(
            <AdminEntry hostedContextCatalog={hostedContextCatalog} />,
          )}
        />
      ) : null}
      <Route path="/admin/login" element={withRouteBoundary(<AdminEntry hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/signup" element={withRouteBoundary(<AdminEntry hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/forgot-password" element={withRouteBoundary(<AdminEntry hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/reset-password" element={withRouteBoundary(<AdminEntry hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/dashboard" element={withRouteBoundary(<AdminEntry section="dashboard" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/site" element={withRouteBoundary(<AdminEntry section="site" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/content" element={withRouteBoundary(<AdminEntry section="content" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/data" element={withRouteBoundary(<AdminEntry section="data" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/media" element={withRouteBoundary(<AdminEntry section="media" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/plugins" element={withRouteBoundary(<AdminEntry section="plugins" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/users" element={withRouteBoundary(<AdminEntry section="users" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/ai" element={withRouteBoundary(<AdminEntry section="ai" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route path="/admin/account" element={withRouteBoundary(<AdminEntry section="account" hostedContextCatalog={hosted ? hostedContextCatalog : undefined} />)} />
      <Route
        path="/admin/plugins/:pluginId/:pageId"
        element={withRouteBoundary(
          <AdminEntry
            section="pluginPage"
            hostedContextCatalog={hosted ? hostedContextCatalog : undefined}
          />,
        )}
      />
      {/* Catch-all for ADMIN paths only — an unknown /admin URL (typo, stale
          deep link, /admin/login) must never render an empty tree.
          Redirecting to the dashboard shows the login form when
          unauthenticated and the dashboard otherwise. Deliberately scoped to
          /admin/*: public-site 404s have their own treatment (the publish
          pipeline's NotFound template) and must never be swallowed by the
          admin SPA. MUST stay the last route: <Routes> takes the first match
          in declaration order. */}
      <Route path="/admin/*" element={<Navigate to={hosted ? '/admin' : '/admin/dashboard'} replace />} />
    </Routes>
  )
}
