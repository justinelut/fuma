import { Type, type Static } from '@core/utils/typeboxHelpers'

const Strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1, maxLength: 255 })
const Timestamp = Type.String({ format: 'date-time' })
export const DomainRecordWireSchema = Type.Object({
  type: Type.Union([Type.Literal('CNAME'), Type.Literal('TXT'), Type.Literal('A')]),
  name: Type.String({ minLength: 1, maxLength: 253 }),
  value: Type.String({ minLength: 1, maxLength: 2048 }),
  purpose: Type.Union([Type.Literal('routing'), Type.Literal('ownership'), Type.Literal('tls-validation')]),
}, Strict)
export type DomainRecordWire = Readonly<Static<typeof DomainRecordWireSchema>>
export const DomainDiagnosticWireSchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 100 }),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  expected: Type.Union([DomainRecordWireSchema, Type.Null()]),
  observedValue: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
}, Strict)
export type DomainDiagnosticWire = Readonly<Static<typeof DomainDiagnosticWireSchema>>
export const DomainOperationsViewSchema = Type.Object({
  domainId: Id,
  hostname: Type.String({ minLength: 3, maxLength: 253 }),
  records: Type.Array(DomainRecordWireSchema, { minItems: 1, maxItems: 41 }),
  authoritativeDnsRetainedByCustomer: Type.Literal(true),
  customerCloudflareAccountRequired: Type.Literal(false),
  customerCloudflareTokenRequired: Type.Literal(false),
  launchState: Type.Union([Type.Literal('awaiting-records'), Type.Literal('awaiting-tls'), Type.Literal('active'), Type.Literal('detached')]),
  automation: Type.Union([
    Type.Object({ mode: Type.Literal('manual'), credentialId: Type.Null(), credentialState: Type.Null() }, Strict),
    Type.Object({ mode: Type.Literal('customer-managed'), credentialId: Id, credentialState: Type.Union([Type.Literal('active'), Type.Literal('revoked')]) }, Strict),
  ]),
  apexAlternatives: Type.Array(Type.Object({ kind: Type.String({ minLength: 1 }), available: Type.Boolean(), instruction: Type.String({ minLength: 1, maxLength: 500 }) }, Strict), { maxItems: 5 }),
  version: Type.Integer({ minimum: 1 }),
  operationFence: Type.Integer({ minimum: 1 }),
  updatedAt: Timestamp,
}, Strict)
export type DomainOperationsView = Readonly<Static<typeof DomainOperationsViewSchema>>
export const RegistrarTransferViewSchema = Type.Object({
  transferOperationId: Id,
  domainId: Id,
  hostname: Type.String({ minLength: 3, maxLength: 253 }),
  direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
  state: Type.Union([Type.Literal('requested'), Type.Literal('awaiting-unlock'), Type.Literal('awaiting-auth-code'), Type.Literal('submitted'), Type.Literal('completed'), Type.Literal('failed'), Type.Literal('rolling-back'), Type.Literal('rolled-back'), Type.Literal('detached')]),
  registrarLocked: Type.Boolean(),
  authCodeExpiresAt: Type.Union([Timestamp, Type.Null()]),
  ownership: Type.Union([Type.Literal('customer'), Type.Literal('fuma'), Type.Literal('external')]),
  renewalHandoff: Type.Union([Type.Literal('pending'), Type.Literal('fuma-managed'), Type.Literal('customer-managed'), Type.Literal('not-applicable')]),
  authCodeDelivery: Type.Union([Type.Literal('not-applicable'), Type.Literal('pending'), Type.Literal('delivered')]),
  version: Type.Integer({ minimum: 1 }),
  failureCode: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
  updatedAt: Timestamp,
}, Strict)
export type RegistrarTransferView = Readonly<Static<typeof RegistrarTransferViewSchema>>
export const DomainDiagnosticReportWireSchema = Type.Object({
  domainId: Id,
  hostname: Type.String({ minLength: 3, maxLength: 253 }),
  diagnostics: Type.Array(DomainDiagnosticWireSchema, { minItems: 1, maxItems: 100 }),
  observedAt: Timestamp,
  canCutover: Type.Boolean(),
}, Strict)

export interface DomainOperationsClient {
  exact(domainId: string): Promise<DomainOperationsView | null>
  diagnose(domainId: string): Promise<readonly DomainDiagnosticWire[]>
  startInbound(input: Readonly<{ domainId: string; hostname: string; authCode: string; authCodeExpiresAt: string }>): Promise<RegistrarTransferView>
  startOutbound(input: Readonly<{ domainId: string; hostname: string }>): Promise<RegistrarTransferView>
  resume(id: string): Promise<RegistrarTransferView>
  choose(outcome: 'retain-with-source' | 'move-with-site' | 'detach-and-manual'): Promise<void>
}
