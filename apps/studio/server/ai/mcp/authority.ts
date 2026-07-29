import type { CoreCapability } from '@core/capabilities'
import type { AiToolOutput } from '../runtime/types'
import type { McpPublishRuntime } from './tools/publishTool'

export type McpNativeCapability = 'read' | 'mutate' | 'publish'
export type McpNativePhase = 'list' | 'tool-dispatch' | 'bridge-dispatch' | 'tool-result'

export interface McpNativeExecutionAuthority {
  revalidate(input: Readonly<{ phase: McpNativePhase; toolName?: string; capability?: McpNativeCapability }>): Promise<void>
  authorizeTool(input: Readonly<{ operationId: string; toolName: string; capability: McpNativeCapability; input: unknown }>): Promise<Readonly<{ replay: AiToolOutput | null }>>
  recordToolResult(input: Readonly<{ operationId: string; toolName: string; capability: McpNativeCapability; input: unknown; output: AiToolOutput }>): Promise<void>
  abortTool(input: Readonly<{ operationId: string; toolName: string; capability: McpNativeCapability; input: unknown; reasonCode: string }>): Promise<void>
}

export interface McpNativeResolvedSession {
  connectorId: string
  userId: string
  capabilities: readonly CoreCapability[]
  operationId: string
  bridgeSiteKey?: string
  publishRuntime?: McpPublishRuntime
  authority: McpNativeExecutionAuthority
}

export interface McpNativeHttpAuthority {
  resolve(request: Request, identity: Readonly<{ rpcMethod: string | null; rpcId: string | null; operationId: string }>): Promise<McpNativeResolvedSession | null>
}
