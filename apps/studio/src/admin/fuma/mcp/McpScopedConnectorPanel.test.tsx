import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { McpScopedConnectorPanel } from './McpScopedConnectorPanel'

afterEach(cleanup)
describe('McpScopedConnectorPanel', () => { it('shows exact site scope, explicit grants, rates lifecycle, and revoked state', () => { render(<McpScopedConnectorPanel siteId="site-a" connectors={[{ connectorId: 'connector-a', label: 'Agent', siteId: 'site-a', ownerGeneration: 2, capabilities: ['site.read', 'site.publish'], state: 'revoked', expiresAt: '2026-08-28T00:00:00.000Z', requestsPerMinute: { read: 20, mutate: 5, publish: 2 } }]} onCreate={async () => ({ token: 'imcp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq' })} onRevoke={async () => {}} />); expect(screen.getByText('site-a')).toBeTruthy(); expect(screen.getByText(/site.read · site.publish/)).toBeTruthy(); expect(screen.getByRole('checkbox', { name: /Publish/ })).toBeTruthy(); expect((screen.getByRole('button', { name: 'Revoked' }) as HTMLButtonElement).disabled).toBe(true) }) })
