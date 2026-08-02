import { describe, expect, it } from 'bun:test'
import { runMcpDemo } from '../../../server/fuma/mcp'

describe('FUMA-066 MCP demo', () => { it('connects two sites, revokes one token, and publishes only through the exact permitted connector', async () => { const result = await runMcpDemo(); expect(result.connectedSites).toEqual(['site-a', 'site-b']); expect(result.revokedDenied).toBe(true); expect(result.wrongSiteDenied).toBe(true); expect(result.publishedSite).toBe('site-b'); expect(result.publishedConnector).toBe('connector-b'); expect(result.creditLifecycle).toEqual(['reserve:mcp:connector-b:publish-b-1', 'settle:mcp:connector-b:publish-b-1']); expect(result.secretsPresent).toBe(false) }) })
