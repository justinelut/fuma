/**
 * Shared dashboard state.
 *
 * Zustand is already this app's global store, so the dashboards use it rather
 * than introducing a second mechanism. The overview is read once per session and
 * shared by every dashboard page, so navigating between pages does not refetch
 * the same measurements.
 */
import { create } from 'zustand'
import {
  EMPTY_SITE_OVERVIEW,
  readSiteOverview,
  type SiteOverview,
} from './siteOverview'

type OverviewStatus = 'idle' | 'loading' | 'ready'

interface DashboardStore {
  status: OverviewStatus
  overview: SiteOverview
  /** Reads the overview once. Repeat calls while loading or ready are no-ops. */
  loadOverview(): Promise<void>
  /** Forces a re-read, for an explicit refresh control. */
  refreshOverview(): Promise<void>
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  status: 'idle',
  overview: EMPTY_SITE_OVERVIEW,
  async loadOverview() {
    if (get().status !== 'idle') return
    set({ status: 'loading' })
    const overview = await readSiteOverview()
    set({ status: 'ready', overview })
  },
  async refreshOverview() {
    set({ status: 'loading' })
    const overview = await readSiteOverview()
    set({ status: 'ready', overview })
  },
}))
