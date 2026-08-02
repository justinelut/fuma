/**
 * Streamable HTTP MCP endpoint, bridged to Bun's `Bun.serve` Web `Request`/
 * `Response` model.
 *
 * The SDK's `WebStandardStreamableHTTPServerTransport` speaks Web Standards
 * (Request, Response, ReadableStream) natively, so it drops straight into the
 * hand-written router with no Node-compat shim.
 *
 * Stateless-per-request: each request authenticates, builds a capability-scoped
 * MCP server, and runs a single transport exchange with `enableJsonResponse`
 * so the whole result comes back as one JSON body (no long-lived SSE stream to
 * manage in the request/response router). Returns `null` when the path isn't
 * ours, honouring the router's fall-through contract.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { DbClient } from '../../../db/client'
import { resolveMcpAuth, unauthorizedResponse } from '../auth'
import { buildMcpServer } from '../server'
import type { McpNativeHttpAuthority } from '../authority'

export const MCP_ENDPOINT_PATH = '/_instatic/mcp'

export interface McpHttpOptions {
  uploadsDir?: string
  authority?: McpNativeHttpAuthority
}

async function requestIdentity(req: Request): Promise<Readonly<{ rpcMethod: string | null; rpcId: string | null; operationId: string }>> {
  const body = await req.clone().json().catch(() => null) as { method?: unknown; id?: unknown } | null
  const rpcMethod = typeof body?.method === 'string' ? body.method : null
  const rpcId = typeof body?.id === 'string' || typeof body?.id === 'number' ? String(body.id) : null
  const supplied = req.headers.get('Idempotency-Key')?.trim()
  const safe = supplied && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$/.test(supplied) ? supplied : null
  return { rpcMethod, rpcId, operationId: safe ?? `rpc:${rpcId ?? crypto.randomUUID()}` }
}

export async function handleMcpHttp(
  req: Request,
  db: DbClient,
  options: McpHttpOptions = {},
): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== MCP_ENDPOINT_PATH) return null

  const identity = await requestIdentity(req)
  const hosted = options.authority ? await options.authority.resolve(req, identity).catch(() => null) : null
  const legacy = options.authority ? null : await resolveMcpAuth(req, db)
  if (!hosted && !legacy?.ok) return unauthorizedResponse(url)

  const server = hosted
    ? buildMcpServer({
        db,
        userId: hosted.userId,
        connectorId: hosted.connectorId,
        capabilities: hosted.capabilities,
        operationId: hosted.operationId,
        connectorCapabilities: hosted.connectorCapabilities,
        bridgeSiteKey: hosted.bridgeSiteKey,
        publishRuntime: hosted.publishRuntime,
        authority: hosted.authority,
      })
    : legacy?.ok
      ? buildMcpServer({
          db,
          userId: legacy.userId,
          connectorId: legacy.connectorId,
          capabilities: legacy.capabilities,
          uploadsDir: options.uploadsDir,
          operationId: identity.operationId,
        })
      : null
  if (!server) return unauthorizedResponse(url)

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    return await transport.handleRequest(req)
  } catch (err) {
    console.error('[ai:mcp] transport error:', err)
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  } finally {
    void server.close().catch(() => {})
  }
}
