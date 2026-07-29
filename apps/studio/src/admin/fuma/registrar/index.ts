import type { ComponentType } from 'react'
import { RegistrarSurface, type RegistrarSurfaceProps } from './RegistrarSurface'

export * from './client'
export * from './contracts'
export * from './RegistrarSurface'

/** App-local declaration consumed by the conductor-owned settings route composition. */
export const REGISTRAR_SETTINGS_UI_DECLARATIONS = Object.freeze([
  Object.freeze({
    id: 'fuma.registrar.settings',
    path: '/admin/settings/domains/new',
    capability: 'site.settings',
    readPermission: 'site.settings.read',
    writePermission: 'site.settings.write',
    component: RegistrarSurface as ComponentType<RegistrarSurfaceProps>,
  }),
])
