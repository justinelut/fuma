import { useMemo, type ReactNode } from 'react'
import type { FumaScopedShellReadyContext } from '../FumaScopedShell'
import { BookingsHttpClient } from './client'
import { BookingsWorkspace } from './BookingsWorkspace'
import { BOOKING_ADMIN_CAPABILITY_ID, BOOKING_ADMIN_ROUTE_ID } from './registry'

export function BookingsRouteContent({ shell }: Readonly<{
  shell: FumaScopedShellReadyContext
}>): ReactNode {
  const { organizationId, workspaceId, siteId } = shell.resolution.selection
  const client = useMemo(
    () => new BookingsHttpClient({ organizationId, workspaceId, siteId }),
    [organizationId, workspaceId, siteId],
  )
  if (
    shell.routeAccess.kind !== 'allowed'
    || shell.routeAccess.route.id !== BOOKING_ADMIN_ROUTE_ID
    || !shell.resolution.profile.capabilities.some(({ id }) => id === BOOKING_ADMIN_CAPABILITY_ID)
  ) return null
  return (
    <div data-testid="bookings-route-content">
      <BookingsWorkspace
        client={client}
        canWrite={shell.permissionState['site.settings.write'] === true}
      />
    </div>
  )
}
