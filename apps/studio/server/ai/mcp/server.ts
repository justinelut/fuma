/**
 * Build a capability-scoped MCP `Server` over Instatic's existing tool engine.
 *
 * We use the low-level SDK `Server` + `setRequestHandler` (not the higher-level
 * `McpServer.registerTool`, which requires Zod schemas — banned repo-wide).
 * This lets us advertise our canonical TypeBox `inputSchema` verbatim as JSON
 * Schema (exactly as the AI drivers send it to providers) and run each call
 * through `executeAiTool`, which already does TypeBox input validation, a
 * capability re-check, and `{ ok, data | error }` normalisation.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { DbClient } from '../../db/client'
import type { CoreCapability } from '@core/capabilities'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { AiBrowserBridge, AiTool, AiToolOutput } from '../runtime/types'
import { executeAiTool } from '../drivers/http/execTool'
import { mcpToolsForCapabilities } from './registry'
import { authorizeMcpContentTool } from './contentAuthorization'
import type { McpNativeCapability, McpNativeConnectorCapability, McpNativeExecutionAuthority } from './authority'
import type { McpPublishRuntime } from './tools/publishTool'
import {
  getEditorBridgeForUser,
  type EditorBridgeScope,
} from './editorBridge'

export interface McpServerContext {
  db: DbClient
  userId: string
  connectorId: string
  capabilities: readonly CoreCapability[]
  connectorCapabilities?: readonly McpNativeConnectorCapability[]
  uploadsDir?: string
  operationId?: string
  bridgeSiteKey?: string
  publishRuntime?: McpPublishRuntime
  authority?: McpNativeExecutionAuthority
}

// Used for server-resolved tools, which never call the bridge.
const NOOP_BRIDGE: AiBrowserBridge = {
  callBrowser: async () => {
    throw new Error('[ai:mcp] this tool has no server handler and no live editor bridge')
  },
}

const NO_WORKSPACE_MESSAGE: Record<EditorBridgeScope, string> = {
  site: 'This tool runs in the Instatic Site editor. Open the Site editor in a browser (signed in as the connector owner) and try again.',
  content: 'This tool runs in the Instatic Content workspace. Open the Content workspace in a browser (signed in as the connector owner) and try again.',
}

function nativeCapability(tool: AiTool): McpNativeCapability {
  if (tool.name === 'site_publish' || tool.name === 'site_publish_components') return 'publish'
  return tool.mutates ? 'mutate' : 'read'
}


function connectorCapability(tool: AiTool, capability: McpNativeCapability): McpNativeConnectorCapability {
  return tool.mcpCapability ?? (capability === 'read' ? 'site.read' : capability === 'mutate' ? 'site.mutate' : 'site.publish')
}
function callToolResult(output: AiToolOutput): CallToolResult {
  if (!output.ok) return { isError: true, content: [{ type: 'text', text: output.error ?? 'Tool failed.' }] }
  const payload = output.data === undefined || output.data === null ? { ok: true } : output.data
  const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(payload) }]
  for (const image of output.images ?? []) content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
  return { content }
}

export function buildMcpServer(ctx: McpServerContext): Server {
  const server = new Server(
    { name: 'instatic', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  const publishRuntime = ctx.publishRuntime ?? (ctx.uploadsDir
    ? { connectorId: ctx.connectorId, uploadsDir: ctx.uploadsDir }
    : undefined)
  const tools = mcpToolsForCapabilities(ctx.capabilities, publishRuntime, ctx.connectorCapabilities)
  const byName = new Map<string, AiTool>(tools.map((t) => [t.name, t]))

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await ctx.authority?.revalidate({ phase: 'list' })
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        // Our TypeBox object schema IS a valid JSON-Schema tool definition. The
        // `AiTool.inputSchema` field is the general `TSchema`, so we adapt it to
        // the SDK's object-schema shape (a type-level adaptation, not a runtime
        // data boundary — every MCP tool's schema is a `Type.Object`).
        inputSchema: t.inputSchema as unknown as { type: 'object'; properties?: Record<string, unknown> },
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params
    const tool = byName.get(name)
    if (!tool) {
      return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
    }
    const input = args ?? {}
    const capability = nativeCapability(tool)
    const exactConnectorCapability = connectorCapability(tool, capability)
    const operationId = ctx.operationId ?? `legacy:${ctx.connectorId}:${crypto.randomUUID()}`
    try {
      await ctx.authority?.revalidate({ phase: 'tool-dispatch', toolName: name, capability, connectorCapability: exactConnectorCapability })
      const claim = await ctx.authority?.authorizeTool({ operationId, toolName: name, capability, connectorCapability: exactConnectorCapability, input })
      if (claim?.replay) return callToolResult(claim.replay)
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: getErrorMessage(error, 'MCP connector authority denied.') }] }
    }

    // Server-resolved tools run in-process; browser tools are relayed to the
    // connector owner's matching open workspace. No workspace → a clear,
    // actionable error. Browser tools currently belong only to Site or
    // Content; keep that invariant explicit instead of guessing a bridge.
    let bridge = NOOP_BRIDGE
    if (tool.execution === 'browser') {
      if (tool.scope !== 'site' && tool.scope !== 'content') {
        await ctx.authority?.abortTool({ operationId, toolName: name, capability, input, reasonCode: 'unsupported-bridge-scope' }).catch(() => {})
        return {
          isError: true,
          content: [{ type: 'text', text: `Browser tool "${tool.name}" has unsupported scope "${tool.scope}".` }],
        }
      }
      const browserScope: EditorBridgeScope = tool.scope
      const live = getEditorBridgeForUser(ctx.userId, browserScope, ctx.bridgeSiteKey)
      if (!live) {
        await ctx.authority?.abortTool({ operationId, toolName: name, capability, input, reasonCode: 'bridge-closed' }).catch(() => {})
        return { isError: true, content: [{ type: 'text', text: NO_WORKSPACE_MESSAGE[browserScope] }] }
      }
      bridge = {
        callBrowser: async (toolName, browserInput) => {
          await ctx.authority?.revalidate({ phase: 'bridge-dispatch', toolName, capability, connectorCapability: exactConnectorCapability })
          if (browserScope === 'content') {
            await authorizeMcpContentTool(ctx.db, ctx.userId, ctx.capabilities, toolName, browserInput)
          }
          const current = getEditorBridgeForUser(ctx.userId, browserScope, ctx.bridgeSiteKey)
          if (!current) throw new Error(NO_WORKSPACE_MESSAGE[browserScope])
          return current.callBrowser(toolName, browserInput)
        },
      }
    }

    const controller = new AbortController()
    let output: AiToolOutput
    try {
      output = await executeAiTool(tool, input, bridge, controller.signal, {
        db: ctx.db,
        userId: ctx.userId,
        capabilities: ctx.capabilities,
        scope: tool.scope === 'shared' ? 'content' : tool.scope,
        conversationId: `mcp:${ctx.connectorId}`,
        snapshot: null,
      })
    } catch (err) {
      await ctx.authority?.abortTool({
        operationId,
        toolName: name,
        capability,
        input,
        reasonCode: 'tool-dispatch-failed',
      }).catch(() => {})
      // Browser bridge rejection is terminal for a chat turn, but MCP has no
      // surrounding provider loop to terminate. Translate the same transport
      // failure into the protocol's normal tool-error result instead of
      // letting the request handler reject with an internal MCP error.
      return {
        isError: true,
        content: [{
          type: 'text',
          text: getErrorMessage(err, `Browser tool "${tool.name}" could not return a result.`),
        }],
      }
    }

    try {
      await ctx.authority?.revalidate({ phase: 'tool-result', toolName: name, capability, connectorCapability: exactConnectorCapability })
      await ctx.authority?.recordToolResult({ operationId, toolName: name, capability, input, output })
    } catch (error) {
      await ctx.authority?.abortTool({ operationId, toolName: name, capability, input, reasonCode: 'authority-revoked' }).catch(() => {})
      return { isError: true, content: [{ type: 'text', text: getErrorMessage(error, 'MCP connector authority denied before result commit.') }] }
    }
    return callToolResult(output)
  })

  return server
}
