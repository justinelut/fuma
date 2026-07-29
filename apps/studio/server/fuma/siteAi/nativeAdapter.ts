import type { AiStreamRequest } from '../../ai/drivers/types'
import type { AiRuntimeExecutionAuthority } from '../../ai/runtime/types'

/** Attach FUMA-065 to the existing request object consumed by native drivers. */
export function bindNativeSiteAiTurn(
  request: AiStreamRequest,
  authority: AiRuntimeExecutionAuthority,
): AiStreamRequest {
  return {
    ...request,
    toolContextBase: {
      ...request.toolContextBase,
      authority,
    },
  }
}

export function describeSiteAiIntegration() {
  return Object.freeze({
    ticket: 'FUMA-065' as const,
    reusesNativeAiRuntime: true as const,
    conversationAuthority: 'server/ai/conversations/store.ts' as const,
    providerAuthority: 'server/ai/drivers' as const,
    browserBridgeAuthority: 'server/ai/runtime/transport.ts' as const,
    policyDirectory: 'server/fuma/siteAi' as const,
    schemaMigrationId: '000068_site_ai_scope_authority' as const,
    schemaMigrationChecksum: '0c0368622abc603c03cd46e2c37107c2efc61c38f1bb3335539efcffa1e77bd5' as const,
    conductorSeams: Object.freeze([
      'bind scoped conversation after native conversation creation',
      'bind snapshot hash before native chat start',
      'attach returned authority to AiStreamRequest.toolContextBase and persister context',
      'reuse the existing native runner, stores, provider drivers, and browser bridge',
    ] as const),
  })
}
